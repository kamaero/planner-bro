import asyncio

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.analytics_digest_service import (
    build_digest_fingerprint,
    collect_analytics_digest,
    format_telegram_critical_digest,
    format_telegram_projects_digest,
    normalize_digest_filters,
)
from app.services.report_settings_service import get_report_digest_filters, should_send_digest
from app.services.report_settings_service import (
    claim_schedule_slot_once,
    evaluate_schedule_due,
    get_report_dispatch_schedule,
)
from app.services.telegram_service import (
    get_summaries_enabled,
    send_telegram_message,
)
from app.services.system_activity_service import log_system_activity_standalone
from app.tasks.celery_app import celery_app


def _is_enabled() -> bool:
    return (
        settings.TELEGRAM_BOT_ENABLED
        and bool(settings.TELEGRAM_BOT_TOKEN.strip())
        and bool(settings.TELEGRAM_CHAT_ID.strip())
    )


@celery_app.task(name="app.tasks.telegram_summary_checker.send_projects_summary")
def send_projects_summary(compact: bool = False, force: bool = False):
    asyncio.run(_async_send_projects_summary(compact=compact, force=force))


@celery_app.task(name="app.tasks.telegram_summary_checker.send_critical_tasks_summary")
def send_critical_tasks_summary(compact: bool = False, force: bool = False):
    asyncio.run(_async_send_critical_tasks_summary(compact=compact, force=force))


async def _async_send_projects_summary(compact: bool = False, force: bool = False) -> None:
    if not _is_enabled():
        return
    if not force and not await get_summaries_enabled():
        return
    dispatch_schedule = await get_report_dispatch_schedule()
    if not force and not bool(dispatch_schedule.get("telegram_projects_enabled", True)):
        return

    filters_raw = await get_report_digest_filters()
    filters = normalize_digest_filters(filters_raw)
    anti_noise_enabled = bool(filters_raw.get("anti_noise_enabled", True))
    anti_noise_ttl_minutes = int(filters_raw.get("anti_noise_ttl_minutes", 360))

    slot_stamp: str | None = None
    if not force:
        is_due, due_stamp = evaluate_schedule_due(dispatch_schedule, "telegram_projects_slots")
        if not is_due:
            return
        slot_stamp = due_stamp

    async with AsyncSessionLocal() as db:
        if slot_stamp and not await claim_schedule_slot_once(
            channel="telegram",
            recipient_key=settings.TELEGRAM_CHAT_ID.strip(),
            digest_key="projects",
            slot_stamp=slot_stamp,
        ):
            return
        digest = await collect_analytics_digest(db, compact=compact, filters=filters)
    fingerprint = build_digest_fingerprint(digest, section="projects")

    if anti_noise_enabled and not force:
        can_send = await should_send_digest(
            channel="telegram",
            recipient_key=settings.TELEGRAM_CHAT_ID.strip(),
            digest_key="projects",
            fingerprint=fingerprint,
            ttl_minutes=anti_noise_ttl_minutes,
        )
        if not can_send:
            await log_system_activity_standalone(
                source="telegram_bot",
                category="telegram",
                level="info",
                message="Telegram projects summary skipped by anti-noise",
                details={"compact": compact, "force": force},
            )
            return

    text = format_telegram_projects_digest(digest, compact=compact)
    try:
        await send_telegram_message(text)
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram",
            level="info",
            message="Telegram projects summary sent",
            details={"compact": compact, "force": force, "projects_count": digest.active_projects_count},
        )
    except Exception as exc:
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram_error",
            level="error",
            message="Telegram projects summary failed",
            details={"compact": compact, "force": force, "error": str(exc)},
        )


async def _async_send_critical_tasks_summary(compact: bool = False, force: bool = False) -> None:
    if not _is_enabled():
        return
    if not force and not await get_summaries_enabled():
        return
    dispatch_schedule = await get_report_dispatch_schedule()
    if not force and not bool(dispatch_schedule.get("telegram_critical_enabled", True)):
        return

    filters_raw = await get_report_digest_filters()
    filters = normalize_digest_filters(filters_raw)
    anti_noise_enabled = bool(filters_raw.get("anti_noise_enabled", True))
    anti_noise_ttl_minutes = int(filters_raw.get("anti_noise_ttl_minutes", 360))

    slot_stamp: str | None = None
    if not force:
        is_due, due_stamp = evaluate_schedule_due(dispatch_schedule, "telegram_critical_slots")
        if not is_due:
            return
        slot_stamp = due_stamp

    async with AsyncSessionLocal() as db:
        if slot_stamp and not await claim_schedule_slot_once(
            channel="telegram",
            recipient_key=settings.TELEGRAM_CHAT_ID.strip(),
            digest_key="critical",
            slot_stamp=slot_stamp,
        ):
            return
        digest = await collect_analytics_digest(db, compact=compact, filters=filters)
    fingerprint = build_digest_fingerprint(digest, section="critical")

    if anti_noise_enabled and not force:
        can_send = await should_send_digest(
            channel="telegram",
            recipient_key=settings.TELEGRAM_CHAT_ID.strip(),
            digest_key="critical",
            fingerprint=fingerprint,
            ttl_minutes=anti_noise_ttl_minutes,
        )
        if not can_send:
            await log_system_activity_standalone(
                source="telegram_bot",
                category="telegram",
                level="info",
                message="Telegram critical tasks summary skipped by anti-noise",
                details={"compact": compact, "force": force},
            )
            return

    text = format_telegram_critical_digest(digest, compact=compact)
    try:
        await send_telegram_message(text)
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram",
            level="info",
            message="Telegram critical tasks summary sent",
            details={"compact": compact, "force": force, "tasks_count": digest.critical_tasks_count},
        )
    except Exception as exc:
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram_error",
            level="error",
            message="Telegram critical tasks summary failed",
            details={"compact": compact, "force": force, "error": str(exc)},
        )
