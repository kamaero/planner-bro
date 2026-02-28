from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.services.telegram_service import escape_html


PROJECT_STATUS_LABEL: dict[str, str] = {
    "planning": "Планирование",
    "tz": "ТЗ",
    "active": "В работе",
    "testing": "Тестирование",
    "on_hold": "На паузе",
    "completed": "Завершен",
}


@dataclass(slots=True)
class ProjectDigestItem:
    id: str
    name: str
    status: str
    owner_name: str
    total_tasks: int
    done_tasks: int
    overdue_tasks: int
    end_date: date | None


@dataclass(slots=True)
class CriticalTaskDigestItem:
    id: str
    title: str
    project_id: str
    project_name: str
    assignee_name: str
    end_date: date | None
    priority: str
    control_ski: bool
    is_escalation: bool
    updated_at: datetime


@dataclass(slots=True)
class AnalyticsDigest:
    now_local: datetime
    timezone_name: str
    active_projects_count: int
    completed_projects_count: int
    overdue_projects_count: int
    critical_tasks_count: int
    overdue_critical_count: int
    due_soon_critical_count: int
    escalations_count: int
    top_projects: list[ProjectDigestItem]
    focus_tasks: list[CriticalTaskDigestItem]


def _project_url(project_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}"


def _task_url(project_id: str, task_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}?task={task_id}"


async def collect_analytics_digest(db: AsyncSession, compact: bool = False) -> AnalyticsDigest:
    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    projects = (
        await db.execute(
            select(Project)
            .where(Project.status != "completed")
            .options(selectinload(Project.owner))
        )
    ).scalars().all()

    users = (await db.execute(select(User.id, User.name, User.is_active))).all()
    active_users = {uid: name for uid, name, is_active in users if is_active}

    active_tasks = (
        await db.execute(
            select(Task).where(
                Task.status != "done",
                Task.assigned_to_id.is_not(None),
            )
        )
    ).scalars().all()
    active_tasks = [t for t in active_tasks if (t.assigned_to_id in active_users)]

    critical_tasks = [
        t
        for t in active_tasks
        if t.priority == "critical" or t.control_ski
    ]

    tasks_by_project: dict[str, list[Task]] = defaultdict(list)
    for task in active_tasks:
        tasks_by_project[task.project_id].append(task)

    active_project_ids = {pid for pid, ptasks in tasks_by_project.items() if ptasks}
    projects = [p for p in projects if p.owner_id in active_users and p.id in active_project_ids]

    overdue_projects = [p for p in projects if p.end_date and p.end_date < today]

    ranked_projects = sorted(
        projects,
        key=lambda p: (p.end_date.isoformat() if p.end_date else "9999-12-31",),
    )[: (5 if compact else 10)]

    top_projects: list[ProjectDigestItem] = []
    for project in ranked_projects:
        ptasks = tasks_by_project.get(project.id, [])
        total = len(ptasks)
        done = sum(1 for t in ptasks if t.status == "done")
        overdue = sum(1 for t in ptasks if t.status != "done" and t.end_date and t.end_date < today)
        top_projects.append(
            ProjectDigestItem(
                id=project.id,
                name=project.name,
                status=PROJECT_STATUS_LABEL.get(project.status, project.status),
                owner_name=project.owner.name if project.owner else "—",
                total_tasks=total,
                done_tasks=done,
                overdue_tasks=overdue,
                end_date=project.end_date,
            )
        )

    overdue_critical = [t for t in critical_tasks if t.end_date and t.end_date < today]
    due_soon_critical = [t for t in critical_tasks if t.end_date and 0 <= (t.end_date - today).days <= 5]
    escalations = [t for t in critical_tasks if t.is_escalation]

    ranked_tasks = sorted(
        critical_tasks,
        key=lambda t: (
            0 if t.end_date and t.end_date < today else 1,
            t.end_date.isoformat() if t.end_date else "9999-12-31",
            t.updated_at.isoformat(),
        ),
    )[: (8 if compact else 15)]

    project_name_by_id = {p.id: p.name for p in projects}
    focus_tasks: list[CriticalTaskDigestItem] = []
    for task in ranked_tasks:
        focus_tasks.append(
            CriticalTaskDigestItem(
                id=task.id,
                title=task.title,
                project_id=task.project_id,
                project_name=project_name_by_id.get(task.project_id, "Проект"),
                assignee_name=active_users.get(task.assigned_to_id or "", "не назначен"),
                end_date=task.end_date,
                priority=task.priority,
                control_ski=task.control_ski,
                is_escalation=task.is_escalation,
                updated_at=task.updated_at,
            )
        )

    return AnalyticsDigest(
        now_local=now_local,
        timezone_name=settings.TELEGRAM_TIMEZONE,
        active_projects_count=len(projects),
        completed_projects_count=0,
        overdue_projects_count=len(overdue_projects),
        critical_tasks_count=len(critical_tasks),
        overdue_critical_count=len(overdue_critical),
        due_soon_critical_count=len(due_soon_critical),
        escalations_count=len(escalations),
        top_projects=top_projects,
        focus_tasks=focus_tasks,
    )


