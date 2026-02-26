from datetime import date, datetime, timedelta

from app.core.config import settings
from app.models.task import Task


def _days_to_deadline(task: Task, today: date) -> int | None:
    if not task.end_date:
        return None
    return (task.end_date - today).days


def check_in_interval_hours(task: Task, today: date | None = None) -> int:
    current_day = today or date.today()
    days_to_deadline = _days_to_deadline(task, current_day)

    if task.control_ski and days_to_deadline is not None and 0 <= days_to_deadline <= 5:
        return max(1, settings.CHECK_IN_HOURS_CONTROL_SKI_URGENT)
    if task.is_escalation:
        return max(1, settings.CHECK_IN_HOURS_ESCALATION)
    if task.priority in ("high", "critical"):
        return max(1, settings.CHECK_IN_HOURS_HIGH_PRIORITY)
    if days_to_deadline is not None and 0 <= days_to_deadline <= settings.CHECK_IN_SOON_DEADLINE_WINDOW_DAYS:
        return max(1, settings.CHECK_IN_HOURS_SOON_DEADLINE)
    return max(1, settings.CHECK_IN_HOURS_DEFAULT)


def compute_next_check_in_due_at(task: Task, from_dt: datetime, today: date | None = None) -> datetime:
    return from_dt + timedelta(hours=check_in_interval_hours(task, today=today))
