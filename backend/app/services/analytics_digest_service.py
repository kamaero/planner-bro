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
    assigned_to_id: str | None
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
                assigned_to_id=task.assigned_to_id,
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


_ROLE_SUBJECT_MAP = {
    "Контур директора": "Директорский дайджест",
    "Контур отдела и команды": "Дайджест отдела",
    "Персональный контур": "Ваш дайджест",
    "Полный контур": "Полный дайджест",
}


def format_email_digest_subject(digest: AnalyticsDigest) -> str:
    label = _ROLE_SUBJECT_MAP.get(digest.audience_label, "Аналитический дайджест")
    date_str = digest.now_local.strftime("%d.%m.%Y")
    alerts = []
    if digest.overdue_projects_count:
        alerts.append(f"просрочено проектов: {digest.overdue_projects_count}")
    if digest.overdue_critical_count:
        alerts.append(f"крит. задач: {digest.overdue_critical_count}")
    suffix = f" · ⚠ {', '.join(alerts)}" if alerts else ""
    return f"PlannerBro · {label} · {date_str}{suffix}"


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


def _priority_chip(priority: str) -> str:
    colors = {
        "critical": ("#7f1d1d", "#fef2f2"),
        "high": ("#92400e", "#fffbeb"),
        "medium": ("#1e40af", "#eff6ff"),
        "low": ("#374151", "#f3f4f6"),
    }
    labels = {"critical": "КРИТ", "high": "ВЫСОК", "medium": "СРЕДН", "low": "НИЗК"}
    fg, bg = colors.get(priority, ("#374151", "#f3f4f6"))
    label = labels.get(priority, priority.upper())
    return (
        f'<span style="display:inline-block;padding:2px 7px;border-radius:4px;'
        f'font-size:10px;font-weight:700;letter-spacing:.5px;'
        f'background:{bg};color:{fg};">{label}</span>'
    )


def _status_chip(status: str) -> str:
    colors = {
        "В работе": ("#065f46", "#d1fae5"),
        "Планирование": ("#1e40af", "#dbeafe"),
        "ТЗ": ("#5b21b6", "#ede9fe"),
        "Тестирование": ("#0369a1", "#e0f2fe"),
        "На паузе": ("#78350f", "#fef3c7"),
        "Завершен": ("#374151", "#f3f4f6"),
    }
    fg, bg = colors.get(status, ("#374151", "#f3f4f6"))
    return (
        f'<span style="display:inline-block;padding:2px 8px;border-radius:4px;'
        f'font-size:11px;font-weight:600;background:{bg};color:{fg};">'
        f'{escape_html(status)}</span>'
    )


def _progress_bar(done: int, total: int) -> str:
    pct = int(done / total * 100) if total else 0
    bar_color = "#22c55e" if pct >= 80 else "#f59e0b" if pct >= 40 else "#ef4444"
    return (
        f'<div style="font-size:11px;color:#6b7280;margin-bottom:3px;">'
        f'{done}/{total} задач ({pct}%)</div>'
        f'<div style="background:#e5e7eb;border-radius:4px;height:6px;width:120px;">'
        f'<div style="background:{bar_color};border-radius:4px;height:6px;width:{pct}%;"></div>'
        f'</div>'
    )


def _kpi_card(label: str, value: int, color: str = "#111827", width: str = "25%") -> str:
    return (
        f'<td style="width:{width};padding:6px;">'
        f'<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;">'
        f'<div style="font-size:11px;color:#6b7280;margin-bottom:4px;">{label}</div>'
        f'<div style="font-size:26px;font-weight:700;color:{color};">{value}</div>'
        f'</div></td>'
    )


def _cta_btn(href: str, label: str, bg: str = "#6d28d9", fg: str = "#ffffff") -> str:
    return (
        f'<a href="{href}" style="display:inline-block;padding:7px 13px;border-radius:7px;'
        f'background:{bg};color:{fg};text-decoration:none;font-size:12px;font-weight:600;'
        f'margin-right:6px;">{label}</a>'
    )


def _role_header_text(audience_label: str) -> str:
    texts = {
        "Контур директора": "Полный срез системы — проекты, критические задачи, риски.",
        "Контур отдела и команды": "Срез по вашему отделу и подчинённым — проекты и задачи в зоне ответственности.",
        "Персональный контур": "Ваши назначенные задачи и проекты — то, что требует вашего внимания.",
        "Полный контур": "Системный дайджест — полный контур всех проектов и задач.",
    }
    return texts.get(audience_label, "Аналитический дайджест PlannerBro.")


