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
from app.services.telegram_service import escape_html, send_telegram_message
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
def send_projects_summary():
    asyncio.run(_async_send_projects_summary())


@celery_app.task(name="app.tasks.telegram_summary_checker.send_critical_tasks_summary")
def send_critical_tasks_summary():
    asyncio.run(_async_send_critical_tasks_summary())


async def _async_send_projects_summary() -> None:
    if not _is_enabled():
        return

    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    async with AsyncSessionLocal() as db:
        projects = (
            await db.execute(select(Project).options(selectinload(Project.owner)))
        ).scalars().all()
        tasks = (await db.execute(select(Task))).scalars().all()

    tasks_by_project: dict[str, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_project[task.project_id].append(task)

    active_count = sum(1 for p in projects if p.status != "completed")
    completed_count = sum(1 for p in projects if p.status == "completed")
    overdue_projects = [
        p for p in projects if p.status != "completed" and p.end_date and p.end_date < today
    ]

    top_lines: list[str] = []
    ranked_projects = sorted(
        projects,
        key=lambda p: (
            0 if p.status != "completed" else 1,
            p.end_date.isoformat() if p.end_date else "9999-12-31",
        ),
    )[:10]
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
        f"Всего проектов: <b>{len(projects)}</b>\n"
        f"Активных: <b>{active_count}</b>\n"
        f"Завершенных: <b>{completed_count}</b>\n"
        f"Просроченных проектов: <b>{len(overdue_projects)}</b>\n\n"
        f"<b>Топ проектов:</b>\n"
        f"{chr(10).join(top_lines) if top_lines else '• Нет проектов'}"
    )
    await send_telegram_message(text)


async def _async_send_critical_tasks_summary() -> None:
    if not _is_enabled():
        return

    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    async with AsyncSessionLocal() as db:
        tasks = (
            await db.execute(
                select(Task)
                .where(
                    Task.status != "done",
                    (Task.priority == "critical") | (Task.control_ski == True),  # noqa: E712
                )
            )
        ).scalars().all()
        projects = (await db.execute(select(Project.id, Project.name))).all()
        users = (await db.execute(select(User.id, User.name))).all()

    project_map = {pid: name for pid, name in projects}
    user_map = {uid: name for uid, name in users}

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
    )[:15]

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
        f"Открытых критических/СКИ: <b>{len(tasks)}</b>\n"
        f"Просрочено: <b>{len(overdue)}</b>\n"
        f"Дедлайн ≤5 дней: <b>{len(due_soon)}</b>\n"
        f"Эскалаций: <b>{len(escalations)}</b>\n\n"
        f"<b>Фокус-лист:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет критических задач'}"
    )
    await send_telegram_message(text)

