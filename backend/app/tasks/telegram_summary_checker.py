import asyncio

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.services.analytics_digest_service import (
    collect_analytics_digest,
    format_telegram_critical_digest,
    format_telegram_projects_digest,
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

    async with AsyncSessionLocal() as db:
        digest = await collect_analytics_digest(db, compact=compact)
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

    async with AsyncSessionLocal() as db:
        digest = await collect_analytics_digest(db, compact=compact)
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
