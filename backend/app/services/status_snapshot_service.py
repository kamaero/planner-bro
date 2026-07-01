from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import and_, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.types import Date as SADate

from app.models.deadline_change import DeadlineChange
from app.models.department import Department
from app.models.email_dispatch_log import EmailDispatchLog
from app.models.project import Project, ProjectDepartment
from app.models.task import Task, TaskAssignee, TaskEvent
from app.models.user import User
from app.schemas.report import (
    ReportActivitySummary,
    ReportActivityDay,
    ReportBucket,
    ReportDepartmentSummary,
    ReportKpi,
    ReportPeriod,
    ReportProjectSummary,
    ReportRiskItem,
    ReportSlide,
    ReportTaskSummary,
    ReportWorkloadItem,
    StatusSnapshotReport,
)
from app.services.project_catalog_service import list_projects_for_user


PROJECT_STATUS_LABELS = {
    "planning": "Планирование",
    "tz": "ТЗ",
    "active": "В работе",
    "testing": "Тестирование",
    "on_hold": "На паузе",
    "completed": "Завершен",
}

TASK_STATUS_LABELS = {
    "planning": "Планирование",
    "tz": "ТЗ",
    "todo": "К выполнению",
    "in_progress": "В работе",
    "testing": "Тестирование",
    "review": "На проверке",
    "done": "Выполнено",
}

PRIORITY_LABELS = {
    "low": "Низкий",
    "medium": "Средний",
    "high": "Высокий",
    "critical": "Критический",
}

REPORT_HIDDEN_VISIBILITY = "hidden"
REPORT_TRACK_LABELS = {
    "main": "Крупные проекты",
    "competence_centers": "ЦК / аутсорсинг",
    "initiatives": "Инициативы",
    "admin": "Административные планы",
}
OPEN_PROJECT_STATUSES = {"planning", "tz", "active", "testing", "on_hold"}
OPEN_TASK_STATUSES = {"planning", "tz", "todo", "in_progress", "testing", "review"}
CRITICAL_PRIORITIES = {"high", "critical"}
STALE_DAYS = 7


def default_report_period(today: date | None = None) -> tuple[date, date]:
    today = today or datetime.now(timezone.utc).date()
    return today - timedelta(days=30), today


