"""Nightly proactive risk scan — no LLM, purely mechanical.

Runs daily at 08:00 UTC. Scans all active projects for risk signals and
sends a consolidated Telegram alert only when real issues are found.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.project import Project
from app.models.task import Task
from app.services.system_activity_service import log_system_activity_standalone
from app.services.task_lock_service import acquire_task_run_lock
from app.services.telegram_service import send_telegram_message
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

_ACTIVE_STATUSES = {"planning", "tz", "active", "testing", "on_hold"}
_RISK_THRESHOLD_OVERDUE = 2      # projects with ≥ this many overdue tasks get flagged
_RISK_THRESHOLD_STALE = 2        # projects with ≥ this many stale tasks get flagged
_STALE_DAYS = 7


@celery_app.task(name="app.tasks.ai_risk_scan_checker.run_ai_risk_scan")
def run_ai_risk_scan():
    asyncio.run(_async_run())


async def _async_run() -> None:
    if not await acquire_task_run_lock("ai_risk_scan", ttl_seconds=23 * 3600):
        return

    try:
        await _scan_and_notify()
    except Exception as exc:
        logger.error("ai_risk_scan failed: %s", exc, exc_info=True)
        await log_system_activity_standalone(
            source="ai_risk_scan",
            category="task_error",
            level="error",
            message=f"Nightly risk scan failed: {exc}",
        )


async def _scan_and_notify() -> None:
    today = date.today()
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=_STALE_DAYS)

    async with AsyncSessionLocal() as db:
        projects = (
            await db.execute(
                select(Project).where(Project.status.in_(_ACTIVE_STATUSES))
            )
        ).scalars().all()

        if not projects:
            return

        risk_lines: list[str] = []
        clean_names: list[str] = []

        for project in projects:
            tasks = (
                await db.execute(
                    select(Task)
                    .where(Task.project_id == project.id)
                    .options(selectinload(Task.assignee))
                )
            ).scalars().all()

            active_tasks = [t for t in tasks if t.status != "done"]
            if not active_tasks:
                continue

            overdue = [
                t for t in active_tasks
                if t.end_date and t.end_date < today
            ]
            critical_overdue = [t for t in overdue if t.priority in ("high", "critical")]

            stale = []
            for t in active_tasks:
                if t.status != "in_progress":
                    continue
                last = t.last_check_in_at or getattr(t, "created_at", None)
                if last and last < stale_cutoff:
                    stale.append(t)

            unassigned_with_deadline = [
                t for t in active_tasks
                if not t.assigned_to_id and t.end_date
            ]

            has_risk = (
                len(overdue) >= _RISK_THRESHOLD_OVERDUE
                or len(stale) >= _RISK_THRESHOLD_STALE
                or len(critical_overdue) >= 1
            )

            if not has_risk:
                clean_names.append(project.name)
                continue

            bullets: list[str] = []
            if overdue:
                crit_note = f", из них {len(critical_overdue)} крит." if critical_overdue else ""
                bullets.append(f"• {len(overdue)} просроч. задач{crit_note}")
            if stale:
                bullets.append(f"• {len(stale)} зависших in_progress >{_STALE_DAYS} дн.")
            if unassigned_with_deadline:
                bullets.append(f"• {len(unassigned_with_deadline)} без исполнителя с дедлайном")

            total = len(active_tasks)
            done_pct = round((len(tasks) - total) / len(tasks) * 100) if tasks else 0
            risk_lines.append(
                f"📌 <b>{project.name}</b> ({done_pct}% выполнено):\n" + "\n".join(bullets)
            )

    if not risk_lines:
        return  # nothing to report — silence is golden

    now_str = datetime.now(timezone.utc).strftime("%d.%m.%Y %H:%M UTC")
    header = f"🔍 <b>Ночной скан рисков</b> — {now_str}\n\n🔴 Проекты с рисками ({len(risk_lines)}):\n"
    body = "\n\n".join(risk_lines)
    footer = ""
    if clean_names:
        footer = f"\n\n✅ Без рисков: {', '.join(clean_names[:8])}"

    message = header + body + footer
    await send_telegram_message(message[:4096])
    await log_system_activity_standalone(
        source="ai_risk_scan",
        category="risk_scan",
        level="info",
        message=f"Risk scan complete: {len(risk_lines)} risky projects, {len(clean_names)} clean",
    )
