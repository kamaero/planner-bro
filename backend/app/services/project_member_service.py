from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectMember
from app.models.user import User
from app.services.project_access_service import (
    ensure_add_member_role_allowed,
    ensure_manager_assignment_allowed,
    ensure_member_absent,
    ensure_update_member_role_allowed,
    get_member,
    get_member_or_404,
    require_assignment_scope_user,
    require_project_access,
)


async def _notify_project_assigned(
    db: AsyncSession,
    *,
    project_id: str,
    project_name: str,
    user_id: str,
    assigned_role: str,
) -> None:
    from app.services.notification_service import notify_project_assigned

    await notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project_name,
        user_id=user_id,
        assigned_role=assigned_role,
    )


async def add_project_member(
    db: AsyncSession,
    *,
    project_id: str,
    target_user_id: str,
    role: str,
    actor: User,
) -> None:
    project = await require_project_access(project_id, actor, db, require_manager=True)
    requester_member = await get_member(project_id, actor.id, db)
    ensure_add_member_role_allowed(role)
    ensure_manager_assignment_allowed(
        role,
        current_user_role=actor.role,
        requester_member=requester_member,
    )
    await require_assignment_scope_user(db, actor, target_user_id)
    await ensure_member_absent(project_id, target_user_id, db)

    db.add(ProjectMember(project_id=project_id, user_id=target_user_id, role=role))
    await db.commit()
    await _notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project.name,
        user_id=target_user_id,
        assigned_role=role,
    )


async def update_project_member_role(
    db: AsyncSession,
    *,
    project_id: str,
    target_user_id: str,
    role: str,
    actor: User,
) -> None:
    project = await require_project_access(project_id, actor, db, require_manager=True)
    requester_member = await get_member(project_id, actor.id, db)
    member = await get_member_or_404(project_id, target_user_id, db)
    ensure_update_member_role_allowed(member.role, role)
    ensure_manager_assignment_allowed(
        role,
        current_user_role=actor.role,
        requester_member=requester_member,
    )
    member.role = role
    await db.commit()
    await _notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project.name,
        user_id=target_user_id,
        assigned_role=role,
    )


async def remove_project_member(
    db: AsyncSession,
    *,
    project_id: str,
    target_user_id: str,
    actor: User,
) -> None:
    await require_project_access(project_id, actor, db, require_manager=True)
    member = await get_member_or_404(project_id, target_user_id, db)
    if member.role == "owner":
        raise HTTPException(
            status_code=400,
            detail="Project owner cannot be removed. Transfer ownership first.",
        )
    await db.delete(member)
    await db.commit()
