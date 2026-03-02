from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.project import Project, ProjectDepartment, ProjectMember
from app.models.task import Task
from app.models.user import User
from app.services.access_scope import get_user_access_scope
from app.services.telegram_service import escape_html

PROJECT_STATUS_LABEL: dict[str, str] = {
    "planning": "Планирование",
    "tz": "ТЗ",
    "active": "В работе",
    "testing": "Тестирование",
    "on_hold": "На паузе",
    "completed": "Завершен",
}

VALID_PRIORITIES = {"low", "medium", "high", "critical"}
DEFAULT_DIGEST_PRIORITIES = ["high", "critical"]


@dataclass(slots=True)
class DigestFilters:
    deadline_window_days: int = 5
    priorities: list[str] | None = None
    include_control_ski: bool = True
    include_escalations: bool = True
    include_without_deadline: bool = False


@dataclass(slots=True)
class DigestAudience:
    key: str
    label: str
    user_ids: set[str]
    department_ids: set[str]
    include_all: bool = False


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
    audience_label: str
    active_projects_count: int
    completed_projects_count: int
    overdue_projects_count: int
    critical_tasks_count: int
    overdue_critical_count: int
    due_soon_critical_count: int
    escalations_count: int
    top_projects: list[ProjectDigestItem]
    focus_tasks: list[CriticalTaskDigestItem]


def normalize_digest_filters(raw: dict | None) -> DigestFilters:
    raw = raw or {}
    deadline_window = raw.get("deadline_window_days", 5)
    try:
        deadline_window = max(0, min(60, int(deadline_window)))
    except (TypeError, ValueError):
        deadline_window = 5

    raw_priorities = raw.get("priorities") or DEFAULT_DIGEST_PRIORITIES
    if not isinstance(raw_priorities, list):
        raw_priorities = DEFAULT_DIGEST_PRIORITIES
    priorities = [str(item).lower() for item in raw_priorities if str(item).lower() in VALID_PRIORITIES]
    if not priorities:
        priorities = list(DEFAULT_DIGEST_PRIORITIES)

    return DigestFilters(
        deadline_window_days=deadline_window,
        priorities=priorities,
        include_control_ski=bool(raw.get("include_control_ski", True)),
        include_escalations=bool(raw.get("include_escalations", True)),
        include_without_deadline=bool(raw.get("include_without_deadline", False)),
    )


def filters_to_dict(filters: DigestFilters) -> dict[str, object]:
    return {
        "deadline_window_days": filters.deadline_window_days,
        "priorities": list(filters.priorities or DEFAULT_DIGEST_PRIORITIES),
        "include_control_ski": filters.include_control_ski,
        "include_escalations": filters.include_escalations,
        "include_without_deadline": filters.include_without_deadline,
    }


def _project_url(project_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}"


def _task_url(project_id: str, task_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}?task={task_id}"


def _quick_action_links() -> dict[str, str]:
    base = settings.APP_WEB_URL.rstrip("/")
    return {
        "dashboard": f"{base}/dashboard",
        "projects": f"{base}/projects",
        "analytics": f"{base}/analytics",
    }


async def _resolve_digest_audience(db: AsyncSession, viewer: User | None) -> DigestAudience:
    if viewer is None:
        all_user_ids = set(
            (await db.execute(select(User.id).where(User.is_active == True))).scalars().all()  # noqa: E712
        )
        return DigestAudience(
            key="global",
            label="Полный контур",
            user_ids=all_user_ids,
            department_ids=set(),
            include_all=True,
        )

    if viewer.role == "admin":
        all_user_ids = set(
            (await db.execute(select(User.id).where(User.is_active == True))).scalars().all()  # noqa: E712
        )
        return DigestAudience(
            key=f"user:{viewer.id}",
            label="Контур директора",
            user_ids=all_user_ids,
            department_ids=set(),
            include_all=True,
        )

    if viewer.role == "manager" or bool(viewer.can_manage_team):
        scope = await get_user_access_scope(db, viewer)
        return DigestAudience(
            key=f"user:{viewer.id}",
            label="Контур отдела и команды",
            user_ids=set(scope.user_ids),
            department_ids=set(scope.department_ids),
            include_all=False,
        )

    department_ids = {viewer.department_id} if viewer.department_id else set()
    return DigestAudience(
        key=f"user:{viewer.id}",
        label="Персональный контур",
        user_ids={viewer.id},
        department_ids=department_ids,
        include_all=False,
    )


