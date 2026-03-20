from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.department import Department
from app.models.project import Project, ProjectDepartment, ProjectMember
from app.models.user import User
from app.services.access_scope import get_user_access_scope


async def build_department_dashboard_payload(db: AsyncSession, *, current_user: User) -> dict:
    scope = None if current_user.role == "admin" else await get_user_access_scope(db, current_user)
    departments = (await db.execute(select(Department).order_by(Department.name.asc()))).scalars().all()
    users = (await db.execute(select(User.id, User.manager_id, User.department_id))).all()
    projects = (
        await db.execute(select(Project).options(selectinload(Project.owner), selectinload(Project.departments)))
    ).scalars().all()

    members_query = select(ProjectMember.project_id, ProjectMember.user_id, ProjectMember.role).where(
        ProjectMember.role != "owner"
    )
    if scope:
        members_query = members_query.where(ProjectMember.user_id.in_(scope.user_ids))
    members = (await db.execute(members_query)).all()

    manual_links_query = select(ProjectDepartment.project_id, ProjectDepartment.department_id)
    if scope:
        manual_links_query = manual_links_query.where(
            ProjectDepartment.department_id.in_(scope.department_ids or {""})
        )
    manual_links = (await db.execute(manual_links_query)).all()

    children_map: dict[str, list[str]] = {}
    user_department_map: dict[str, str | None] = {}
    for user_id, manager_id, department_id in users:
        user_department_map[user_id] = department_id
        if manager_id:
            children_map.setdefault(manager_id, []).append(user_id)

    department_children_map: dict[str, list[str]] = {}
    for dep in departments:
        if dep.parent_id:
            department_children_map.setdefault(dep.parent_id, []).append(dep.id)

    def _collect_department_tree(department_id: str) -> set[str]:
        collected: set[str] = set()
        stack = [department_id]
        while stack:
            current = stack.pop()
            if current in collected:
                continue
            collected.add(current)
            stack.extend(department_children_map.get(current, []))
        return collected

    def _collect_subordinates(head_user_id: str | None) -> set[str]:
        if not head_user_id:
            return set()
        collected: set[str] = set()
        stack = [head_user_id]
        while stack:
            cur = stack.pop()
            if cur in collected:
                continue
            collected.add(cur)
            stack.extend(children_map.get(cur, []))
        return collected

    dept_user_ids: dict[str, set[str]] = {}
    for dep in departments:
        dept_tree = _collect_department_tree(dep.id)
        users_in_tree = {
            user_id
            for user_id, user_dep_id in user_department_map.items()
            if user_dep_id in dept_tree
        }
        subordinates_in_tree = {
            user_id
            for user_id in _collect_subordinates(dep.head_user_id)
            if user_department_map.get(user_id) in dept_tree
        }
        dept_user_ids[dep.id] = users_in_tree | subordinates_in_tree

    project_ids_by_dept: dict[str, set[str]] = {dep.id: set() for dep in departments}
    for project_id, user_id, _role in members:
        for dep in departments:
            if user_id in dept_user_ids.get(dep.id, set()):
                project_ids_by_dept[dep.id].add(project_id)
    for project_id, dep_id in manual_links:
        if dep_id in project_ids_by_dept:
            project_ids_by_dept[dep_id].add(project_id)

    project_map = {project.id: project for project in projects}
    sections = []
    for dep in departments:
        if scope and dep.id not in scope.department_ids:
            continue
        dep_projects = [
            project_map[pid]
            for pid in sorted(project_ids_by_dept.get(dep.id, set()))
            if pid in project_map
        ]
        dep_projects.sort(
            key=lambda p: (
                1 if p.status == "completed" else 0,
                p.end_date.isoformat() if p.end_date else "9999-12-31",
                p.name.lower(),
            )
        )
        sections.append(
            {
                "department_id": dep.id,
                "department_name": dep.name,
                "projects": dep_projects,
            }
        )
    return {"departments": sections}