def _period_bounds(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    start = datetime.combine(from_date, time.min, tzinfo=timezone.utc)
    end = datetime.combine(to_date, time.max, tzinfo=timezone.utc)
    return start, end


def _is_task_done(task: Task) -> bool:
    return task.status == "done" or int(task.progress_percent or 0) >= 100


def _is_project_done(project: Project, tasks: list[Task]) -> bool:
    if project.status == "completed":
        return True
    return bool(tasks) and all(_is_task_done(task) for task in tasks)


def _user_name(user: User | None) -> str:
    if not user:
        return "не назначен"
    parts = [user.last_name, user.first_name, user.middle_name]
    full_name = " ".join(part for part in parts if part).strip()
    return full_name or user.name or user.email or "без имени"


def _task_assignee_name(task: Task) -> str:
    if task.assignees:
        return ", ".join(_user_name(user) for user in task.assignees)
    return _user_name(task.assignee)


def _task_summary(task: Task, project_name_by_id: dict[str, str]) -> ReportTaskSummary:
    return ReportTaskSummary(
        id=task.id,
        title=task.title,
        project_id=task.project_id,
        project_name=project_name_by_id.get(task.project_id, "Проект"),
        status=task.status,
        status_label=TASK_STATUS_LABELS.get(task.status, task.status),
        priority=task.priority,
        assignee_name=_task_assignee_name(task),
        end_date=task.end_date,
        created_at=task.created_at,
        updated_at=task.updated_at,
        control_ski=task.control_ski,
        is_escalation=task.is_escalation,
    )


def _department_names(project: Project) -> list[str]:
    names: list[str] = []
    for link in project.departments:
        department = getattr(link, "department", None)
        if department and department.name:
            names.append(department.name)
    return names


def _project_risk_level(overdue_tasks: int, critical_tasks: int, stale_tasks: int, project_overdue: bool) -> str:
    if project_overdue or overdue_tasks > 0:
        return "high"
    if critical_tasks > 0 or stale_tasks > 0:
        return "medium"
    return "low"


def _project_risk_reasons(
    *,
    project: Project,
    today: date,
    overdue_tasks: int,
    critical_tasks: int,
    stale_tasks: int,
) -> list[str]:
    reasons: list[str] = []
    if project.end_date and project.end_date < today and project.status != "completed":
        reasons.append("просрочен дедлайн проекта")
    if overdue_tasks:
        reasons.append(f"просроченных задач: {overdue_tasks}")
    if critical_tasks:
        reasons.append(f"критических/СКИ задач: {critical_tasks}")
    if stale_tasks:
        reasons.append(f"без обновления {STALE_DAYS}+ дней: {stale_tasks}")
    return reasons


async def build_status_snapshot_report(
    db: AsyncSession,
    *,
    current_user: User,
    from_date: date | None = None,
    to_date: date | None = None,
    department_id: str | None = None,
) -> StatusSnapshotReport:
    today = datetime.now(timezone.utc).date()
    if from_date is None or to_date is None:
        default_from, default_to = default_report_period(today)
        from_date = from_date or default_from
        to_date = to_date or default_to
    if from_date > to_date:
        from_date, to_date = to_date, from_date

    period_start, period_end = _period_bounds(from_date, to_date)
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=STALE_DAYS)

    accessible_projects = await list_projects_for_user(db, actor=current_user)
    accessible_project_ids = {project.id for project in accessible_projects}
    if not accessible_project_ids:
        return _empty_report(from_date=from_date, to_date=to_date, scope_label="Нет доступных проектов")

    if department_id:
        linked_project_ids = set(
            (
                await db.execute(
                    select(ProjectDepartment.project_id).where(ProjectDepartment.department_id == department_id)
                )
            ).scalars().all()
        )
        accessible_project_ids &= linked_project_ids

    if not accessible_project_ids:
        return _empty_report(from_date=from_date, to_date=to_date, scope_label="Нет проектов в выбранном контуре")

    projects = (
        await db.execute(
            select(Project)
            .where(Project.id.in_(accessible_project_ids))
            .options(
                selectinload(Project.owner),
                selectinload(Project.departments).selectinload(ProjectDepartment.department),
            )
        )
    ).scalars().all()
    projects = [project for project in projects if project.report_visibility != REPORT_HIDDEN_VISIBILITY]
    accessible_project_ids = {project.id for project in projects}
    if not accessible_project_ids:
        return _empty_report(from_date=from_date, to_date=to_date, scope_label="Нет проектов в докладовом контуре")

    tasks = (
        await db.execute(
            select(Task)
            .where(Task.project_id.in_(accessible_project_ids))
            .options(
                selectinload(Task.assignee),
                selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
            )
        )
    ).scalars().all()

    departments = (await db.execute(select(Department))).scalars().all()
    department_by_id = {department.id: department for department in departments}

    tasks_by_project: dict[str, list[Task]] = defaultdict(list)
    for task in tasks:
        tasks_by_project[task.project_id].append(task)

    project_summaries: list[ReportProjectSummary] = []
    risks: list[ReportRiskItem] = []
    open_tasks = [task for task in tasks if not _is_task_done(task)]
    project_name_by_id = {project.id: project.name for project in projects}

    for project in projects:
        project_tasks = tasks_by_project.get(project.id, [])
        total_tasks = len(project_tasks)
        done_tasks = sum(1 for task in project_tasks if _is_task_done(task))
        progress_percent = round(done_tasks / total_tasks * 100) if total_tasks else 0
        overdue_tasks = sum(
            1 for task in project_tasks if not _is_task_done(task) and task.end_date and task.end_date < today
        )
        critical_tasks = sum(
            1
            for task in project_tasks
            if not _is_task_done(task)
            and (task.priority in CRITICAL_PRIORITIES or task.control_ski or task.is_escalation)
        )
        stale_tasks = sum(
            1
            for task in project_tasks
            if not _is_task_done(task) and task.updated_at and task.updated_at < stale_cutoff
        )
        risk_reasons = _project_risk_reasons(
            project=project,
            today=today,
            overdue_tasks=overdue_tasks,
            critical_tasks=critical_tasks,
            stale_tasks=stale_tasks,
        )
        risk_level = _project_risk_level(
            overdue_tasks,
            critical_tasks,
            stale_tasks,
            bool(project.end_date and project.end_date < today and project.status != "completed"),
        )
        if risk_reasons:
            risks.append(
                ReportRiskItem(
                    kind="project",
                    id=project.id,
                    title=project.name,
                    project_id=project.id,
                    project_name=project.name,
                    owner_name=_user_name(project.owner),
                    end_date=project.end_date,
                    risk_level=risk_level,
                    reason="; ".join(risk_reasons),
                )
            )

        project_summaries.append(
            ReportProjectSummary(
                id=project.id,
                name=project.name,
                status=project.status,
                status_label=PROJECT_STATUS_LABELS.get(project.status, project.status),
                priority=project.priority,
                project_kind=project.project_kind,
                report_visibility=project.report_visibility,
                report_track=project.report_track,
                owner_name=_user_name(project.owner),
                department_names=_department_names(project),
                total_tasks=total_tasks,
                done_tasks=done_tasks,
                overdue_tasks=overdue_tasks,
                critical_tasks=critical_tasks,
                stale_tasks=stale_tasks,
                progress_percent=progress_percent,
                start_date=project.start_date,
                end_date=project.end_date,
                risk_level=risk_level,
                risk_reasons=risk_reasons,
            )
        )

    for task in open_tasks:
        if task.end_date and task.end_date < today:
            level = "high"
            reason = "просрочен дедлайн задачи"
        elif task.priority in CRITICAL_PRIORITIES or task.control_ski or task.is_escalation:
            level = "medium"
            reason = "критическая/СКИ/эскалационная задача"
        elif task.updated_at and task.updated_at < stale_cutoff:
            level = "medium"
            reason = f"нет обновления {STALE_DAYS}+ дней"
        else:
            continue
        project = next((item for item in projects if item.id == task.project_id), None)
        risks.append(
            ReportRiskItem(
                kind="task",
                id=task.id,
                title=task.title,
                project_id=task.project_id,
                project_name=project.name if project else None,
                assignee_name=_task_assignee_name(task),
                end_date=task.end_date,
                risk_level=level,
                reason=reason,
            )
        )

    risks.sort(key=lambda item: (0 if item.risk_level == "high" else 1, item.end_date or date.max, item.title.lower()))
    project_summaries.sort(key=lambda item: (0 if item.risk_level == "high" else 1, item.end_date or date.max, item.name.lower()))

    recent_tasks = [
        _task_summary(task, project_name_by_id)
        for task in sorted(tasks, key=lambda item: item.updated_at, reverse=True)[:12]
    ]
    my_open_tasks = [
        task
        for task in open_tasks
        if task.created_by_id == current_user.id
        or task.assigned_to_id == current_user.id
        or current_user.id in task.assignee_ids
    ]
    my_tasks = [
        _task_summary(task, project_name_by_id)
        for task in sorted(
            my_open_tasks,
            key=lambda item: (
                item.end_date or date.max,
                item.updated_at,
            ),
        )[:12]
    ]
    upcoming_deadlines = [
        _task_summary(task, project_name_by_id)
        for task in sorted(
            [
                task
                for task in open_tasks
                if task.end_date and 0 <= (task.end_date - today).days <= 20
            ],
            key=lambda item: item.end_date or date.max,
        )[:12]
    ]
    control_ski_tasks = [
        _task_summary(task, project_name_by_id)
        for task in sorted(
            [task for task in open_tasks if task.control_ski],
            key=lambda item: item.end_date or date.max,
        )[:8]
    ]
    workload = _build_workload(open_tasks)

    department_summaries = _build_department_summaries(
        projects=projects,
        project_summaries=project_summaries,
        department_by_id=department_by_id,
    )

    activity = await _build_activity_summary(
        db,
        project_ids=accessible_project_ids,
        tasks=tasks,
        period_start=period_start,
        period_end=period_end,
    )
    activity_days = await _build_activity_days(
        db,
        task_ids=[task.id for task in tasks],
        period_start=period_start,
        period_end=period_end,
    )

    active_projects_count = sum(1 for project in projects if not _is_project_done(project, tasks_by_project.get(project.id, [])))
    completed_projects_count = len(projects) - active_projects_count
    overdue_projects_count = sum(
        1 for project in projects if project.end_date and project.end_date < today and not _is_project_done(project, tasks_by_project.get(project.id, []))
    )
    overdue_tasks_count = sum(1 for task in open_tasks if task.end_date and task.end_date < today)
    critical_tasks_count = sum(
        1 for task in open_tasks if task.priority in CRITICAL_PRIORITIES or task.control_ski or task.is_escalation
    )
    unassigned_tasks_count = sum(1 for task in open_tasks if not task.assigned_to_id and not task.assignee_ids)
    completed_tasks_count = sum(1 for task in tasks if _is_task_done(task))
    avg_progress = round(sum(item.progress_percent for item in project_summaries) / len(project_summaries)) if project_summaries else 0

    kpis = [
        ReportKpi(id="projects_total", label="Проекты", value=len(projects), detail="в текущем контуре"),
        ReportKpi(id="tasks_total", label="Всего задач", value=len(tasks), detail="в докладовом scope"),
        ReportKpi(id="completed_tasks", label="Выполнено задач", value=completed_tasks_count, severity="good"),
        ReportKpi(id="active_projects", label="Активные", value=active_projects_count),
        ReportKpi(id="completed_projects", label="Завершены", value=completed_projects_count, severity="good"),
        ReportKpi(id="avg_progress", label="Средний прогресс", value=avg_progress, unit="%"),
        ReportKpi(
            id="overdue_projects",
            label="Просрочено проектов",
            value=overdue_projects_count,
            severity="danger" if overdue_projects_count else "good",
        ),
        ReportKpi(
            id="overdue_tasks",
            label="Просрочено задач",
            value=overdue_tasks_count,
            severity="danger" if overdue_tasks_count else "good",
        ),
        ReportKpi(
            id="critical_tasks",
            label="Критические/СКИ",
            value=critical_tasks_count,
            severity="warning" if critical_tasks_count else "good",
        ),
        ReportKpi(
            id="unassigned_tasks",
            label="Без ответственного",
            value=unassigned_tasks_count,
            severity="warning" if unassigned_tasks_count else "good",
        ),
    ]

    status_counts = [
        ReportBucket(key=status, label=label, count=sum(1 for task in tasks if task.status == status))
        for status, label in TASK_STATUS_LABELS.items()
    ]
    priority_counts = [
        ReportBucket(key=priority, label=label, count=sum(1 for task in tasks if task.priority == priority))
        for priority, label in PRIORITY_LABELS.items()
    ]

    scope_label = _scope_label(current_user=current_user, department_id=department_id, department_by_id=department_by_id)
    return StatusSnapshotReport(
        generated_at=datetime.now(timezone.utc),
        period=ReportPeriod(from_date=from_date, to_date=to_date),
        scope_label=scope_label,
        kpis=kpis,
        status_counts=status_counts,
        priority_counts=priority_counts,
        departments=department_summaries,
        projects=project_summaries,
        risks=risks[:40],
        recent_tasks=recent_tasks,
        my_tasks=my_tasks,
        upcoming_deadlines=upcoming_deadlines,
        control_ski_tasks=control_ski_tasks,
        workload=workload,
        escalations_count=sum(1 for task in open_tasks if task.is_escalation),
        activity=activity,
        activity_days=activity_days,
        slides=_build_slide_outline(
            period=ReportPeriod(from_date=from_date, to_date=to_date),
            kpis=kpis,
            projects=project_summaries,
            departments=department_summaries,
            risks=risks,
            activity=activity,
        ),
    )


