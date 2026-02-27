import asyncio
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.services.telegram_service import (
    escape_html,
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


def _project_url(project_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}"


def _task_url(task: Task) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{task.project_id}?task={task.id}"


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

    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    async with AsyncSessionLocal() as db:
        projects = (
            await db.execute(
                select(Project)
                .where(Project.status != "completed")
                .options(selectinload(Project.owner))
            )
        ).scalars().all()
        users = (await db.execute(select(User.id, User.is_active))).all()
        tasks = (
            await db.execute(
                select(Task).where(
                    Task.status != "done",
                    Task.assigned_to_id.is_not(None),
                )
            )
        ).scalars().all()

    active_user_ids = {uid for uid, is_active in users if is_active}
    tasks = [task for task in tasks if task.assigned_to_id in active_user_ids]

    tasks_by_project: dict[str, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_project[task.project_id].append(task)

    filtered_projects = [p for p in projects if p.owner_id in active_user_ids]
    assigned_project_ids = {pid for pid, ptasks in tasks_by_project.items() if ptasks}
    filtered_projects = [p for p in filtered_projects if p.id in assigned_project_ids]

    active_count = len(filtered_projects)
    completed_count = 0
    overdue_projects = [
        p for p in filtered_projects if p.end_date and p.end_date < today
    ]

    top_lines: list[str] = []
    ranked_projects = sorted(
        filtered_projects,
        key=lambda p: (
            p.end_date.isoformat() if p.end_date else "9999-12-31",
        ),
    )[: (5 if compact else 10)]
    for project in ranked_projects:
        ptasks = tasks_by_project.get(project.id, [])
        total = len(ptasks)
        done = sum(1 for t in ptasks if t.status == "done")
        overdue = sum(1 for t in ptasks if t.status != "done" and t.end_date and t.end_date < today)
        owner = project.owner.name if project.owner else "—"
        top_lines.append(
            f"• <a href=\"{_project_url(project.id)}\">{escape_html(project.name)}</a> — "
            f"{escape_html(project.status)} | задач {done}/{total} | просрочено {overdue} | отв. {escape_html(owner)}"
        )

    text = (
        f"<b>PlannerBro · Сводка по проектам</b>\n"
        f"🕒 {now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(settings.TELEGRAM_TIMEZONE)})\n\n"
        f"Текущих проектов (с назначениями): <b>{active_count}</b>\n"
        f"Просроченных проектов: <b>{len(overdue_projects)}</b>\n"
    )
    if not compact:
        text += f"Завершенных: <b>{completed_count}</b>\n"
    text += (
        f"\n<b>{'Краткий список' if compact else 'Топ проектов'}:</b>\n"
        f"{chr(10).join(top_lines) if top_lines else '• Нет проектов'}"
    )
    try:
        await send_telegram_message(text)
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram",
            level="info",
            message="Telegram projects summary sent",
            details={"compact": compact, "force": force, "projects_count": active_count},
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

    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    async with AsyncSessionLocal() as db:
        tasks = (
            await db.execute(
                select(Task)
                .join(Project, Task.project_id == Project.id)
                .where(
                    Project.status != "completed",
                    Task.status != "done",
                    Task.assigned_to_id.is_not(None),
                    (Task.priority == "critical") | (Task.control_ski == True),  # noqa: E712
                )
            )
        ).scalars().all()
        projects = (await db.execute(select(Project.id, Project.name))).all()
        users = (await db.execute(select(User.id, User.name, User.is_active))).all()

    project_map = {pid: name for pid, name in projects}
    user_map = {uid: name for uid, name, is_active in users if is_active}
    tasks = [task for task in tasks if task.assigned_to_id in user_map]

    overdue = [t for t in tasks if t.end_date and t.end_date < today]
    due_soon = [t for t in tasks if t.end_date and 0 <= (t.end_date - today).days <= 5]
    escalations = [t for t in tasks if t.is_escalation]

    ranked = sorted(
        tasks,
        key=lambda t: (
            0 if t.end_date and t.end_date < today else 1,
            t.end_date.isoformat() if t.end_date else "9999-12-31",
            t.updated_at.isoformat(),
        ),
    )[: (8 if compact else 15)]

    lines: list[str] = []
    for task in ranked:
        project_name = project_map.get(task.project_id, "Проект")
        assignee = user_map.get(task.assigned_to_id, "не назначен")
        due = task.end_date.isoformat() if task.end_date else "без дедлайна"
        lines.append(
            f"• <a href=\"{_task_url(task)}\">{escape_html(task.title)}</a> "
            f"({escape_html(project_name)}) — дедлайн {escape_html(due)}, отв. {escape_html(assignee)}"
        )

    text = (
        f"<b>PlannerBro · Критические задачи</b>\n"
        f"🕒 {now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(settings.TELEGRAM_TIMEZONE)})\n\n"
        f"Текущих критических/СКИ (с назначениями): <b>{len(tasks)}</b>\n"
        f"Просрочено: <b>{len(overdue)}</b>\n"
        f"Дедлайн ≤5 дней: <b>{len(due_soon)}</b>\n"
        f"Эскалаций: <b>{len(escalations)}</b>\n\n"
        f"<b>{'Краткий фокус-лист' if compact else 'Фокус-лист'}:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет критических задач'}"
    )
    try:
        await send_telegram_message(text)
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram",
            level="info",
            message="Telegram critical tasks summary sent",
            details={"compact": compact, "force": force, "tasks_count": len(tasks)},
        )
    except Exception as exc:
        await log_system_activity_standalone(
            source="telegram_bot",
            category="telegram_error",
            level="error",
            message="Telegram critical tasks summary failed",
            details={"compact": compact, "force": force, "error": str(exc)},
        )
