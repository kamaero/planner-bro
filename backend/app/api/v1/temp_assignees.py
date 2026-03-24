from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user, hash_password
from app.models.user import User
from app.models.temp_assignee import TempAssignee
from app.services.access_scope import get_user_access_scope
from app.schemas.user import UserOut, TempAssigneeOut, TempAssigneeLinkRequest, TempAssigneePromoteRequest
from app.api.v1._user_helpers import (
    normalize_email,
    normalize_optional_email,
    short_name,
    generate_temporary_password,
    default_permissions_for_role,
    default_visibility_for_role,
)

router = APIRouter(prefix="/users", tags=["temp-assignees"])


def _can_manage_temp_assignees(user: User) -> bool:
    return user.role in ("admin", "manager") or bool(user.can_manage_team)


@router.get("/temp-assignees", response_model=list[TempAssigneeOut])
async def list_temp_assignees(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=200, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    scope = await get_user_access_scope(db, current_user)
    stmt = (
        select(TempAssignee)
        .options(selectinload(TempAssignee.linked_user))
        .order_by(TempAssignee.last_seen_at.desc())
        .limit(limit)
    )
    if current_user.role != "admin":
        stmt = stmt.where(
            or_(
                TempAssignee.created_by_id == current_user.id,
                TempAssignee.created_by_id.in_(scope.user_ids),
            )
        )
    if status:
        stmt = stmt.where(TempAssignee.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/temp-assignees/{temp_assignee_id}/link", response_model=TempAssigneeOut)
async def link_temp_assignee(
    temp_assignee_id: str,
    data: TempAssigneeLinkRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(
            select(TempAssignee)
            .where(TempAssignee.id == temp_assignee_id)
            .options(selectinload(TempAssignee.linked_user))
        )
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    user = (await db.execute(select(User).where(User.id == data.user_id, User.is_active == True))).scalar_one_or_none()  # noqa: E712
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    temp.linked_user_id = user.id
    temp.status = "linked"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(temp)
    return temp


@router.patch("/temp-assignees/{temp_assignee_id}/ignore", response_model=TempAssigneeOut)
async def ignore_temp_assignee(
    temp_assignee_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(
            select(TempAssignee)
            .where(TempAssignee.id == temp_assignee_id)
            .options(selectinload(TempAssignee.linked_user))
        )
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    temp.status = "ignored"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(temp)
    return temp


@router.post("/temp-assignees/{temp_assignee_id}/promote")
async def promote_temp_assignee(
    temp_assignee_id: str,
    data: TempAssigneePromoteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(select(TempAssignee).where(TempAssignee.id == temp_assignee_id))
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    normalized = normalize_email(str(data.email))
    existing = await db.execute(
        select(User).where(
            or_(
                func.lower(User.email) == normalized,
                func.lower(User.work_email) == normalized,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    parts = [part for part in temp.raw_name.split(" ") if part.strip()]
    last_name = parts[0].strip() if parts else temp.raw_name.strip()
    first_name = parts[1].strip() if len(parts) > 1 else ""
    middle_name = " ".join(parts[2:]).strip() if len(parts) > 2 else ""
    password = data.password or generate_temporary_password()
    role = data.role if data.role in ("developer", "manager", "admin") else "developer"
    if current_user.role != "admin" and role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can create admin accounts")

    created_user = User(
        email=normalized,
        work_email=normalize_optional_email(str(data.work_email)) if data.work_email else None,
        name=short_name(last_name, first_name, middle_name),
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        position_title=data.position_title,
        manager_id=data.manager_id or (current_user.id if current_user.role != "admin" else None),
        department_id=data.department_id,
        password_hash=hash_password(password),
        role=role,
        visibility_scope=default_visibility_for_role(role),
        own_tasks_visibility_enabled=True,
        is_active=True,
        **default_permissions_for_role(role),
    )
    db.add(created_user)
    await db.flush()

    temp.linked_user_id = created_user.id
    temp.status = "promoted"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(created_user)
    await db.refresh(temp)
    return {
        "user": UserOut.model_validate(created_user),
        "temporary_password": password if not data.password else None,
        "temp_assignee": TempAssigneeOut.model_validate(temp),
    }
