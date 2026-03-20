from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.deadline_change import DeadlineChange
from app.models.project import Project, ProjectFile, ProjectMember
from app.models.user import User
from app.services.access_scope import can_access_project, has_department_level_access
from app.services.project_access_service import (
    require_assignment_scope_user,
    sync_project_departments,
    validate_department_ids,
)
from app.services.project_rules_service import (
    apply_control_ski,
    ensure_project_completion_allowed,
    normalize_checklist,
)


def is_title_only_project_update(
    payload: dict,
    *,
    owner_id: str | None,
    incoming_department_ids: list[str] | None,
    checklist_payload: list[dict] | None,
    deadline_change_reason: str | None,
) -> bool:
    return (
        set(payload.keys()) <= {"name"}
        and owner_id is None
        and incoming_department_ids is None
        and checklist_payload is None
        and deadline_change_reason is None
    )


async def ensure_project_update_access_or_403(
    db: AsyncSession,
    *,
    actor: User,
    project_id: str,
    requester_member: ProjectMember | None,
    title_only_update: bool,
) -> None:
    has_manager_membership = requester_member and requester_member.role in ("owner", "manager")
    if actor.role == "admin" or has_manager_membership:
        return
    can_rename_with_scope = (
        title_only_update
        and await has_department_level_access(db, actor)
        and await can_access_project(db, actor, project_id)
    )
    if not can_rename_with_scope:
        raise HTTPException(status_code=403, detail="Manager access required")


def validate_project_deadline_change_or_422(
    *,
    new_end_date,
    old_end_date,
    deadline_change_reason: str | None,
) -> None:
    if new_end_date is not None and new_end_date != old_end_date and not deadline_change_reason:
        raise HTTPException(status_code=422, detail="Укажите причину изменения дедлайна")


async def transfer_project_ownership_if_requested(
    db: AsyncSession,
    *,
    project: Project,
    project_id: str,
    new_owner_id: str | None,
    actor: User,
    requester_member: ProjectMember | None,
) -> None:
    from app.services.notification_service import notify_project_assigned

    if not new_owner_id or new_owner_id == project.owner_id:
        return
    if actor.role != "admin" and (not requester_member or requester_member.role != "owner"):
        raise HTTPException(status_code=403, detail="Only owner or admin can transfer ownership")
    await require_assignment_scope_user(db, actor, new_owner_id)
    owner_result = await db.execute(select(User).where(User.id == new_owner_id))
    if not owner_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Owner not found")
    project.owner_id = new_owner_id
    members_result = await db.execute(select(ProjectMember).where(ProjectMember.project_id == project_id))
    members = members_result.scalars().all()
    for member in members:
        if member.role == "owner" and member.user_id != new_owner_id:
            member.role = "manager"
    target_member = next((m for m in members if m.user_id == new_owner_id), None)
    if target_member:
        target_member.role = "owner"
    else:
        db.add(ProjectMember(project_id=project_id, user_id=new_owner_id, role="owner"))
    await notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project.name,
        user_id=new_owner_id,
        assigned_role="owner",
    )


async def update_project_with_rules(
    db: AsyncSession,
    *,
    project: Project,
    project_id: str,
    payload: dict,
    actor: User,
    requester_member: ProjectMember | None,
) -> Project:
    from app.services.notification_service import notify_project_updated

    owner_id = payload.pop("owner_id", None)
    incoming_department_ids = payload.pop("department_ids", None)
    checklist_payload = payload.pop("completion_checklist", None)
    deadline_change_reason = payload.pop("deadline_change_reason", None)

    title_only_update = is_title_only_project_update(
        payload,
        owner_id=owner_id,
        incoming_department_ids=incoming_department_ids,
        checklist_payload=checklist_payload,
        deadline_change_reason=deadline_change_reason,
    )
    await ensure_project_update_access_or_403(
        db,
        actor=actor,
        project_id=project_id,
        requester_member=requester_member,
        title_only_update=title_only_update,
    )

    if checklist_payload is not None:
        project.completion_checklist = normalize_checklist(checklist_payload)
    target_status = payload.get("status", project.status)
    if target_status == "completed":
        ensure_project_completion_allowed(project.completion_checklist)

    new_end_date = payload.get("end_date")
    old_end_date = project.end_date
    validate_project_deadline_change_or_422(
        new_end_date=new_end_date,
        old_end_date=old_end_date,
        deadline_change_reason=deadline_change_reason,
    )

    launch_basis_file_id = payload.get("launch_basis_file_id")
    if launch_basis_file_id:
        file_result = await db.execute(
            select(ProjectFile.id).where(
                ProjectFile.id == launch_basis_file_id,
                ProjectFile.project_id == project_id,
            )
        )
        if not file_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Launch basis file not found")

    apply_control_ski(payload, existing_priority=project.priority, existing_control_ski=project.control_ski)
    for field, value in payload.items():
        setattr(project, field, value)
    if incoming_department_ids is not None:
        normalized_department_ids = await validate_department_ids(db, incoming_department_ids)
        await sync_project_departments(db, project_id, normalized_department_ids)

    if new_end_date is not None and new_end_date != old_end_date and deadline_change_reason:
        db.add(
            DeadlineChange(
                entity_type="project",
                entity_id=project_id,
                changed_by_id=actor.id,
                old_date=old_end_date,
                new_date=new_end_date,
                reason=deadline_change_reason,
            )
        )

    await transfer_project_ownership_if_requested(
        db,
        project=project,
        project_id=project_id,
        new_owner_id=owner_id,
        actor=actor,
        requester_member=requester_member,
    )
    await db.commit()
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.owner), selectinload(Project.departments))
    )
    refreshed_project = result.scalar_one()
    await notify_project_updated(db, refreshed_project)
    return refreshed_project