def format_telegram_projects_digest(digest: AnalyticsDigest, compact: bool = False) -> str:
    lines: list[str] = []
    for project in digest.top_projects:
        lines.append(
            f"• <a href=\"{_project_url(project.id)}\">{escape_html(project.name)}</a> — "
            f"{escape_html(project.status)} | задач {project.done_tasks}/{project.total_tasks} | "
            f"просрочено {project.overdue_tasks} | отв. {escape_html(project.owner_name)}"
        )

    text = (
        f"<b>PlannerBro · Сводка по проектам</b>\n"
        f"🕒 {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})\n\n"
        f"Текущих проектов (с назначениями): <b>{digest.active_projects_count}</b>\n"
        f"Просроченных проектов: <b>{digest.overdue_projects_count}</b>\n"
    )
    if not compact:
        text += f"Завершенных: <b>{digest.completed_projects_count}</b>\n"

    text += (
        f"\n<b>{'Краткий список' if compact else 'Топ проектов'}:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет проектов'}"
    )
    return text


def format_telegram_critical_digest(digest: AnalyticsDigest, compact: bool = False) -> str:
    lines: list[str] = []
    for task in digest.focus_tasks:
        due = task.end_date.isoformat() if task.end_date else "без дедлайна"
        lines.append(
            f"• <a href=\"{_task_url(task.project_id, task.id)}\">{escape_html(task.title)}</a> "
            f"({escape_html(task.project_name)}) — дедлайн {escape_html(due)}, "
            f"отв. {escape_html(task.assignee_name)}"
        )

    return (
        f"<b>PlannerBro · Критические задачи</b>\n"
        f"🕒 {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})\n\n"
        f"Текущих критических/СКИ (с назначениями): <b>{digest.critical_tasks_count}</b>\n"
        f"Просрочено: <b>{digest.overdue_critical_count}</b>\n"
        f"Дедлайн ≤5 дней: <b>{digest.due_soon_critical_count}</b>\n"
        f"Эскалаций: <b>{digest.escalations_count}</b>\n\n"
        f"<b>{'Краткий фокус-лист' if compact else 'Фокус-лист'}:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет критических задач'}"
    )


def format_email_digest_subject(digest: AnalyticsDigest) -> str:
    return f"PlannerBro аналитика · {digest.now_local.strftime('%d.%m.%Y %H:%M')}"


