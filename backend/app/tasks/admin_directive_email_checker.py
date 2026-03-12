import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
from zoneinfo import ZoneInfo

from sqlalchemy import exists, or_, select

from app.core.database import AsyncSessionLocal
from app.models.project import Project
from app.models.task import Task, TaskAssignee
from app.services.notification_service import _send_email_to_recipients
from app.services.report_settings_service import (
    claim_schedule_slot_once,
    get_admin_directive_settings,
)
from app.services.system_activity_service import log_system_activity_standalone
from app.tasks.celery_app import celery_app


@dataclass(slots=True)
class IssueRow:
    task_title: str
    project_name: str
    status: str
    end_date: date | None
    updated_at: datetime


_WINDOWS: dict[str, tuple[int, int]] = {
    "06:00-09:00": (6, 9),
    "09:00-12:00": (9, 12),
    "12:00-15:00": (12, 15),
    "15:00-18:00": (15, 18),
}
_WEEKDAYS: dict[str, int] = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}
_LOCAL_TZ = ZoneInfo("Asia/Yekaterinburg")


def _parse_recipients(raw: str | None) -> list[str]:
    items = []
    for token in (raw or "").split(","):
        email = token.strip().lower()
        if "@" in email and email not in items:
            items.append(email)
    return items


def _is_recipient_due_in_window(
    *,
    recipient: str,
    days: list[str],
    time_window: str,
    now_utc: datetime | None = None,
) -> tuple[bool, str]:
    now_local = (now_utc or datetime.now(timezone.utc)).astimezone(_LOCAL_TZ)
    if not days:
        return False, "No weekdays selected"
    weekday_set = {_WEEKDAYS[d] for d in days if d in _WEEKDAYS}
    if now_local.weekday() not in weekday_set:
        return False, "Not selected weekday"

    bounds = _WINDOWS.get(time_window)
    if not bounds:
        return False, "Invalid time window"
    start_hour, end_hour = bounds
    if now_local.hour < start_hour or now_local.hour >= end_hour:
        return False, "Outside selected time window"

    total_minutes = (end_hour - start_hour) * 60
    buckets = max(1, total_minutes // 5)
    elapsed_minutes = (now_local.hour - start_hour) * 60 + now_local.minute
    current_bucket = min(buckets - 1, max(0, elapsed_minutes // 5))
    digest = hashlib.sha256(f"{recipient}:{now_local.date().isoformat()}:{time_window}".encode("utf-8")).hexdigest()
    recipient_bucket = int(digest[:8], 16) % buckets
    if recipient_bucket != current_bucket:
        return False, "Queued for another slot"

    slot_stamp = f"{now_local.date().isoformat()}:{time_window}:b{recipient_bucket}"
    return True, slot_stamp


def _format_issue_lines(rows: list[IssueRow], limit: int = 25) -> list[str]:
    lines: list[str] = []
    for row in rows[:limit]:
        deadline = row.end_date.isoformat() if row.end_date else "no-deadline"
        updated = row.updated_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
        lines.append(f"- [{row.project_name}] {row.task_title} (status={row.status}, deadline={deadline}, updated={updated})")
    if len(rows) > limit:
        lines.append(f"... и еще {len(rows) - limit}")
    return lines


async def _collect_admin_issues(db, include_overdue: bool, include_stale: bool, stale_days: int, include_unassigned: bool):
    base_query = (
        select(Task.title, Project.name, Task.status, Task.end_date, Task.updated_at)
        .join(Project, Project.id == Task.project_id)
        .where(Task.status != "done")
        .order_by(Task.updated_at.asc())
    )

    overdue: list[IssueRow] = []
    stale: list[IssueRow] = []
    unassigned: list[IssueRow] = []

    if include_overdue:
        rows = (
            await db.execute(
                base_query.where(
                    Task.end_date.is_not(None),
                    Task.end_date < date.today(),
                )
            )
        ).all()
        overdue = [IssueRow(*row) for row in rows]

    if include_stale:
        cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, stale_days))
        rows = (
            await db.execute(
                base_query.where(Task.updated_at <= cutoff)
            )
        ).all()
        stale = [IssueRow(*row) for row in rows]

    if include_unassigned:
        has_multi_assignee = exists(select(TaskAssignee.task_id).where(TaskAssignee.task_id == Task.id))
        rows = (
            await db.execute(
                base_query.where(
                    Task.assigned_to_id.is_(None),
                    ~has_multi_assignee,
                    or_(
                        Task.status == "todo",
                        Task.status == "in_progress",
                        Task.status == "planning",
                        Task.status == "tz",
                        Task.status == "testing",
                        Task.status == "review",
                    ),
                )
            )
        ).all()
        unassigned = [IssueRow(*row) for row in rows]

    return overdue, stale, unassigned


async def send_admin_directive_once(force: bool = False, override_recipient: str | None = None) -> dict:
    settings_data = await get_admin_directive_settings()
    enabled = bool(settings_data.get("enabled", False))
    recipients = _parse_recipients(override_recipient or str(settings_data.get("recipient") or ""))
    if not recipients:
        recipients = ["aerokamero@gmail.com"]
    primary_recipient = recipients[0]

    if not enabled and not force:
        return {
            "ok": True,
            "recipient": primary_recipient,
            "sent": False,
            "overdue_count": 0,
            "stale_count": 0,
            "unassigned_count": 0,
            "message": "Admin directive is disabled",
        }

    days = [str(day).strip().lower() for day in (settings_data.get("days") or [])]
    time_window = str(settings_data.get("time_window") or "09:00-12:00")

    include_overdue = bool(settings_data.get("include_overdue", True))
    include_stale = bool(settings_data.get("include_stale", True))
    stale_days = int(settings_data.get("stale_days", 7))
    include_unassigned = bool(settings_data.get("include_unassigned", True))
    custom_text = str(settings_data.get("custom_text") or "").strip()

    async with AsyncSessionLocal() as db:
        overdue, stale, unassigned = await _collect_admin_issues(
            db,
            include_overdue=include_overdue,
            include_stale=include_stale,
            stale_days=stale_days,
            include_unassigned=include_unassigned,
        )

        any_findings = bool(overdue or stale or unassigned)
        if not any_findings and not custom_text and not force:
            return {
                "ok": True,
                "recipient": primary_recipient,
                "sent": False,
                "overdue_count": 0,
                "stale_count": 0,
                "unassigned_count": 0,
                "message": "No issues matched selected criteria",
            }

        now_local = datetime.now(timezone.utc).astimezone()
        subject = f"PlannerBro · Директивная рассылка · {now_local.strftime('%d.%m.%Y %H:%M')}"
        lines: list[str] = [
            "Директивная сводка PlannerBro",
            f"Время: {now_local.strftime('%d.%m.%Y %H:%M %Z')}",
            "",
            f"Просроченные задачи: {len(overdue)}",
            f"Без движения >= {stale_days} дн.: {len(stale)}",
            f"Без назначений: {len(unassigned)}",
        ]
        if custom_text:
            lines.extend(["", "Комментарий администратора:", custom_text])
        if overdue:
            lines.extend(["", "Просроченные:"])
            lines.extend(_format_issue_lines(overdue))
        if stale:
            lines.extend(["", f"Без движения >= {stale_days} дн.:"])
            lines.extend(_format_issue_lines(stale))
        if unassigned:
            lines.extend(["", "Без назначений:"])
            lines.extend(_format_issue_lines(unassigned))
        if force and not any_findings:
            lines.extend(["", "Тестовая отправка: по выбранным критериям задач не найдено."])

        body = "\n".join(lines)
        sent_recipients = 0
        for recipient in recipients:
            if not force:
                due, slot_stamp = _is_recipient_due_in_window(
                    recipient=recipient,
                    days=days,
                    time_window=time_window,
                )
                if not due:
                    continue
                if not await claim_schedule_slot_once(
                    channel="email",
                    recipient_key=recipient,
                    digest_key="admin_directive",
                    slot_stamp=slot_stamp,
                ):
                    continue
            await _send_email_to_recipients(
                db,
                recipients=[recipient],
                subject=subject,
                body=body,
                source="admin_directive_digest",
                payload={
                    "forced": force,
                    "overdue_count": len(overdue),
                    "stale_count": len(stale),
                    "unassigned_count": len(unassigned),
                    "time_window": time_window,
                },
            )
            sent_recipients += 1

        if sent_recipients == 0 and not force:
            return {
                "ok": True,
                "recipient": primary_recipient,
                "sent": False,
                "overdue_count": len(overdue),
                "stale_count": len(stale),
                "unassigned_count": len(unassigned),
                "message": "No recipients in current queue slot",
            }

    return {
        "ok": True,
        "recipient": primary_recipient,
        "sent": True,
        "overdue_count": len(overdue),
        "stale_count": len(stale),
        "unassigned_count": len(unassigned),
        "message": "Sent",
    }


@celery_app.task(name="app.tasks.admin_directive_email_checker.send_admin_directive_email")
def send_admin_directive_email(force: bool = False):
    result = asyncio.run(send_admin_directive_once(force=force))
    asyncio.run(
        log_system_activity_standalone(
            source="admin_directive_email",
            category="email",
            level="info",
            message="Admin directive email checker tick",
            details=result,
        )
    )
