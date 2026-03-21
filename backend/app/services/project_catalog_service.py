from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.project import Project, ProjectDepartment, ProjectMember, default_completion_checklist
from app.models.task import Task, TaskAssignee
from app.models.user import User
from app.services.access_scope import get_user_access_scope
from app.services.project_access_service import sync_project_departments, validate_department_ids
from app.services.project_rules_service import apply_control_ski, normalize_checklist


async def list_projects_for_user(db: AsyncSession, *, actor: User) -> list[Project]:
    if actor.role == "admin":
        return (
            await db.execute(
                select(Project).options(selectinload(Project.owner), selectinload(Project.departments))
            )
        ).scalars().all()

    scope = await get_user_access_scope(db, actor)
    project_ids_from_members = (
        await db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id.in_(scope.user_ids))
        )
    ).scalars().all()
    project_ids_from_departments = (
        await db.execute(
            select(ProjectDepartment.project_id).where(
                ProjectDepartment.department_id.in_(scope.department_ids or {""})
            )
        )
    ).scalars().all()
    own_task_project_ids = (
        await db.execute(select(Task.project_id).where(Task.assigned_to_id == actor.id))
    ).scalars().all()
    own_multi_task_project_ids = (
        await db.execute(
            select(Task.project_id)
            .join(TaskAssignee, TaskAssignee.task_id == Task.id)
            .where(TaskAssignee.user_id == actor.id)
        )
    ).scalars().all()
    accessible_ids = (
        set(project_ids_from_members)
        | set(project_ids_from_departments)
        | set(own_task_project_ids)
        | set(own_multi_task_project_ids)
    )
    if not accessible_ids:
        return []
    return (
        await db.execute(
            select(Project)
            .where(Project.id.in_(accessible_ids))
            .options(selectinload(Project.owner), selectinload(Project.departments))
        )
    ).scalars().all()


async def create_project_with_owner_member(
    db: AsyncSession,
    *,
    payload: dict,
    owner_id: str,
) -> Project:
    department_ids = await validate_department_ids(db, payload.pop("department_ids", []))
    incoming_checklist = normalize_checklist(payload.get("completion_checklist"))
    payload["completion_checklist"] = incoming_checklist or default_completion_checklist()
    apply_control_ski(payload)

    if payload.get("launch_basis_file_id"):
        raise HTTPException(status_code=400, detail="launch_basis_file_id can be set only after upload")

    project = Project(**payload, owner_id=owner_id)
    db.add(project)
    await db.flush()
    await sync_project_departments(db, project.id, department_ids)
    db.add(ProjectMember(project_id=project.id, user_id=owner_id, role="owner"))
    await db.commit()
    await db.refresh(project)

    return (
        await db.execute(
            select(Project)
            .where(Project.id == project.id)
            .options(selectinload(Project.owner), selectinload(Project.departments))
        )
    ).scalar_one()
