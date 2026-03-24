"""Weekly AI digest — runs every Monday at 08:00 UTC.

For each active project, calls the AI analysis service and sends
the result to Telegram as a structured digest.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.project import Project
from app.services.ai_project_manager_service import analyze_project
from app.services.system_activity_service import log_system_activity_standalone
from app.services.task_lock_service import acquire_task_run_lock
from app.services.telegram_service import send_telegram_message
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = {"planning", "tz", "active", "testing", "on_hold"}


@celery_app.task(name="app.tasks.ai_weekly_digest_checker.send_weekly_ai_digest")
def send_weekly_ai_digest():
    asyncio.run(_async_run())


async def _async_run() -> None:
    if not await acquire_task_run_lock("ai_weekly_digest", ttl_seconds=6 * 24 * 3600):
        return
    try:
        await _generate_and_send()
    except Exception as exc:
        logger.error("ai_weekly_digest failed: %s", exc, exc_info=True)
        await log_system_activity_standalone(
            source="ai_weekly_digest",
            category="task_error",
            level="error",
            message=f"Weekly AI digest failed: {exc}",
        )


async def _generate_and_send() -> None:
    async with AsyncSessionLocal() as db:
        projects = (
            await db.execute(
                select(Project)
                .where(Project.status.in_(_ACTIVE_STATUSES))
                .order_by(Project.name)
            )
        ).scalars().all()

    if not projects:
        return

    now_str = datetime.now(timezone.utc).strftime("%d.%m.%Y")
    intro = f"📊 <b>Еженедельный AI-дайджест</b> — {now_str}\n{len(projects)} активных проектов"
    await send_telegram_message(intro)

    ok_count = 0
    fail_count = 0

    for project in projects:
        try:
            async with AsyncSessionLocal() as db:
                result = await analyze_project(db, project.id)

            stats = result["stats"]
            header = (
                f"📌 <b>{result['project_name']}</b>\n"
                f"Задач: {stats['total_tasks']} | "
                f"Выполнено: {stats['done_percent']}% | "
                f"Просрочено: {stats['overdue_count']} | "
                f"Зависших: {stats['stale_count']}"
            )
            # Telegram message limit is 4096; reserve space for header
            analysis_trimmed = result["analysis"][:3800]
            message = f"{header}\n\n{analysis_trimmed}"
            await send_telegram_message(message)
            ok_count += 1

        except Exception as exc:
            logger.warning("AI digest failed for project %s: %s", project.id, exc)
            fail_count += 1
            await send_telegram_message(
                f"⚠️ Не удалось проанализировать проект «{project.name}»: {str(exc)[:200]}"
            )

    summary = f"✅ AI-дайджест завершён: {ok_count} проектов проанализировано"
    if fail_count:
        summary += f", {fail_count} ошибок"
    await send_telegram_message(summary)

    await log_system_activity_standalone(
        source="ai_weekly_digest",
        category="ai_digest",
        level="info",
        message=f"Weekly digest sent: {ok_count} ok, {fail_count} failed",
    )
