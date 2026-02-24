import asyncio
from datetime import date, timedelta
from sqlalchemy import select
from app.tasks.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.models.task import Task
from app.models.user import User
from app.services.notification_service import notify_deadline


@celery_app.task(name="app.tasks.deadline_checker.check_deadlines")
def check_deadlines():
    asyncio.run(_async_check_deadlines())


async def _async_check_deadlines():
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
