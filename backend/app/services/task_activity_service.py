from __future__ import annotations

from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task

TaskEventLogger = Callable[[AsyncSession, str, str | None, str, str | None, str | None], Awaitable[None]]
TaskNotifier = Callable[[AsyncSession, Task, str], Awaitable[None]]
TaskAssigneeNotifier = Callable[[AsyncSession, Task, str, str | None], Awaitable[None]]
AssigneeSerializer = Callable[[Task, AsyncSession], Awaitable[list[str]]]
TaskCreationNotifier = Callable[[AsyncSession, Task], Awaitable[None]]


async def apply_update_events_and_assignee_notifications(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    old_status: str,
    old_assignee: str | None,
    serialize_assignee_ids: AssigneeSerializer,
    notify_task_assigned: TaskAssigneeNotifier,
    log_task_event: TaskEventLogger,
) -> None:
    new_assignee_ids = set(await serialize_assignee_ids(task, db))
    old_assignee_ids = {old_assignee} if old_assignee else set()

    for uid in sorted(new_assignee_ids - old_assignee_ids):
        await notify_task_assigned(db, task, uid, actor_id)

    if new_assignee_ids != old_assignee_ids:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "assignee_changed",
            f"{old_assignee or ''}->{','.join(sorted(new_assignee_ids))}",
        )

    if task.status != old_status:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "status_changed",
            f"{old_status}->{task.status}",
        )


async def apply_bulk_events_and_notifications(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    old_status: str,
    old_assignee: str | None,
    changed_payload_keys: list[str],
    serialize_assignee_ids: AssigneeSerializer,
    notify_task_assigned: TaskAssigneeNotifier,
    notify_task_updated: TaskNotifier,
    log_task_event: TaskEventLogger,
) -> None:
    if task.status != old_status:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "status_changed",
            f"{old_status}->{task.status}",
        )

    if task.assigned_to_id != old_assignee:
        await log_task_event(
            db,
            task.id,
            actor_id,
            "assignee_changed",
            f"{old_assignee or ''}->{task.assigned_to_id or ''}",
        )
        for uid in await serialize_assignee_ids(task, db):
            await notify_task_assigned(db, task, uid, actor_id)

    await log_task_event(
        db,
        task.id,
        actor_id,
        "task_bulk_updated",
        ",".join(sorted(changed_payload_keys)),
    )
    await notify_task_updated(db, task, actor_id)


async def notify_task_created(
    db: AsyncSession,
    *,
    task: Task,
    actor_id: str,
    serialize_assignee_ids: AssigneeSerializer,
    notify_task_assigned: TaskAssigneeNotifier,
    notify_new_task: TaskCreationNotifier,
) -> None:
    for uid in await serialize_assignee_ids(task, db):
        await notify_task_assigned(db, task, uid, actor_id)
    await notify_new_task(db, task)
