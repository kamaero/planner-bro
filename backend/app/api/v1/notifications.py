from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_, select, update

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.notification import Notification
from app.models.email_dispatch_log import EmailDispatchLog
from app.models.system_activity_log import SystemActivityLog
from app.schemas.notification import (
    NotificationOut,
    DeviceRegisterRequest,
    EmailDispatchLogOut,
    SystemActivityLogOut,
    ClientErrorReportIn,
    SMTPHealthCheckIn,
    SMTPHealthCheckOut,
    ReportDispatchSettingsOut,
    ReportDispatchSettingsUpdateIn,
    ReportDeliveryStatusOut,
)
from app.services.system_activity_service import log_system_activity
from app.services.notification_service import _send_email_to_recipients
from app.services.report_settings_service import (
    get_report_dispatch_settings,
    update_report_dispatch_settings,
)

router = APIRouter(tags=["notifications"])


def _mask_email(email: str) -> str:
    local, sep, domain = email.partition("@")
    if not sep:
        return "***"
    if len(local) <= 2:
        return f"{local[0]}***@{domain}" if local else f"***@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _can_manage_reports(user: User) -> bool:
    return user.role in ("admin", "manager") or bool(user.can_manage_team)


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
    include_probe: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ = current_user  # authenticated access only
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    stmt = (
        select(EmailDispatchLog)
        .where(EmailDispatchLog.created_at >= cutoff)
        .order_by(EmailDispatchLog.created_at.desc())
        .limit(limit)
    )
    if not include_probe:
        stmt = stmt.where(EmailDispatchLog.source != "smtp_probe")
    result = await db.execute(stmt)
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


@router.get("/notifications/activity/system", response_model=list[SystemActivityLogOut])
async def list_system_activity(
    hours: int = Query(default=24, ge=1, le=168),
    limit: int = Query(default=1000, ge=1, le=5000),
    level: str | None = Query(default=None),
    category: str | None = Query(default=None),
    source: str | None = Query(default=None),
    include_probe: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ = current_user  # authenticated access only
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    stmt = (
        select(SystemActivityLog)
        .where(SystemActivityLog.created_at >= cutoff)
        .order_by(SystemActivityLog.created_at.desc())
        .limit(limit)
    )
    if level:
        stmt = stmt.where(SystemActivityLog.level == level)
    if category:
        stmt = stmt.where(SystemActivityLog.category == category)
    if source:
        stmt = stmt.where(SystemActivityLog.source == source)
    if not include_probe:
        stmt = stmt.where(~SystemActivityLog.message.ilike("smtp_probe:%"))
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/notifications/activity/smtp-healthcheck", response_model=SMTPHealthCheckOut)
async def smtp_healthcheck(
    data: SMTPHealthCheckIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("admin", "manager") and not bool(current_user.can_manage_team):
        raise HTTPException(status_code=403, detail="Only admin/manager can run SMTP health check")

    recipient = (data.recipient or current_user.email or "").strip().lower()
    if "@" not in recipient:
        raise HTTPException(status_code=400, detail="Recipient email is invalid")

    source = "smtp_healthcheck"
    subject = "PlannerBro SMTP health-check"
    body = (
        f"SMTP health-check from PlannerBro.\n"
        f"Requested by: {current_user.email}\n"
        f"Time (UTC): {datetime.now(timezone.utc).isoformat()}"
    )
    await _send_email_to_recipients(
        db,
        recipients=[recipient],
        subject=subject,
        body=body,
        source=source,
        payload={"kind": "smtp_healthcheck", "initiator": current_user.email},
    )
    return SMTPHealthCheckOut(
        ok=True,
        recipient=recipient,
        source=source,
        message="SMTP health-check sent (see activity log for final status).",
    )


@router.post("/notifications/activity/client-error", status_code=202)
async def report_client_error(
    data: ClientErrorReportIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await log_system_activity(
        db,
        source="frontend",
        category="frontend_error",
        level="error",
        message=data.message,
        details={
            "user_id": current_user.id,
            "user_email": current_user.email,
            "url": data.url,
            "user_agent": data.user_agent,
            "stack": data.stack,
            "context": data.context or {},
        },
        commit=True,
    )
    return {"status": "accepted"}


@router.get("/notifications/report-settings", response_model=ReportDispatchSettingsOut)
async def get_report_settings(
    current_user: User = Depends(get_current_user),
):
    if not _can_manage_reports(current_user):
        raise HTTPException(status_code=403, detail="Only admin/manager can read report settings")
    settings_data = await get_report_dispatch_settings()
    return ReportDispatchSettingsOut(**settings_data)


@router.put("/notifications/report-settings", response_model=ReportDispatchSettingsOut)
async def put_report_settings(
    data: ReportDispatchSettingsUpdateIn,
    current_user: User = Depends(get_current_user),
):
    if not _can_manage_reports(current_user):
        raise HTTPException(status_code=403, detail="Only admin/manager can update report settings")
    updated = await update_report_dispatch_settings(
        telegram_summaries_enabled=data.telegram_summaries_enabled,
        email_analytics_enabled=data.email_analytics_enabled,
        email_analytics_recipients=data.email_analytics_recipients,
        digest_filters=data.digest_filters.model_dump() if data.digest_filters else None,
    )
    return ReportDispatchSettingsOut(**updated)


@router.get("/notifications/report-delivery/status", response_model=ReportDeliveryStatusOut)
async def get_report_delivery_status(
    hours: int = Query(default=24, ge=1, le=168),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_reports(current_user):
        raise HTTPException(status_code=403, detail="Only admin/manager can read report delivery status")

    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    email_rows = (
        await db.execute(
            select(EmailDispatchLog.status, EmailDispatchLog.created_at)
            .where(
                EmailDispatchLog.created_at >= cutoff,
                EmailDispatchLog.source.ilike("analytics_email_digest%"),
            )
            .order_by(EmailDispatchLog.created_at.desc())
        )
    ).all()

    email_sent = sum(1 for status, _ in email_rows if status == "sent")
    email_failed = sum(1 for status, _ in email_rows if status == "failed")
    email_skipped = sum(1 for status, _ in email_rows if status == "skipped")
    last_email_sent_at = next((created_at for status, created_at in email_rows if status == "sent"), None)

    telegram_rows = (
        await db.execute(
            select(SystemActivityLog.level, SystemActivityLog.message, SystemActivityLog.created_at)
            .where(
                SystemActivityLog.created_at >= cutoff,
                SystemActivityLog.source == "telegram_bot",
                or_(
                    SystemActivityLog.message.ilike("Telegram projects summary%"),
                    SystemActivityLog.message.ilike("Telegram critical tasks summary%"),
                ),
            )
            .order_by(SystemActivityLog.created_at.desc())
        )
    ).all()

    telegram_sent = sum(1 for _, message, _ in telegram_rows if "sent" in message.lower())
    telegram_failed = sum(1 for level, _, _ in telegram_rows if level == "error")
    last_telegram_sent_at = next(
        (created_at for _, message, created_at in telegram_rows if "sent" in message.lower()),
        None,
    )

    return ReportDeliveryStatusOut(
        generated_at=datetime.now(timezone.utc),
        window_hours=hours,
        email_sent=email_sent,
        email_failed=email_failed,
        email_skipped=email_skipped,
        telegram_sent=telegram_sent,
        telegram_failed=telegram_failed,
        last_email_sent_at=last_email_sent_at,
        last_telegram_sent_at=last_telegram_sent_at,
    )


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
