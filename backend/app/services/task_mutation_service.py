from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskComment

TaskEventLogger = Callable[[AsyncSession, str, str | None, str, str | None, str | None], Awaitable[None]]
NextCheckInPlanner = Callable[[Task, datetime], datetime | None]

VALID_TASK_STATUSES = {"planning", "tz", "todo", "in_progress", "testing", "review", "done"}


def validate_task_status(status: str) -> None:
    if status not in VALID_TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {VALID_TASK_STATUSES}")


async def apply_status_update(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    status: str,
    progress_percent: int | None,
    next_step: str | None,
    now: datetime,
    plan_next_check_in: NextCheckInPlanner,
    log_task_event: TaskEventLogger,
) -> None:
    task.status = status
    if progress_percent is not None:
        task.progress_percent = progress_percent
    elif status == "done":
        task.progress_percent = 100

    if next_step is not None:
        task.next_step = next_step.strip() or None

    task.last_check_in_at = now
    task.last_check_in_note = "Статус обновлен"
    task.next_check_in_due_at = plan_next_check_in(task, now)

    await log_task_event(db, task.id, actor_id, "status_changed", status)
    if progress_percent is not None:
        await log_task_event(db, task.id, actor_id, "progress_updated", str(progress_percent))
    if next_step is not None:
        await log_task_event(db, task.id, actor_id, "next_step_updated", task.next_step)

    if status == "done" and task.repeat_every_days and task.repeat_every_days > 0:
        next_start = task.start_date + timedelta(days=task.repeat_every_days) if task.start_date else None
        next_end = task.end_date + timedelta(days=task.repeat_every_days) if task.end_date else None
        next_task = Task(
            project_id=task.project_id,
            parent_task_id=task.parent_task_id,
            title=task.title,
            description=task.description,
            status="todo",
            priority=task.priority,
            control_ski=task.control_ski,
            progress_percent=0,
            next_step=None,
            start_date=next_start,
            end_date=next_end,
            assigned_to_id=task.assigned_to_id,
            is_escalation=task.is_escalation,
            escalation_for=task.escalation_for,
            repeat_every_days=task.repeat_every_days,
            created_by_id=actor_id,
            estimated_hours=task.estimated_hours,
        )
        db.add(next_task)
        await db.flush()
        await log_task_event(
            db,
            next_task.id,
            actor_id,
            "task_created_from_recurrence",
            f"source={task.id}",
        )


async def apply_task_check_in(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    summary: str,
    blockers: str | None,
    need_manager_help: bool,
    next_check_in_due_at: datetime | None,
    now: datetime,
    plan_next_check_in: NextCheckInPlanner,
    log_task_event: TaskEventLogger,
) -> None:
    task.last_check_in_at = now
    task.last_check_in_note = summary
    if task.status == "done":
        task.next_check_in_due_at = None
    elif next_check_in_due_at:
        task.next_check_in_due_at = next_check_in_due_at
    else:
        task.next_check_in_due_at = plan_next_check_in(task, now)

    comment_lines = [f"CHECK-IN: {summary}"]
    if blockers:
        comment_lines.append(f"Blockers: {blockers}")
    comment_lines.append(
        f"Next check-in due: {task.next_check_in_due_at.isoformat() if task.next_check_in_due_at else 'n/a'}"
    )
    if need_manager_help:
        comment_lines.append("Manager help requested: yes")

    comment = TaskComment(task_id=task.id, author_id=actor_id, body="\n".join(comment_lines))
    db.add(comment)

    await log_task_event(
        db,
        task.id,
        actor_id,
        "check_in_recorded",
        f"help={'1' if need_manager_help else '0'}",
    )