def format_email_digest_text(digest: AnalyticsDigest, compact: bool = False) -> str:
    lines = [
        "PlannerBro · Единый аналитический дайджест",
        f"Время: {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({digest.timezone_name})",
        "",
        f"Проекты активные: {digest.active_projects_count}",
        f"Проекты просроченные: {digest.overdue_projects_count}",
        f"Критические/СКИ задачи: {digest.critical_tasks_count}",
        f"Просроченные критические: {digest.overdue_critical_count}",
        f"Критические с дедлайном <=5 дней: {digest.due_soon_critical_count}",
        f"Эскалации: {digest.escalations_count}",
        "",
        "Топ проектов:",
    ]

    for p in digest.top_projects[: (5 if compact else 10)]:
        lines.append(
            f"- {p.name} | {p.status} | задач {p.done_tasks}/{p.total_tasks} | "
            f"просрочено {p.overdue_tasks} | отв. {p.owner_name} | {_project_url(p.id)}"
        )

    lines.append("")
    lines.append("Фокус-задачи:")
    for t in digest.focus_tasks[: (8 if compact else 15)]:
        due = t.end_date.isoformat() if t.end_date else "без дедлайна"
        lines.append(
            f"- {t.title} ({t.project_name}) | дедлайн {due} | отв. {t.assignee_name} | "
            f"{_task_url(t.project_id, t.id)}"
        )

    return "\n".join(lines)


def format_email_digest_html(digest: AnalyticsDigest, compact: bool = False) -> str:
    projects_rows = "".join(
        [
            "<tr>"
            f"<td>{escape_html(p.name)}</td>"
            f"<td>{escape_html(p.status)}</td>"
            f"<td>{p.done_tasks}/{p.total_tasks}</td>"
            f"<td>{p.overdue_tasks}</td>"
            f"<td>{escape_html(p.owner_name)}</td>"
            f"<td><a href=\"{_project_url(p.id)}\">Открыть</a></td>"
            "</tr>"
            for p in digest.top_projects[: (5 if compact else 10)]
        ]
    )

    task_rows = "".join(
        [
            "<tr>"
            f"<td>{escape_html(t.title)}</td>"
            f"<td>{escape_html(t.project_name)}</td>"
            f"<td>{escape_html(t.assignee_name)}</td>"
            f"<td>{escape_html(t.end_date.isoformat() if t.end_date else 'без дедлайна')}</td>"
            f"<td><a href=\"{_task_url(t.project_id, t.id)}\">Открыть</a></td>"
            "</tr>"
            for t in digest.focus_tasks[: (8 if compact else 15)]
        ]
    )

    return (
        "<html><body style=\"font-family:Arial,sans-serif\">"
        f"<h2>PlannerBro · Единый аналитический дайджест</h2>"
        f"<p>Время: {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})</p>"
        "<ul>"
        f"<li>Проекты активные: <b>{digest.active_projects_count}</b></li>"
        f"<li>Проекты просроченные: <b>{digest.overdue_projects_count}</b></li>"
        f"<li>Критические/СКИ задачи: <b>{digest.critical_tasks_count}</b></li>"
        f"<li>Просроченные критические: <b>{digest.overdue_critical_count}</b></li>"
        f"<li>Критические с дедлайном ≤5 дней: <b>{digest.due_soon_critical_count}</b></li>"
        f"<li>Эскалации: <b>{digest.escalations_count}</b></li>"
        "</ul>"
        "<h3>Топ проектов</h3>"
        "<table border=\"1\" cellspacing=\"0\" cellpadding=\"6\">"
        "<tr><th>Проект</th><th>Статус</th><th>Задачи</th><th>Просрочено</th><th>Ответственный</th><th>Ссылка</th></tr>"
        f"{projects_rows or '<tr><td colspan=\"6\">Нет данных</td></tr>'}"
        "</table>"
        "<h3 style=\"margin-top:16px\">Фокус-задачи</h3>"
        "<table border=\"1\" cellspacing=\"0\" cellpadding=\"6\">"
        "<tr><th>Задача</th><th>Проект</th><th>Ответственный</th><th>Дедлайн</th><th>Ссылка</th></tr>"
        f"{task_rows or '<tr><td colspan=\"5\">Нет данных</td></tr>'}"
        "</table>"
        "</body></html>"
    )