def _empty_report(*, from_date: date, to_date: date, scope_label: str) -> StatusSnapshotReport:
    return StatusSnapshotReport(
        generated_at=datetime.now(timezone.utc),
        period=ReportPeriod(from_date=from_date, to_date=to_date),
        scope_label=scope_label,
        kpis=[],
        status_counts=[],
        priority_counts=[],
        departments=[],
        projects=[],
        risks=[],
        recent_tasks=[],
        my_tasks=[],
        upcoming_deadlines=[],
        control_ski_tasks=[],
        workload=[],
        escalations_count=0,
        activity=ReportActivitySummary(
            tasks_created=0,
            tasks_updated=0,
            tasks_completed=0,
            task_events=0,
            deadline_shifts=0,
            email_sent=0,
            email_failed=0,
        ),
        activity_days=[],
        slides=[],
    )


def _build_workload(open_tasks: list[Task]) -> list[ReportWorkloadItem]:
    counts: dict[str, ReportWorkloadItem] = {}
    for task in open_tasks:
        users = task.assignees or ([task.assignee] if task.assignee else [])
        for user in users:
            if not user:
                continue
            item = counts.get(user.id)
            if not item:
                item = ReportWorkloadItem(user_id=user.id, name=_user_name(user), open_tasks=0)
                counts[user.id] = item
            item.open_tasks += 1
    return sorted(counts.values(), key=lambda item: (-item.open_tasks, item.name.lower()))


