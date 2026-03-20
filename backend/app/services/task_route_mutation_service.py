from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskComment
from app.services.task_lifecycle_service import (
    mark_escalation_response as _mark_escalation_response,
    now_utc as _now_utc,
    plan_next_check_in as _plan_next_check_in,
    rollup_parent_schedule as _rollup_parent_schedule,
)
from app.services.task_mutation_service import (
    apply_status_update as _apply_status_update,
    apply_task_check_in as _apply_task_check_in,
    validate_task_status as _validate_task_status,
)
from app.services.task_rules_service import ensure_predecessors_done
from app.services.task_service import get_task_with_assignees_or_404
from app.services.task_timeline_service import get_task_comment_with_author as _get_task_comment_with_author


async def _notify_task_updated(db: AsyncSession, task: Task, actor_id: str) -> None:
    from app.services.notification_service import notify_task_updated

    await notify_task_updated(db, task, actor_id)


async def _notify_check_in_help_requested(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    actor_name: str | None,
    summary: str,
    blockers: str | None,
) -> None:
    from app.services.notification_service import notify_check_in_help_requested

    await notify_check_in_help_requested(
        db,
        task=task,
        actor_id=actor_id,
        actor_name=actor_name,
        summary=summary,
        blockers=blockers,
    )


async def delete_task_and_rollup(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    log_task_event,
) -> None:
    parent_task_id = task.parent_task_id
    await log_task_event(db, task.id, actor_id, "task_deleted")
    await db.delete(task)
    await _rollup_parent_schedule(db, parent_task_id)
    await db.commit()


async def update_task_status_and_refresh(
    db: AsyncSession,
    *,
    task: Task,
    data: Any,
    actor_id: str,
    log_task_event,
):
    _validate_task_status(data.status)
    await ensure_predecessors_done(task, data.status, db)
    await _apply_status_update(
        db,
        task=task,
        actor_id=actor_id,
        status=data.status,
        progress_percent=data.progress_percent,
        next_step=data.next_step,
        now=_now_utc(),
        plan_next_check_in=_plan_next_check_in,
        log_task_event=log_task_event,
    )
    await _notify_task_updated(db, task, actor_id)
    await db.commit()
    await db.refresh(task)
    return await get_task_with_assignees_or_404(db, task.id)


async def check_in_task_and_refresh(
    db: AsyncSession,
    *,
    task: Task,
    data: Any,
    actor_id: str,
    actor_name: str | None,
    log_task_event,
):
    summary = data.summary.strip()
    blockers = data.blockers.strip() if data.blockers else None
    await _apply_task_check_in(
        db,
        task=task,
        actor_id=actor_id,
        summary=summary,
        blockers=blockers,
        need_manager_help=data.need_manager_help,
        next_check_in_due_at=data.next_check_in_due_at,
        now=_now_utc(),
        plan_next_check_in=_plan_next_check_in,
        log_task_event=log_task_event,
    )
    await _mark_escalation_response(task, actor_id, db, log_task_event)
    await db.commit()
    if data.need_manager_help:
        await _notify_check_in_help_requested(
            db,
            task=task,
            actor_id=actor_id,
            actor_name=actor_name,
            summary=summary,
            blockers=blockers,
        )
    return await get_task_with_assignees_or_404(db, task.id)


async def add_task_comment_and_refresh(
    db: AsyncSession,
    *,
    task: Task,
    task_id: str,
    actor_id: str,
    body: str,
    log_task_event,
):
    comment = TaskComment(task_id=task_id, author_id=actor_id, body=body)
    db.add(comment)
    await db.flush()
    await _mark_escalation_response(task, actor_id, db, log_task_event)
    await log_task_event(db, task_id, actor_id, "comment_added")
    await db.commit()
    return await _get_task_comment_with_author(db, comment.id)
