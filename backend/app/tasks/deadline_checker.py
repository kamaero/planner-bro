import asyncio
from datetime import date, timedelta
from sqlalchemy import select
from app.tasks.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.models.task import Task, TaskDependency, TaskEvent
from app.models.deadline_change import DeadlineChange
from app.models.user import User
from app.services.notification_service import notify_deadline
from app.services.task_lock_service import acquire_task_run_lock


@celery_app.task(name="app.tasks.deadline_checker.check_deadlines")
def check_deadlines():
    asyncio.run(_async_check_deadlines())


async def _async_check_deadlines():
    # Lock TTL slightly less than the beat interval (1 hour) to prevent overlapping runs.
    if not await acquire_task_run_lock("check_deadlines", ttl_seconds=55 * 60):
        return
    today = date.today()
    warning_days = {1, 3}

    async with AsyncSessionLocal() as db:
        user_days = await db.execute(select(User.reminder_days))
        for row in user_days.all():
            raw = row[0] or ""
            for item in raw.split(","):
                item = item.strip()
                if item.isdigit():
                    day = int(item)
                    if day > 0:
                        warning_days.add(day)

        for days in sorted(warning_days):
            target = today + timedelta(days=days)
            result = await db.execute(
                select(Task).where(
                    Task.end_date == target,
                    Task.status != "done",
                )
            )
            tasks = result.scalars().all()
            for task in tasks:
                await notify_deadline(db, task, days_until=days)

        # Check missed deadlines
        missed_result = await db.execute(
            select(Task).where(
                Task.end_date < today,
                Task.status != "done",
            )
        )
        missed_tasks = missed_result.scalars().all()
        for task in missed_tasks:
            await notify_deadline(db, task, days_until=0)
            await _propagate_overdue_to_successors(db, task, today)
        await db.commit()


async def _propagate_overdue_to_successors(db, predecessor_task: Task, today: date):
    if not predecessor_task.end_date:
        return
    overdue_days = (today - predecessor_task.end_date).days
    if overdue_days <= 0:
        return
    links = (
        await db.execute(
            select(TaskDependency).where(TaskDependency.predecessor_task_id == predecessor_task.id)
        )
    ).scalars().all()
    if not links:
        return

    for link in links:
        successor = (
            await db.execute(select(Task).where(Task.id == link.successor_task_id))
        ).scalar_one_or_none()
        if not successor or successor.status == "done":
            continue

        key = (
            f"dep-shift:{predecessor_task.id}:{successor.id}:{predecessor_task.end_date.isoformat()}:{overdue_days}"
        )
        exists = (
            await db.execute(
                select(TaskEvent.id).where(
                    TaskEvent.task_id == successor.id,
                    TaskEvent.event_type == "dependency_shifted",
                    TaskEvent.payload == key,
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue

        old_end = successor.end_date
        if successor.start_date:
            successor.start_date = successor.start_date + timedelta(days=overdue_days)
        if successor.end_date:
            successor.end_date = successor.end_date + timedelta(days=overdue_days)

        db.add(
            TaskEvent(
                task_id=successor.id,
                actor_id=None,
                event_type="dependency_shifted",
                payload=key,
                reason=f"Auto-shifted by {overdue_days} day(s) because predecessor is overdue",
            )
        )
        if old_end and successor.end_date and old_end != successor.end_date:
            db.add(
                DeadlineChange(
                    entity_type="task",
                    entity_id=successor.id,
                    changed_by_id=None,
                    old_date=old_end,
                    new_date=successor.end_date,
                    reason=f"Автосдвиг из-за просрочки зависимой задачи {predecessor_task.title}",
                )
            )