def _build_department_summaries(
    *,
    projects: list[Project],
    project_summaries: list[ReportProjectSummary],
    department_by_id: dict[str, Department],
) -> list[ReportDepartmentSummary]:
    summary_by_project_id = {item.id: item for item in project_summaries}
    grouped: dict[str | None, list[ReportProjectSummary]] = defaultdict(list)
    for project in projects:
        linked_department_ids = [link.department_id for link in project.departments]
        if not linked_department_ids:
            grouped[None].append(summary_by_project_id[project.id])
            continue
        for department_id in linked_department_ids:
            grouped[department_id].append(summary_by_project_id[project.id])

    result: list[ReportDepartmentSummary] = []
    for department_id, items in grouped.items():
        tasks_total = sum(item.total_tasks for item in items)
        done_tasks = sum(item.done_tasks for item in items)
        progress = round(done_tasks / tasks_total * 100) if tasks_total else 0
        department = department_by_id.get(department_id) if department_id else None
        result.append(
            ReportDepartmentSummary(
                id=department_id,
                name=department.name if department else "Без отдела",
                projects_total=len(items),
                active_projects=sum(1 for item in items if item.status != "completed"),
                completed_projects=sum(1 for item in items if item.status == "completed"),
                overdue_projects=sum(1 for item in items if "просрочен дедлайн проекта" in item.risk_reasons),
                tasks_total=tasks_total,
                done_tasks=done_tasks,
                overdue_tasks=sum(item.overdue_tasks for item in items),
                progress_percent=progress,
            )
        )
    result.sort(key=lambda item: (-item.overdue_projects, item.name.lower()))
    return result


