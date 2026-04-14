from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskAssignee
from app.models.user import User
from app.services.access_scope import (
    can_access_project,
    has_department_level_access,
)


async def is_project_member(project_id: str, user: User, db: AsyncSession) -> bool:
    if user.role == "admin":
        return True
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    return result.scalar_one_or_none() is not None


async def require_project_member(project_id: str, user: User, db: AsyncSession) -> None:
    if not await is_project_member(project_id, user, db):
        raise HTTPException(status_code=403, detail="Access denied")


async def require_project_visibility(project_id: str, user: User, db: AsyncSession) -> None:
    if not await can_access_project(db, user, project_id):
        raise HTTPException(status_code=403, detail="Access denied")


async def require_task_read_visibility(task: Task, user: User, db: AsyncSession) -> None:
    await require_project_visibility(task.project_id, user, db)
    require_task_visibility(task, user)


def is_task_assignee(task: Task, user_id: str) -> bool:
    if task.assigned_to_id == user_id:
        return True
    if task.assignee_links:
        return any(link.user_id == user_id for link in task.assignee_links)
    return False


def is_own_tasks_only(user: User) -> bool:
    return (
        user.role != "admin"
        and user.visibility_scope == "own_tasks_only"
        and bool(getattr(user, "own_tasks_visibility_enabled", True))
    )


def require_task_visibility(task: Task, user: User) -> None:
    if not is_own_tasks_only(user):
        return
    if not is_task_assignee(task, user.id):
        raise HTTPException(status_code=403, detail="Access denied")


async def require_project_manager(project_id: str, user: User, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not member or member.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Manager access required")


def require_bulk_permission(user: User) -> None:
    """Kept for backwards compatibility — delegates to permission_service."""
    from app.services.permission_service import can_bulk_edit
    if not can_bulk_edit(user):
        raise HTTPException(status_code=403, detail="Нет права на массовое редактирование")


def require_delete_permission(user: User) -> None:
    """Kept for backwards compatibility — delegates to permission_service."""
    from app.services.permission_service import can_delete
    if not can_delete(user):
        raise HTTPException(status_code=403, detail="Нет права на удаление задач")


async def require_project_exists(project_id: str, db: AsyncSession) -> None:
    exists = (await db.execute(select(Project.id).where(Project.id == project_id))).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="Project not found")


async def ensure_member_for_assignee(
    project_id: str,
    assignee_id: str,
    actor: User,
    db: AsyncSession,
) -> None:
    user = (await db.execute(select(User).where(User.id == assignee_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Assignee not found")
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == assignee_id,
            )
        )
    ).scalar_one_or_none()
    if member:
        return
    db.add(ProjectMember(project_id=project_id, user_id=assignee_id, role="member"))
    await db.flush()


async def sync_task_assignees(
    task: Task,
    assignee_ids: list[str] | None,
    project_id: str,
    actor: User,
    db: AsyncSession,
) -> None:
    if assignee_ids is None:
        return
    normalized = [uid.strip() for uid in assignee_ids if uid and uid.strip()]
    unique_ids = list(dict.fromkeys(normalized))
    for uid in unique_ids:
        await ensure_member_for_assignee(project_id, uid, actor, db)

    existing_rows = (
        await db.execute(select(TaskAssignee).where(TaskAssignee.task_id == task.id))
    ).scalars().all()
    existing_by_user = {row.user_id: row for row in existing_rows}
    desired_ids = set(unique_ids)

    for row in existing_rows:
        if row.user_id not in desired_ids:
            await db.delete(row)

    for uid in unique_ids:
        if uid not in existing_by_user:
            db.add(TaskAssignee(task_id=task.id, user_id=uid))

    task.assigned_to_id = unique_ids[0] if unique_ids else None


async def serialize_assignee_ids(task: Task, db: AsyncSession) -> list[str]:
    from sqlalchemy import inspect as sa_inspect
    from sqlalchemy.orm.base import NO_VALUE

    insp = sa_inspect(task)
    loaded = insp.attrs.assignee_links.loaded_value
    if loaded is not NO_VALUE:
        if loaded:
            return [link.user_id for link in loaded]
        return [task.assigned_to_id] if task.assigned_to_id else []

    rows = (
        await db.execute(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id))
    ).scalars().all()
    if rows:
        return rows
    return [task.assigned_to_id] if task.assigned_to_id else []


async def require_task_editor(task: Task, user: User, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    if is_own_tasks_only(user):
        if is_task_assignee(task, user.id):
            return
        raise HTTPException(status_code=403, detail="Edit access denied")
    assignee_ids = {task.assigned_to_id} if task.assigned_to_id else set()
    if task.assignee_links:
        assignee_ids |= {link.user_id for link in task.assignee_links}
    if user.id in assignee_ids:
        return
    if await is_project_member(task.project_id, user, db):
        return
    raise HTTPException(status_code=403, detail="Edit access denied")


def is_title_only_update(
    payload: dict,
    *,
    assignee_ids: list[str] | None,
    deadline_change_reason: str | None,
) -> bool:
    return set(payload.keys()) <= {"title"} and assignee_ids is None and deadline_change_reason is None


async def require_task_update_access(
    task: Task,
    user: User,
    db: AsyncSession,
    *,
    title_only_update: bool,
) -> None:
    try:
        await require_task_editor(task, user, db)
    except HTTPException as exc:
        if exc.status_code != 403:
            raise
        can_rename_with_scope = (
            title_only_update
            and await has_department_level_access(db, user)
            and await can_access_project(db, user, task.project_id)
        )
        if not can_rename_with_scope:
            raise