def _role_badge(audience_label: str) -> str:
    badges = {
        "Контур директора": ("ДИРЕКТОР", "#1e3a5f", "#dbeafe"),
        "Контур отдела и команды": ("РУКОВОДИТЕЛЬ", "#3b0764", "#f3e8ff"),
        "Персональный контур": ("ИСПОЛНИТЕЛЬ", "#052e16", "#dcfce7"),
        "Полный контур": ("СИСТЕМА", "#1c1917", "#f5f5f4"),
    }
    label, fg, bg = badges.get(audience_label, ("—", "#374151", "#f3f4f6"))
    return (
        f'<span style="display:inline-block;padding:3px 10px;border-radius:5px;'
        f'font-size:11px;font-weight:700;letter-spacing:.8px;'
        f'background:{bg};color:{fg};">{label}</span>'
    )


def format_email_digest_html(
    digest: AnalyticsDigest,
    compact: bool = False,
    include_projects: bool = True,
    include_critical: bool = True,
    viewer_user_id: str | None = None,
) -> str:
    from app.services.email_actions import action_url

    links = _quick_action_links()
    today = digest.now_local.date()
    limit_projects = 5 if compact else 10
    limit_tasks = 8 if compact else 15

    # ── KPI cards ──────────────────────────────────────────────────────────────
    kpi_cells: list[str] = []
    if include_projects:
        kpi_cells.append(_kpi_card("Активные проекты", digest.active_projects_count))
        kpi_cells.append(
            _kpi_card(
                "Просрочено проектов",
                digest.overdue_projects_count,
                color="#b91c1c" if digest.overdue_projects_count else "#111827",
            )
        )
    if include_critical:
        kpi_cells.append(
            _kpi_card("Критических / СКИ", digest.critical_tasks_count, color="#7c3aed")
        )
        kpi_cells.append(
            _kpi_card(
                "Эскалаций",
                digest.escalations_count,
                color="#ea580c" if digest.escalations_count else "#111827",
            )
        )

    kpi_row = (
        '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
        + "".join(kpi_cells)
        + "</tr></table>"
    )

    # ── Projects table ─────────────────────────────────────────────────────────
    def _project_row(p: ProjectDigestItem) -> str:
        is_overdue = bool(p.end_date and p.end_date < today)
        row_bg = '#fff5f5' if is_overdue else '#ffffff'
        deadline_cell = (
            f'<span style="color:#b91c1c;font-weight:600;">'
            f'{"⚠ " + p.end_date.strftime("%d.%m") if p.end_date else "—"}</span>'
            if is_overdue
            else (p.end_date.strftime("%d.%m.%Y") if p.end_date else "—")
        )
        return (
            f'<tr style="background:{row_bg};">'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;max-width:200px;">'
            f'<a href="{_project_url(p.id)}" style="color:#111827;font-weight:600;text-decoration:none;">'
            f'{escape_html(p.name)}</a></td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">{_status_chip(p.status)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">{_progress_bar(p.done_tasks, p.total_tasks)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;">{escape_html(p.owner_name)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;">{deadline_cell}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">'
            + _cta_btn(_project_url(p.id), "Открыть →", bg="#111827")
            + "</td></tr>"
        )

    projects_block = ""
    if include_projects:
        rows = "".join(_project_row(p) for p in digest.top_projects[:limit_projects])
        projects_block = (
            '<tr><td style="padding:0 24px 24px;">'
            '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:10px;">Проекты</div>'
            '<table width="100%" cellpadding="0" cellspacing="0" '
            'style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:13px;">'
            '<tr style="background:#f9fafb;">'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Проект</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Статус</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Прогресс</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Ответственный</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Дедлайн</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;"></th>'
            "</tr>"
            + (rows or '<tr><td colspan="6" style="padding:14px;color:#9ca3af;">Нет активных проектов</td></tr>')
            + "</table></td></tr>"
        )

    # ── Tasks table ────────────────────────────────────────────────────────────
    def _task_row(t: CriticalTaskDigestItem) -> str:
        is_overdue = bool(t.end_date and t.end_date < today)
        row_bg = "#fff5f5" if is_overdue else "#ffffff"
        if t.end_date:
            if is_overdue:
                delta = (today - t.end_date).days
                deadline_str = f'<span style="color:#b91c1c;font-weight:600;">⚠ просрочено {delta} дн.</span>'
            else:
                delta = (t.end_date - today).days
                color = "#d97706" if delta <= 2 else "#374151"
                deadline_str = f'<span style="color:{color};">{t.end_date.strftime("%d.%m.%Y")}</span>'
        else:
            deadline_str = '<span style="color:#9ca3af;">без дедлайна</span>'

        # Action buttons
        btn_open = _cta_btn(_task_url(t.project_id, t.id), "Открыть", bg="#111827")
        action_btns = btn_open

        if viewer_user_id:
            if not t.assigned_to_id:
                url = action_url("take_task", t.id, viewer_user_id)
                action_btns += _cta_btn(url, "Взять в работу", bg="#059669")
            elif t.assigned_to_id == viewer_user_id:
                url = action_url("checkin", t.id, viewer_user_id)
                action_btns += _cta_btn(url, "Check-in ✓", bg="#0369a1")
            if is_overdue and not t.is_escalation:
                url = action_url("escalate", t.id, viewer_user_id)
                action_btns += _cta_btn(url, "Эскалировать", bg="#dc2626")

        badges = _priority_chip(t.priority)
        if t.control_ski:
            badges += ' <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fef3c7;color:#78350f;">СКИ</span>'
        if t.is_escalation:
            badges += ' <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;background:#fee2e2;color:#991b1b;">ESC</span>'

        return (
            f'<tr style="background:{row_bg};">'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;max-width:180px;">'
            f'<div style="font-weight:600;font-size:13px;">{escape_html(t.title)}</div>'
            f'<div style="margin-top:3px;">{badges}</div></td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">{escape_html(t.project_name)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;">{escape_html(t.assignee_name)}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;">{deadline_str}</td>'
            f'<td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;white-space:nowrap;">{action_btns}</td>'
            "</tr>"
        )

    critical_block = ""
    if include_critical:
        rows = "".join(_task_row(t) for t in digest.focus_tasks[:limit_tasks])
        critical_block = (
            '<tr><td style="padding:0 24px 24px;">'
            '<div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:10px;">Критические задачи и фокус</div>'
            '<table width="100%" cellpadding="0" cellspacing="0" '
            'style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:13px;">'
            '<tr style="background:#f9fafb;">'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Задача</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Проект</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Исполнитель</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Дедлайн</th>'
            '<th align="left" style="padding:10px 12px;color:#6b7280;font-weight:600;">Действия</th>'
            "</tr>"
            + (rows or '<tr><td colspan="5" style="padding:14px;color:#9ca3af;">Нет критических задач</td></tr>')
            + "</table></td></tr>"
        )

    # ── Assemble ───────────────────────────────────────────────────────────────
    role_badge_html = _role_badge(digest.audience_label)
    role_hint = _role_header_text(digest.audience_label)

    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        '<body style="margin:0;padding:0;background:#f3f4f6;'
        'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Arial,sans-serif;color:#111827;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"'
        ' style="padding:24px 12px;background:#f3f4f6;">'
        '<tr><td align="center">'
        '<table role="presentation" width="680" cellpadding="0" cellspacing="0"'
        ' style="max-width:680px;width:100%;background:#ffffff;'
        'border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">'

        # Header
        '<tr><td style="padding:24px 28px;background:#111827;">'
        f'<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-.3px;">'
        f'PlannerBro</div>'
        f'<div style="margin-top:6px;color:#9ca3af;font-size:13px;">'
        f'{digest.now_local.strftime("%d.%m.%Y %H:%M")} · {escape_html(digest.timezone_name)}</div>'
        f'<div style="margin-top:10px;">{role_badge_html}</div>'
        f'<div style="margin-top:8px;color:#d1d5db;font-size:13px;">{escape_html(role_hint)}</div>'
        # CTA buttons in header
        f'<div style="margin-top:16px;">'
        + _cta_btn(links["dashboard"], "Дэшборд", bg="#6d28d9")
        + _cta_btn(links["projects"], "Проекты", bg="#374151")
        + _cta_btn(links["analytics"], "Аналитика", bg="#374151")
        + "</div></td></tr>"

        # KPI
        + '<tr><td style="padding:20px 24px 8px;">' + kpi_row + "</td></tr>"

        # Divider
        + '<tr><td style="padding:0 24px 16px;">'
        '<div style="height:1px;background:#f3f4f6;"></div></td></tr>'

        # Projects + Tasks blocks
        + projects_block
        + critical_block

        # Footer
        + '<tr><td style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">'
        '<div style="font-size:11px;color:#9ca3af;">'
        'Это автоматическое сообщение PlannerBro. Не отвечайте на это письмо.'
        '</div></td></tr>'

        + "</table></td></tr></table></body></html>"
    )
