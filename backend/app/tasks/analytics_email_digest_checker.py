import asyncio

from sqlalchemy import or_, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.analytics_digest_service import (
    collect_analytics_digest,
    format_email_digest_subject,
    format_email_digest_text,
)
from app.services.notification_service import _send_email_to_recipients
from app.services.report_settings_service import (
    get_email_analytics_enabled,
    get_email_analytics_recipients,
)
from app.services.system_activity_service import log_system_activity_standalone
from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.analytics_email_digest_checker.send_email_analytics_digest")
def send_email_analytics_digest(compact: bool = False, force: bool = False):
    asyncio.run(_async_send_email_analytics_digest(compact=compact, force=force))


def _explicit_recipients() -> list[str]:
    raw = (settings.EMAIL_ANALYTICS_RECIPIENTS or "").strip()
    if not raw:
        return []
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


async def _recipients_from_team(db) -> list[str]:
    rows = (
        await db.execute(
            select(User.email, User.work_email)
            .where(
                User.is_active == True,  # noqa: E712
                or_(
                    User.role.in_(("admin", "manager")),
                    User.can_manage_team == True,  # noqa: E712
                ),
            )
        )
    ).all()
    recipients: list[str] = []
    for email, work_email in rows:
        target = (work_email or email or "").strip().lower()
        if target:
            recipients.append(target)
    return recipients


async def _async_send_email_analytics_digest(compact: bool = False, force: bool = False) -> None:
    runtime_enabled = await get_email_analytics_enabled()
    if not runtime_enabled and not force:
        return

    async with AsyncSessionLocal() as db:
        digest = await collect_analytics_digest(db, compact=compact)

        runtime_recipients = await get_email_analytics_recipients()
        recipients = [item.strip().lower() for item in runtime_recipients.split(",") if item.strip()]
        if not recipients:
            recipients = _explicit_recipients()
        recipients.extend(await _recipients_from_team(db))
        recipients = list(dict.fromkeys(recipients))
        if not recipients:
            return

        subject = format_email_digest_subject(digest)
        body = format_email_digest_text(digest, compact=compact)
        await _send_email_to_recipients(
            db,
            recipients,
            subject,
            body,
            source="analytics_email_digest",
            payload={
                "compact": compact,
                "force": force,
                "projects_count": digest.active_projects_count,
                "critical_tasks_count": digest.critical_tasks_count,
                "recipients": len(recipients),
            },
        )

    try:
        await log_system_activity_standalone(
            source="analytics_email",
            category="email",
            level="info",
            message="Analytics email digest sent",
            details={
                "compact": compact,
                "force": force,
                "projects_count": digest.active_projects_count,
                "critical_tasks_count": digest.critical_tasks_count,
                "recipients": len(recipients),
            },
        )
    except Exception:
        # keep task resilient; email send already completed
        pass
