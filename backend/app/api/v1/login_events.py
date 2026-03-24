from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.auth_login_event import AuthLoginEvent
from app.services.access_scope import get_user_access_scope
from app.services.permission_service import can_manage_team
from app.schemas.user import AuthLoginEventOut

router = APIRouter(prefix="/users", tags=["login-events"])


@router.get("/login-events", response_model=list[AuthLoginEventOut])
async def list_login_events(
    limit: int = Query(default=200, ge=1, le=1000),
    user_id: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    email_query: str | None = Query(default=None),
    from_dt: datetime | None = Query(default=None),
    to_dt: datetime | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not can_manage_team(current_user):
        raise HTTPException(status_code=403, detail="Нет права на управление командой")
    scope = await get_user_access_scope(db, current_user)

    base_stmt = (
        select(AuthLoginEvent)
        .options(selectinload(AuthLoginEvent.user))
        .order_by(AuthLoginEvent.created_at.desc())
        .limit(limit)
    )

    filters = []
    if user_id:
        filters.append(AuthLoginEvent.user_id == user_id)
    if success is not None:
        filters.append(AuthLoginEvent.success == success)
    if email_query:
        like = f"%{email_query.strip().lower()}%"
        filters.append(AuthLoginEvent.normalized_email.ilike(like))
    if from_dt:
        filters.append(AuthLoginEvent.created_at >= from_dt)
    if to_dt:
        filters.append(AuthLoginEvent.created_at <= to_dt)

    if current_user.role != "admin":
        scoped_users = set(scope.user_ids)
        scoped_emails: set[str] = set()
        if scoped_users:
            rows = (
                await db.execute(
                    select(User.email, User.work_email).where(User.id.in_(scoped_users))
                )
            ).all()
            for row in rows:
                if row.email:
                    scoped_emails.add(row.email.strip().lower())
                if row.work_email:
                    scoped_emails.add(row.work_email.strip().lower())

        visibility_filters = []
        if scoped_users:
            visibility_filters.append(AuthLoginEvent.user_id.in_(scoped_users))
        if scoped_emails:
            visibility_filters.append(AuthLoginEvent.normalized_email.in_(scoped_emails))
        if not visibility_filters:
            return []
        filters.append(or_(*visibility_filters))

    if filters:
        base_stmt = base_stmt.where(and_(*filters))

    events = (await db.execute(base_stmt)).scalars().all()
    return [
        AuthLoginEventOut(
            id=event.id,
            user_id=event.user_id,
            user_name=event.user.name if event.user else None,
            user_email=event.user.email if event.user else None,
            email_entered=event.email_entered,
            normalized_email=event.normalized_email,
            success=event.success,
            failure_reason=event.failure_reason,
            client_ip=event.client_ip,
            user_agent=event.user_agent,
            created_at=event.created_at,
        )
        for event in events
    ]
