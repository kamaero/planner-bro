import asyncio
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.task import Task
from app.models.user import User
from app.services.check_in_policy import compute_next_check_in_due_at
from app.services.notification_service import notify_team_status_reminder
from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.status_update_reminder_checker.check_status_update_reminders")
def check_status_update_reminders():
    asyncio.run(_async_check_status_update_reminders())


async def _async_check_status_update_reminders():
    if not settings.TEAM_STATUS_REMINDER_ENABLED:
        return

    now = datetime.now(timezone.utc)
    today = date.today()

    async with AsyncSessionLocal() as db:
        users = (
            await db.execute(
                select(User).where(User.is_active == True)  # noqa: E712
            )
        ).scalars().all()

        for user in users:
            tasks = (
                await db.execute(
                    select(Task).where(
                        Task.assigned_to_id == user.id,
                        Task.status != "done",
                    )
                )
            ).scalars().all()
            if not tasks:
                continue

            stale_tasks_count = 0
            max_inactive_days = 1
            control_ski_urgent_count = 0
            focus_task_id: str | None = None
            focus_project_id: str | None = None

            for task in tasks:
                days_to_deadline = None
                if task.end_date:
                    days_to_deadline = (task.end_date - today).days

                if (
                    task.control_ski
                    and days_to_deadline is not None
                    and 0 <= days_to_deadline <= 5
                ):
                    control_ski_urgent_count += 1
                    if not focus_task_id:
                        focus_task_id = task.id
                        focus_project_id = task.project_id

                due_at = task.next_check_in_due_at
                if due_at is None and task.status != "done":
                    base = task.last_check_in_at or task.created_at
                    due_at = compute_next_check_in_due_at(task, from_dt=base, today=today)

                if due_at is None or due_at > now:
                    continue

                stale_tasks_count += 1
                if not focus_task_id:
                    focus_task_id = task.id
                    focus_project_id = task.project_id
                inactive_days = max(1, int((now - due_at).total_seconds() // 86400))
                if inactive_days > max_inactive_days:
                    max_inactive_days = inactive_days

            if stale_tasks_count > 0 or control_ski_urgent_count > 0:
                await notify_team_status_reminder(
                    db,
                    user_id=user.id,
                    user_name=user.name,
                    stale_tasks_count=stale_tasks_count,
                    max_inactive_days=max_inactive_days,
                    control_ski_urgent_count=control_ski_urgent_count,
                    focus_task_id=focus_task_id,
                    focus_project_id=focus_project_id,
                )
