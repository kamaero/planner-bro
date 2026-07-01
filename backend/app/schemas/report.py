from datetime import date, datetime

from pydantic import BaseModel, Field


class ReportPeriod(BaseModel):
    from_date: date
    to_date: date


class ReportKpi(BaseModel):
    id: str
    label: str
    value: int | float
    unit: str | None = None
    detail: str | None = None
    severity: str = "neutral"


class ReportBucket(BaseModel):
    key: str
    label: str
    count: int


class ReportDepartmentSummary(BaseModel):
    id: str | None
    name: str
    projects_total: int
    active_projects: int
    completed_projects: int
    overdue_projects: int
    tasks_total: int
    done_tasks: int
    overdue_tasks: int
    progress_percent: int


class ReportProjectSummary(BaseModel):
    id: str
    name: str
    status: str
    status_label: str
    priority: str
    project_kind: str = "major_project"
    report_visibility: str = "always"
    report_track: str = "main"
    owner_name: str
    department_names: list[str] = Field(default_factory=list)
    total_tasks: int
    done_tasks: int
    overdue_tasks: int
    critical_tasks: int
    stale_tasks: int
    progress_percent: int
    start_date: date | None = None
    end_date: date | None = None
    risk_level: str
    risk_reasons: list[str] = Field(default_factory=list)


class ReportRiskItem(BaseModel):
    kind: str
    id: str
    title: str
    project_id: str | None = None
    project_name: str | None = None
    assignee_name: str | None = None
    owner_name: str | None = None
    end_date: date | None = None
    risk_level: str
    reason: str


class ReportTaskSummary(BaseModel):
    id: str
    title: str
    project_id: str
    project_name: str
    status: str
    status_label: str
    priority: str
    assignee_name: str
    end_date: date | None = None
    created_at: datetime
    updated_at: datetime
    control_ski: bool = False
    is_escalation: bool = False


class ReportWorkloadItem(BaseModel):
    user_id: str
    name: str
    open_tasks: int


class ReportActivitySummary(BaseModel):
    tasks_created: int
    tasks_updated: int
    tasks_completed: int
    task_events: int
    deadline_shifts: int
    email_sent: int
    email_failed: int


class ReportActivityDay(BaseModel):
    date: date
    count: int


class ReportSlide(BaseModel):
    title: str
    bullets: list[str] = Field(default_factory=list)
    chart: str | None = None


class StatusSnapshotReport(BaseModel):
    generated_at: datetime
    period: ReportPeriod
    scope_label: str
    kpis: list[ReportKpi]
    status_counts: list[ReportBucket]
    priority_counts: list[ReportBucket]
    departments: list[ReportDepartmentSummary]
    projects: list[ReportProjectSummary]
    risks: list[ReportRiskItem]
    recent_tasks: list[ReportTaskSummary] = Field(default_factory=list)
    my_tasks: list[ReportTaskSummary] = Field(default_factory=list)
    upcoming_deadlines: list[ReportTaskSummary] = Field(default_factory=list)
    control_ski_tasks: list[ReportTaskSummary] = Field(default_factory=list)
    workload: list[ReportWorkloadItem] = Field(default_factory=list)
    escalations_count: int = 0
    activity: ReportActivitySummary
    activity_days: list[ReportActivityDay] = Field(default_factory=list)
    slides: list[ReportSlide]