async def _build_activity_summary(
    db: AsyncSession,
    *,
    project_ids: set[str],
    tasks: list[Task],
    period_start: datetime,
    period_end: datetime,
) -> ReportActivitySummary:
    task_ids = [task.id for task in tasks]
    tasks_created = sum(1 for task in tasks if period_start <= task.created_at <= period_end)
    tasks_updated = sum(1 for task in tasks if period_start <= task.updated_at <= period_end)
    tasks_completed = sum(1 for task in tasks if task.status == "done" and period_start <= task.updated_at <= period_end)

    task_events = 0
    if task_ids:
        task_events = len(
            (
                await db.execute(
                    select(TaskEvent.id).where(
                        TaskEvent.task_id.in_(task_ids),
                        TaskEvent.created_at >= period_start,
                        TaskEvent.created_at <= period_end,
                    )
                )
            ).scalars().all()
        )

    deadline_shifts = len(
        (
            await db.execute(
                select(DeadlineChange.id).where(
                    DeadlineChange.created_at >= period_start,
                    DeadlineChange.created_at <= period_end,
                    or_(
                        and_(
                            DeadlineChange.entity_type == "project",
                            DeadlineChange.entity_id.in_(project_ids),
                        ),
                        and_(
                            DeadlineChange.entity_type == "task",
                            DeadlineChange.entity_id.in_(task_ids or [""]),
                        ),
                    ),
                )
            )
        ).scalars().all()
    )
    email_rows = (
        await db.execute(
            select(EmailDispatchLog.status).where(
                EmailDispatchLog.created_at >= period_start,
                EmailDispatchLog.created_at <= period_end,
            )
        )
    ).scalars().all()
    return ReportActivitySummary(
        tasks_created=tasks_created,
        tasks_updated=tasks_updated,
        tasks_completed=tasks_completed,
        task_events=task_events,
        deadline_shifts=deadline_shifts,
        email_sent=sum(1 for status in email_rows if status == "sent"),
        email_failed=sum(1 for status in email_rows if status == "failed"),
    )