async def _resolve_scoped_project_ids(db: AsyncSession, audience: DigestAudience) -> set[str]:
    if audience.include_all:
        return set((await db.execute(select(Project.id))).scalars().all())

    project_ids: set[str] = set()
    if audience.user_ids:
        project_ids.update(
            (await db.execute(select(Project.id).where(Project.owner_id.in_(audience.user_ids)))).scalars().all()
        )
        project_ids.update(
            (
                await db.execute(
                    select(ProjectMember.project_id).where(ProjectMember.user_id.in_(audience.user_ids))
                )
            ).scalars().all()
        )
        project_ids.update(
            (
                await db.execute(
                    select(Task.project_id).where(
                        or_(
                            Task.assigned_to_id.in_(audience.user_ids),
                            Task.created_by_id.in_(audience.user_ids),
                        )
                    )
                )
            ).scalars().all()
        )

    if audience.department_ids:
        project_ids.update(
            (
                await db.execute(
                    select(ProjectDepartment.project_id).where(
                        ProjectDepartment.department_id.in_(audience.department_ids)
                    )
                )
            ).scalars().all()
        )

    return {pid for pid in project_ids if pid}


def _is_focus_task(task: Task, today: date, filters: DigestFilters) -> bool:
    if _is_task_completed(task):
        return False

    is_critical_signal = (
        task.priority in set(filters.priorities or DEFAULT_DIGEST_PRIORITIES)
        or (filters.include_control_ski and task.control_ski)
        or (filters.include_escalations and task.is_escalation)
    )
    if not is_critical_signal:
        return False

    if task.end_date is None:
        return filters.include_without_deadline

    delta_days = (task.end_date - today).days
    if delta_days < 0:
        return True
    return delta_days <= filters.deadline_window_days


def _is_task_completed(task: Task) -> bool:
    return task.status == "done" or int(task.progress_percent or 0) >= 100


def _is_project_completed(project: Project, project_tasks: list[Task]) -> bool:
    if project.status == "completed":
        return True
    if not project_tasks:
        return False
    return all(_is_task_completed(task) for task in project_tasks)


async def collect_analytics_digest(
    db: AsyncSession,
    compact: bool = False,
    viewer: User | None = None,
    filters: DigestFilters | None = None,
) -> AnalyticsDigest:
    filters = filters or DigestFilters()
    now_local = datetime.now(ZoneInfo(settings.TELEGRAM_TIMEZONE))
    today = now_local.date()

    audience = await _resolve_digest_audience(db, viewer)
    scoped_project_ids = await _resolve_scoped_project_ids(db, audience)

    if not scoped_project_ids:
        return AnalyticsDigest(
            now_local=now_local,
            timezone_name=settings.TELEGRAM_TIMEZONE,
            audience_label=audience.label,
            active_projects_count=0,
            completed_projects_count=0,
            overdue_projects_count=0,
            critical_tasks_count=0,
            overdue_critical_count=0,
            due_soon_critical_count=0,
            escalations_count=0,
            top_projects=[],
            focus_tasks=[],
        )

    projects = (
        await db.execute(
            select(Project)
            .where(Project.id.in_(scoped_project_ids))
            .options(selectinload(Project.owner))
        )
    ).scalars().all()

    users = (await db.execute(select(User.id, User.name, User.is_active))).all()
    active_users = {uid: name for uid, name, is_active in users if is_active}

    all_project_tasks = (
        await db.execute(select(Task).where(Task.project_id.in_(scoped_project_ids)))
    ).scalars().all()
    active_project_tasks = [t for t in all_project_tasks if not _is_task_completed(t)]

    tasks_by_project: dict[str, list[Task]] = defaultdict(list)
    for task in all_project_tasks:
        tasks_by_project[task.project_id].append(task)

    active_projects = [p for p in projects if not _is_project_completed(p, tasks_by_project.get(p.id, []))]
    completed_projects = [p for p in projects if _is_project_completed(p, tasks_by_project.get(p.id, []))]
    overdue_projects = [p for p in active_projects if p.end_date and p.end_date < today]

    ranked_projects = sorted(
        active_projects,
        key=lambda p: (
            0 if p.end_date and p.end_date < today else 1,
            p.end_date.isoformat() if p.end_date else "9999-12-31",
            p.name.lower(),
        ),
    )[: (5 if compact else 10)]

    top_projects: list[ProjectDigestItem] = []
    for project in ranked_projects:
        ptasks = tasks_by_project.get(project.id, [])
        total = len(ptasks)
        done = sum(1 for t in ptasks if _is_task_completed(t))
        overdue = sum(1 for t in ptasks if not _is_task_completed(t) and t.end_date and t.end_date < today)
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

    focus_candidates = [t for t in active_project_tasks if _is_focus_task(t, today, filters)]
    overdue_critical = [t for t in focus_candidates if t.end_date and t.end_date < today]
    due_soon_critical = [
        t
        for t in focus_candidates
        if t.end_date and 0 <= (t.end_date - today).days <= filters.deadline_window_days
    ]
    escalations = [t for t in focus_candidates if t.is_escalation]

    ranked_tasks = sorted(
        focus_candidates,
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
        audience_label=audience.label,
        active_projects_count=len(active_projects),
        completed_projects_count=len(completed_projects),
        overdue_projects_count=len(overdue_projects),
        critical_tasks_count=len(focus_candidates),
        overdue_critical_count=len(overdue_critical),
        due_soon_critical_count=len(due_soon_critical),
        escalations_count=len(escalations),
        top_projects=top_projects,
        focus_tasks=focus_tasks,
    )


