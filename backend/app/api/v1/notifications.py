from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.notification import Notification
from app.models.email_dispatch_log import EmailDispatchLog
from app.schemas.notification import NotificationOut, DeviceRegisterRequest, EmailDispatchLogOut

router = APIRouter(tags=["notifications"])


def _mask_email(email: str) -> str:
    local, sep, domain = email.partition("@")
    if not sep:
        return "***"
    if len(local) <= 2:
        return f"{local[0]}***@{domain}" if local else f"***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.patch("/notifications/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    await db.commit()
    await db.refresh(notif)
    return notif


@router.post("/notifications/read-all")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == current_user.id, Notification.is_read == False)
        .values(is_read=True)
    )
    await db.commit()
    return {"message": "All notifications marked as read"}


@router.get("/notifications/activity/email", response_model=list[EmailDispatchLogOut])
async def list_email_activity(
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=500, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ = current_user  # authenticated access only
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    result = await db.execute(
        select(EmailDispatchLog)
        .where(EmailDispatchLog.created_at >= cutoff)
        .order_by(EmailDispatchLog.created_at.desc())
        .limit(limit)
    )
    rows = result.scalars().all()
    return [
        EmailDispatchLogOut(
            id=row.id,
            recipient=row.recipient,
            recipient_masked=_mask_email(row.recipient),
            subject=row.subject,
            status=row.status,
            source=row.source,
            error_text=row.error_text,
            payload=row.payload,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.post("/devices/register")
async def register_device(
    data: DeviceRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.fcm_token = data.token
    await db.commit()
    return {"message": "Device registered"}


@router.delete("/devices/{token}", status_code=204)
async def unregister_device(
    token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.fcm_token == token:
        current_user.fcm_token = None
        await db.commit()