async def _build_activity_days(
    db: AsyncSession,
    *,
    task_ids: list[str],
    period_start: datetime,
    period_end: datetime,
) -> list[ReportActivityDay]:
    if not task_ids:
        return []
    event_date_col = cast(TaskEvent.created_at, SADate)
    rows = (
        await db.execute(
            select(
                event_date_col.label("event_date"),
                func.count(TaskEvent.id).label("cnt"),
            )
            .where(
                TaskEvent.task_id.in_(task_ids),
                TaskEvent.created_at >= period_start,
                TaskEvent.created_at <= period_end,
            )
            .group_by(event_date_col)
            .order_by(event_date_col)
        )
    ).all()
    return [ReportActivityDay(date=row.event_date, count=row.cnt) for row in rows]


def _scope_label(
    *,
    current_user: User,
    department_id: str | None,
    department_by_id: dict[str, Department],
) -> str:
    if department_id:
        return f"Отдел: {department_by_id.get(department_id).name if department_id in department_by_id else department_id}"
    if current_user.role == "admin":
        return "Полный контур"
    if current_user.role == "manager" or current_user.can_manage_team:
        return "Контур отдела и команды"
    return "Персональный контур"


def _kpi_value(kpis: list[ReportKpi], key: str) -> int | float:
    for item in kpis:
        if item.id == key:
            return item.value
    return 0


def _build_slide_outline(
    *,
    period: ReportPeriod,
    kpis: list[ReportKpi],
    projects: list[ReportProjectSummary],
    departments: list[ReportDepartmentSummary],
    risks: list[ReportRiskItem],
    activity: ReportActivitySummary,
) -> list[ReportSlide]:
    top_risks = risks[:5]
    main_projects = [item for item in projects if item.report_track == "main"][:7]
    competence_projects = [item for item in projects if item.report_track == "competence_centers"][:4]
    initiative_projects = [item for item in projects if item.report_track == "initiatives"][:4]
    return [
        ReportSlide(
            title="Текущий статус ИТ проектов",
            bullets=[
                f"Период: {period.from_date.isoformat()} — {period.to_date.isoformat()}",
                f"Проектов в контуре: {_kpi_value(kpis, 'projects_total')}",
                f"Средний прогресс: {_kpi_value(kpis, 'avg_progress')}%",
            ],
        ),
        ReportSlide(
            title="Обзорная инфографика",
            bullets=[
                f"Проектов в scope: {_kpi_value(kpis, 'projects_total')}",
                f"Всего задач: {_kpi_value(kpis, 'tasks_total')}",
                f"Выполнено задач: {_kpi_value(kpis, 'completed_tasks')}",
                f"Просрочено задач: {_kpi_value(kpis, 'overdue_tasks')}",
                f"Событий активности за период: {activity.task_events}",
            ],
            chart="overview_infographic",
        ),
        ReportSlide(
            title="Крупные проекты",
            bullets=[
                f"{item.name}: {item.status_label}, прогресс {item.progress_percent}%, дедлайн {item.end_date.isoformat() if item.end_date else 'не задан'}"
                for item in main_projects
            ] or ["Нет крупных проектов в докладовом контуре"],
            chart="project_table",
        ),
        ReportSlide(
            title="ЦК / аутсорсинг",
            bullets=[
                f"{item.name}: задач {item.done_tasks}/{item.total_tasks}, просрочено {item.overdue_tasks}, критические/СКИ {item.critical_tasks}"
                for item in competence_projects
            ] or ["Нет ЦК в докладовом контуре"],
            chart="project_table",
        ),
        ReportSlide(
            title="Риски и блокеры",
            bullets=[
                f"{item.title}: {item.reason}"
                for item in top_risks
            ] or ["Критических рисков не найдено"],
            chart="risk_table",
        ),
        ReportSlide(
            title="Инициативы",
            bullets=[
                f"{item.name}: {item.done_tasks}/{item.total_tasks} задач, {item.progress_percent}%"
                for item in initiative_projects
            ] or ["Нет инициатив в докладовом контуре"],
            chart="project_table",
        ),
        ReportSlide(
            title="Что требует решения",
            bullets=[
                "Разобрать проекты и задачи с высоким риском.",
                "Назначить ответственных на задачи без владельца.",
                "Проверить просроченные дедлайны и причины переносов.",
            ],
        ),
    ]