def build_digest_fingerprint(digest: AnalyticsDigest, section: str = "all") -> str:
    payload: dict[str, object] = {
        "section": section,
        "audience": digest.audience_label,
        "active_projects_count": digest.active_projects_count,
        "completed_projects_count": digest.completed_projects_count,
        "overdue_projects_count": digest.overdue_projects_count,
        "critical_tasks_count": digest.critical_tasks_count,
        "overdue_critical_count": digest.overdue_critical_count,
        "due_soon_critical_count": digest.due_soon_critical_count,
        "escalations_count": digest.escalations_count,
    }

    if section in {"all", "projects"}:
        payload["projects"] = [
            {
                "id": p.id,
                "done": p.done_tasks,
                "total": p.total_tasks,
                "overdue": p.overdue_tasks,
                "end_date": p.end_date.isoformat() if p.end_date else None,
            }
            for p in digest.top_projects
        ]

    if section in {"all", "critical"}:
        payload["focus_tasks"] = [
            {
                "id": t.id,
                "end_date": t.end_date.isoformat() if t.end_date else None,
                "priority": t.priority,
                "updated_at": t.updated_at.isoformat(),
            }
            for t in digest.focus_tasks
        ]

    data = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def format_telegram_projects_digest(digest: AnalyticsDigest, compact: bool = False) -> str:
    lines: list[str] = []
    for project in digest.top_projects:
        lines.append(
            f"• <a href=\"{_project_url(project.id)}\">{escape_html(project.name)}</a> — "
            f"{escape_html(project.status)} | задач {project.done_tasks}/{project.total_tasks} | "
            f"просрочено {project.overdue_tasks} | отв. {escape_html(project.owner_name)}"
        )

    quick = _quick_action_links()
    quick_actions = (
        f"<a href=\"{quick['dashboard']}\">Дэшборд</a> · "
        f"<a href=\"{quick['projects']}\">Проекты</a> · "
        f"<a href=\"{quick['analytics']}\">Аналитика</a>"
    )

    text = (
        f"<b>PlannerBro · Сводка по проектам</b>\n"
        f"👥 {escape_html(digest.audience_label)}\n"
        f"🕒 {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})\n\n"
        f"Текущих проектов: <b>{digest.active_projects_count}</b>\n"
        f"Просроченных проектов: <b>{digest.overdue_projects_count}</b>\n"
    )
    if not compact:
        text += f"Завершенных: <b>{digest.completed_projects_count}</b>\n"

    text += (
        f"\n<b>{'Краткий список' if compact else 'Топ проектов'}:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет проектов'}\n\n"
        f"🔗 {quick_actions}"
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

    quick = _quick_action_links()
    return (
        f"<b>PlannerBro · Критические задачи</b>\n"
        f"👥 {escape_html(digest.audience_label)}\n"
        f"🕒 {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})\n\n"
        f"Текущих критических/СКИ: <b>{digest.critical_tasks_count}</b>\n"
        f"Просрочено: <b>{digest.overdue_critical_count}</b>\n"
        f"Дедлайн ≤5 дней: <b>{digest.due_soon_critical_count}</b>\n"
        f"Эскалаций: <b>{digest.escalations_count}</b>\n\n"
        f"<b>{'Краткий фокус-лист' if compact else 'Фокус-лист'}:</b>\n"
        f"{chr(10).join(lines) if lines else '• Нет критических задач'}\n\n"
        f"🔗 <a href=\"{quick['dashboard']}\">Дэшборд</a> · "
        f"<a href=\"{quick['analytics']}\">Аналитика</a>"
    )


def format_email_digest_subject(digest: AnalyticsDigest) -> str:
    return f"PlannerBro аналитика · {digest.now_local.strftime('%d.%m.%Y %H:%M')}"


def format_email_digest_text(
    digest: AnalyticsDigest,
    compact: bool = False,
    include_projects: bool = True,
    include_critical: bool = True,
) -> str:
    links = _quick_action_links()
    lines = [
        "PlannerBro · Единый аналитический дайджест",
        f"Контур: {digest.audience_label}",
        f"Время: {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({digest.timezone_name})",
        "",
    ]
    if include_projects:
        lines.extend([
            f"Проекты активные: {digest.active_projects_count}",
            f"Проекты просроченные: {digest.overdue_projects_count}",
        ])
    if include_critical:
        lines.extend([
            f"Критические/СКИ задачи: {digest.critical_tasks_count}",
            f"Просроченные критические: {digest.overdue_critical_count}",
            f"Критические с дедлайном <=5 дней: {digest.due_soon_critical_count}",
            f"Эскалации: {digest.escalations_count}",
        ])
    lines.extend([
        "",
        "Быстрые действия:",
        f"- Дэшборд: {links['dashboard']}",
        f"- Проекты: {links['projects']}",
        f"- Аналитика: {links['analytics']}",
        "",
    ])

    if include_projects:
        lines.append("Топ проектов:")
        for p in digest.top_projects[: (5 if compact else 10)]:
            lines.append(
                f"- {p.name} | {p.status} | задач {p.done_tasks}/{p.total_tasks} | "
                f"просрочено {p.overdue_tasks} | отв. {p.owner_name} | {_project_url(p.id)}"
            )
        lines.append("")

    if include_critical:
        lines.append("Фокус-задачи:")
        for t in digest.focus_tasks[: (8 if compact else 15)]:
            due = t.end_date.isoformat() if t.end_date else "без дедлайна"
            lines.append(
                f"- {t.title} ({t.project_name}) | дедлайн {due} | отв. {t.assignee_name} | "
                f"{_task_url(t.project_id, t.id)}"
            )

    return "\n".join(lines)


def format_email_digest_html(
    digest: AnalyticsDigest,
    compact: bool = False,
    include_projects: bool = True,
    include_critical: bool = True,
) -> str:
    projects_rows = "".join(
        [
            "<tr>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(p.name)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(p.status)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{p.done_tasks}/{p.total_tasks}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{p.overdue_tasks}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(p.owner_name)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\"><a href=\"{_project_url(p.id)}\" style=\"color:#6d28d9;text-decoration:none;\">Открыть</a></td>"
            "</tr>"
            for p in digest.top_projects[: (5 if compact else 10)]
        ]
    ) if include_projects else ""

    task_rows = "".join(
        [
            "<tr>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(t.title)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(t.project_name)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(t.assignee_name)}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\">{escape_html(t.end_date.isoformat() if t.end_date else 'без дедлайна')}</td>"
            f"<td style=\"padding:10px;border-bottom:1px solid #e5e7eb;\"><a href=\"{_task_url(t.project_id, t.id)}\" style=\"color:#6d28d9;text-decoration:none;\">Открыть</a></td>"
            "</tr>"
            for t in digest.focus_tasks[: (8 if compact else 15)]
        ]
    ) if include_critical else ""

    links = _quick_action_links()
    stats_cells: list[str] = []
    if include_projects:
        stats_cells.extend([
            f"<td style=\"width:25%;padding:10px;border:1px solid #e5e7eb;border-radius:10px;\"><div style=\"font-size:12px;color:#6b7280;\">Активные проекты</div><div style=\"font-size:24px;font-weight:700;\">{digest.active_projects_count}</div></td>",
            f"<td style=\"width:25%;padding:10px 10px 10px 14px;\"><div style=\"border:1px solid #e5e7eb;border-radius:10px;padding:10px;\"><div style=\"font-size:12px;color:#6b7280;\">Просроченные проекты</div><div style=\"font-size:24px;font-weight:700;color:#b91c1c;\">{digest.overdue_projects_count}</div></div></td>",
        ])
    if include_critical:
        stats_cells.extend([
            f"<td style=\"width:25%;padding:10px;\"><div style=\"border:1px solid #e5e7eb;border-radius:10px;padding:10px;\"><div style=\"font-size:12px;color:#6b7280;\">Критические/СКИ</div><div style=\"font-size:24px;font-weight:700;color:#7c3aed;\">{digest.critical_tasks_count}</div></div></td>",
            f"<td style=\"width:25%;padding:10px;\"><div style=\"border:1px solid #e5e7eb;border-radius:10px;padding:10px;\"><div style=\"font-size:12px;color:#6b7280;\">Эскалации</div><div style=\"font-size:24px;font-weight:700;color:#ea580c;\">{digest.escalations_count}</div></div></td>",
        ])

    projects_block = (
        "<tr><td style=\"padding:0 24px 20px;\">"
        "<div style=\"font-size:16px;font-weight:700;margin-bottom:8px;\">Прогресс по проектам</div>"
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;\">"
        "<tr style=\"background:#f9fafb;\"><th align=\"left\" style=\"padding:10px;\">Проект</th><th align=\"left\" style=\"padding:10px;\">Статус</th><th align=\"left\" style=\"padding:10px;\">Задачи</th><th align=\"left\" style=\"padding:10px;\">Просрочено</th><th align=\"left\" style=\"padding:10px;\">Ответственный</th><th align=\"left\" style=\"padding:10px;\">Ссылка</th></tr>"
        f"{projects_rows or '<tr><td colspan=\"6\" style=\"padding:12px;\">Нет данных</td></tr>'}"
        "</table>"
        "</td></tr>"
    ) if include_projects else ""

    critical_block = (
        "<tr><td style=\"padding:0 24px 24px;\">"
        "<div style=\"font-size:16px;font-weight:700;margin-bottom:8px;\">Фокус-задачи</div>"
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;\">"
        "<tr style=\"background:#f9fafb;\"><th align=\"left\" style=\"padding:10px;\">Задача</th><th align=\"left\" style=\"padding:10px;\">Проект</th><th align=\"left\" style=\"padding:10px;\">Ответственный</th><th align=\"left\" style=\"padding:10px;\">Дедлайн</th><th align=\"left\" style=\"padding:10px;\">Ссылка</th></tr>"
        f"{task_rows or '<tr><td colspan=\"5\" style=\"padding:12px;\">Нет данных</td></tr>'}"
        "</table>"
        "</td></tr>"
    ) if include_critical else ""

    return (
        "<html><body style=\"margin:0;background:#f6f7fb;font-family:Segoe UI,Arial,sans-serif;color:#111827;\">"
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"padding:24px 0;\"><tr><td align=\"center\">"
        "<table width=\"840\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;\">"
        "<tr><td style=\"padding:22px 24px;background:linear-gradient(120deg,#f5f3ff,#eef2ff);border-bottom:1px solid #e5e7eb;\">"
        "<div style=\"font-size:22px;font-weight:700;color:#111827;\">PlannerBro · Аналитический дайджест</div>"
        f"<div style=\"margin-top:6px;color:#374151;\">{escape_html(digest.audience_label)} · {digest.now_local.strftime('%d.%m.%Y %H:%M')} ({escape_html(digest.timezone_name)})</div>"
        "<div style=\"margin-top:14px;\">"
        f"<a href=\"{links['dashboard']}\" style=\"display:inline-block;padding:8px 14px;border-radius:8px;background:#6d28d9;color:#fff;text-decoration:none;margin-right:8px;\">Открыть дэшборд</a>"
        f"<a href=\"{links['projects']}\" style=\"display:inline-block;padding:8px 14px;border-radius:8px;background:#0f172a;color:#fff;text-decoration:none;margin-right:8px;\">Проекты</a>"
        f"<a href=\"{links['analytics']}\" style=\"display:inline-block;padding:8px 14px;border-radius:8px;background:#1f2937;color:#fff;text-decoration:none;\">Аналитика</a>"
        "</div>"
        "</td></tr>"
        "<tr><td style=\"padding:20px 24px;\">"
        "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>"
        + "".join(stats_cells)
        + "</tr></table>"
        "</td></tr>"
        f"{projects_block}"
        f"{critical_block}"
        "</table></td></tr></table></body></html>"
    )
