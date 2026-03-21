from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import date

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deadline_change import DeadlineChange
from app.models.task import Task

TaskEventLogger = Callable[[AsyncSession, str, str | None, str, str | None, str | None], Awaitable[None]]


def validate_deadline_reason(
    *,
    old_end_date: date | None,
    new_end_date: date | None,
    projected_status: str,
    deadline_change_reason: str | None,
) -> None:
    requires_reason = projected_status != "planning"
    end_date_changed = old_end_date is not None and new_end_date != old_end_date
    if end_date_changed and requires_reason and not deadline_change_reason:
        raise HTTPException(status_code=422, detail="Укажите причину изменения дедлайна")


async def record_deadline_change_and_date_events(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    old_start_date: date | None,
    old_end_date: date | None,
    projected_status: str,
    deadline_change_reason: str | None,
    log_task_event: TaskEventLogger,
) -> None:
    requires_reason = projected_status != "planning"
    start_date_changed = task.start_date != old_start_date
    end_date_changed = task.end_date != old_end_date

    if end_date_changed and old_end_date is not None and deadline_change_reason and requires_reason:
        db.add(
            DeadlineChange(
                entity_type="task",
                entity_id=task.id,
                changed_by_id=actor_id,
                old_date=old_end_date,
                new_date=task.end_date,
                reason=deadline_change_reason,
            )
        )

    if start_date_changed:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "date_changed",
            f"start:{old_start_date}->{task.start_date}",
        )
    if end_date_changed:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "date_changed",
            f"end:{old_end_date}->{task.end_date}",
            reason=deadline_change_reason,
        )
