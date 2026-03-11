from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.department import Department
from app.models.project import Project, ProjectDepartment, ProjectMember
from app.models.task import Task, TaskAssignee
from app.models.user import User


@dataclass
class AccessScope:
    user_ids: set[str]
    department_ids: set[str]


def _normalize_position_title(value: str | None) -> str:
    return (value or "").strip().lower()


def _is_global_assignment_position(position_title: str | None) -> bool:
    normalized = _normalize_position_title(position_title)
    if not normalized:
        return False
    tokens = ("гип", "главный инженер проектов", "зам", "заместитель")
    return any(token in normalized for token in tokens)


async def _is_department_head(db: AsyncSession, user_id: str) -> bool:
    hit = (
        await db.execute(
            select(Department.id).where(Department.head_user_id == user_id).limit(1)
        )
    ).scalar_one_or_none()
    return bool(hit)


async def _collect_subordinate_ids(db: AsyncSession, root_user_id: str) -> set[str]:
    rows = (await db.execute(select(User.id, User.manager_id).where(User.is_active == True))).all()  # noqa: E712
    children_map: dict[str, list[str]] = {}
    for user_id, manager_id in rows:
        if manager_id:
            children_map.setdefault(manager_id, []).append(user_id)

    collected: set[str] = set()
    stack = [root_user_id]
    while stack:
        current = stack.pop()
        if current in collected:
            continue
        collected.add(current)
        stack.extend(children_map.get(current, []))
    return collected


async def _collect_department_tree_ids(db: AsyncSession, seed_department_ids: set[str]) -> set[str]:
    if not seed_department_ids:
        return set()
    rows = (await db.execute(select(Department.id, Department.parent_id))).all()
    children_map: dict[str, list[str]] = {}
    for dep_id, parent_id in rows:
        if parent_id:
            children_map.setdefault(parent_id, []).append(dep_id)

    collected: set[str] = set()
    stack = list(seed_department_ids)
    while stack:
        current = stack.pop()
        if current in collected:
            continue
        collected.add(current)
        stack.extend(children_map.get(current, []))
    return collected


async def get_user_access_scope(db: AsyncSession, user: User) -> AccessScope:
    if user.visibility_scope == "full_scope" or user.role == "admin":
        all_user_ids = set((await db.execute(select(User.id).where(User.is_active == True))).scalars().all())  # noqa: E712
        all_department_ids = set((await db.execute(select(Department.id))).scalars().all())
        return AccessScope(user_ids=all_user_ids, department_ids=all_department_ids)

    if user.visibility_scope == "own_tasks_only":
        return AccessScope(user_ids={user.id}, department_ids=set())

    subordinate_ids = await _collect_subordinate_ids(db, user.id)

    seed_departments = {
        dep_id
        for dep_id in (
            user.department_id,
            *(
                await db.execute(
                    select(Department.id).where(Department.head_user_id == user.id)
                )
            ).scalars().all(),
        )
        if dep_id
    }
    department_ids = await _collect_department_tree_ids(db, seed_departments)

    users_in_departments = set()
    if department_ids:
        users_in_departments = set(
            (
                await db.execute(
                    select(User.id).where(
                        User.is_active == True,  # noqa: E712
                        User.department_id.in_(department_ids),
                    )
                )
            ).scalars().all()
        )

    scoped_users = set(subordinate_ids) | users_in_departments | {user.id}
    return AccessScope(user_ids=scoped_users, department_ids=department_ids)


async def is_user_in_scope(db: AsyncSession, actor: User, target_user_id: str) -> bool:
    if actor.role == "admin":
        return True
    scope = await get_user_access_scope(db, actor)
    return target_user_id in scope.user_ids


async def can_access_project(db: AsyncSession, actor: User, project_id: str) -> bool:
    if actor.role == "admin" or actor.visibility_scope == "full_scope":
        return True

    direct_member = (
        await db.execute(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == actor.id,
            )
        )
    ).scalar_one_or_none()
    if direct_member:
        return True

    scope = await get_user_access_scope(db, actor)
    if scope.user_ids:
        member_hit = (
            await db.execute(
                select(ProjectMember.user_id).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id.in_(scope.user_ids),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if member_hit:
            return True

    if scope.department_ids:
        dep_hit = (
            await db.execute(
                select(ProjectDepartment.department_id).where(
                    ProjectDepartment.project_id == project_id,
                    ProjectDepartment.department_id.in_(scope.department_ids),
                ).limit(1)
            )
        ).scalar_one_or_none()
        if dep_hit:
            return True

    own_task_hit = (
        await db.execute(
            select(Task.id).where(
                Task.project_id == project_id,
                Task.assigned_to_id == actor.id,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if own_task_hit:
        return True
    own_multi_task_hit = (
        await db.execute(
            select(TaskAssignee.task_id)
            .join(Task, Task.id == TaskAssignee.task_id)
            .where(
                Task.project_id == project_id,
                TaskAssignee.user_id == actor.id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if own_multi_task_hit:
        return True

    owner_id = (
        await db.execute(select(Project.owner_id).where(Project.id == project_id))
    ).scalar_one_or_none()
    return bool(owner_id and owner_id in scope.user_ids)


async def get_task_assignment_scope_user_ids(db: AsyncSession, actor: User) -> set[str]:
    if actor.role == "admin" or actor.visibility_scope == "full_scope":
        return set(
            (await db.execute(select(User.id).where(User.is_active == True))).scalars().all()  # noqa: E712
        )

    if _is_global_assignment_position(getattr(actor, "position_title", None)):
        return set(
            (
                await db.execute(
                    select(User.id).where(
                        User.is_active == True,  # noqa: E712
                        User.role != "admin",
                    )
                )
            ).scalars().all()
        )

    actor_is_head = await _is_department_head(db, actor.id)
    if actor.role == "manager" or bool(actor.can_manage_team) or actor_is_head:
        return set(
            (
                await db.execute(
                    select(User.id).where(
                        User.is_active == True,  # noqa: E712
                        User.role != "admin",
                    )
                )
            ).scalars().all()
        )

    scope = await get_user_access_scope(db, actor)
    if not scope.user_ids:
        return set()
    active_scope_ids = set(
        (
            await db.execute(
                select(User.id).where(
                    User.is_active == True,  # noqa: E712
                    User.id.in_(scope.user_ids),
                )
            )
        ).scalars().all()
    )
    return active_scope_ids
