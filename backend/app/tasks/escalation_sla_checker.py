import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.task import Task
from app.services.notification_service import notify_escalation_sla_breached
from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.escalation_sla_checker.check_escalation_sla")
def check_escalation_sla():
    asyncio.run(_async_check_escalation_sla())


async def _async_check_escalation_sla():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Task).where(
                Task.is_escalation == True,  # noqa: E712
                Task.status != "done",
                Task.escalation_due_at.isnot(None),
                Task.escalation_first_response_at.is_(None),
                Task.escalation_overdue_at.is_(None),
                Task.escalation_due_at < now,
            )
        )
        tasks = result.scalars().all()
        for task in tasks:
            task.escalation_overdue_at = now
            await db.flush()
            await notify_escalation_sla_breached(db, task, now)
        await db.commit()
