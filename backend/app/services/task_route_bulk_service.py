from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from fastapi import HTTPException

from app.models.task import Task, TaskAssignee
from app.models.user import User
from app.services.task_access_service import (
    ensure_member_for_assignee as _ensure_member_for_assignee,
    require_bulk_permission as _require_bulk_permission,
    require_delete_permission as _require_delete_permission,
    require_project_exists as _require_project_exists,
    require_project_manager as _require_project_manager,
    serialize_assignee_ids as _serialize_assignee_ids,
    sync_task_assignees as _sync_task_assignees,
)
from app.services.task_activity_service import (
    apply_bulk_events_and_notifications as _apply_bulk_events_and_notifications,
)
from app.services.task_bulk_service import (
    apply_bulk_fields as _apply_bulk_fields,
    normalize_bulk_task_ids as _normalize_bulk_task_ids,
    parse_bulk_payload as _parse_bulk_payload,
    validate_bulk_priority as _validate_bulk_priority,
)
from app.services.task_lifecycle_service import (
    mark_escalation_response as _mark_escalation_response,
    normalize_priority_for_control_ski as _normalize_priority_for_control_ski,
    rollup_parent_schedule as _rollup_parent_schedule,
)
from app.services.task_mutation_service import validate_task_status as _validate_task_status
from app.services.task_rules_service import ensure_predecessors_done


async def _notify_task_assigned(db: AsyncSession, task: Task, user_id: str, actor_id: str | None = None) -> None:
    from app.services.notification_service import notify_task_assigned

    await notify_task_assigned(db, task, user_id, actor_id=actor_id)


async def _notify_task_updated(db: AsyncSession, task: Task, actor_id: str | None = None) -> None:
    from app.services.notification_service import notify_task_updated

    await notify_task_updated(db, task, actor_id=actor_id)


async def apply_bulk_task_update_flow(
    db: AsyncSession,
    *,
    project_id: str,
    current_user: User,
    data_payload: dict,
    log_task_event,
) -> dict:
    _require_bulk_permission(current_user)
    await _require_project_exists(project_id, db)
    await _require_project_manager(project_id, current_user, db)

    task_ids = _normalize_bulk_task_ids(data_payload["task_ids"])
    payload, delete_requested, assignee_ids = _parse_bulk_payload(data_payload)
    if delete_requested:
        _require_delete_permission(current_user)

    if "status" in payload:
        _validate_task_status(payload["status"])
    _validate_bulk_priority(payload)

    if "assigned_to_id" in payload and payload["assigned_to_id"]:
        await _ensure_member_for_assignee(project_id, payload["assigned_to_id"], current_user, db)

    tasks = (
        await db.execute(
            select(Task)
            .where(
                Task.project_id == project_id,
                Task.id.in_(task_ids),
            )
            .options(
                selectinload(Task.assignee),
                selectinload(Task.assignee_links),
            )
        )
    ).scalars().all()

    requested = len(task_ids)
    found_ids = {task.id for task in tasks}
    errors: list[dict] = [
        {"task_id": tid, "reason": "Task not found in project"}
        for tid in task_ids
        if tid not in found_ids
    ]
    result = {
        "requested": requested,
        "updated": 0,
        "deleted": 0,
        "skipped": len(errors),
        "errors": errors,
    }

    if delete_requested:
        affected_parent_ids = {task.parent_task_id for task in tasks if task.parent_task_id}
        for task in tasks:
            await log_task_event(db, task.id, current_user.id, "task_deleted_bulk")
            await db.delete(task)
            result["deleted"] += 1
        for parent_id in affected_parent_ids:
            await _rollup_parent_schedule(db, parent_id)
        await db.commit()
        return result

    for task in tasks:
        old_status = task.status
        old_assignee = task.assigned_to_id
        changed = False

        if "status" in payload:
            try:
                await ensure_predecessors_done(task, payload["status"], db)
            except HTTPException as exc:
                result["skipped"] += 1
                result["errors"].append({"task_id": task.id, "reason": exc.detail})
                continue

        changed = _apply_bulk_fields(task, payload) or changed
        if assignee_ids is not None:
            await _sync_task_assignees(task, assignee_ids, project_id, current_user, db)
            changed = True

        if payload.get("status") == "done" and task.progress_percent != 100:
            task.progress_percent = 100
            changed = True

        normalized_priority = _normalize_priority_for_control_ski(task.priority, bool(task.control_ski))
        if normalized_priority != task.priority:
            task.priority = normalized_priority
            changed = True

        if not changed:
            continue

        await db.flush()
        result["updated"] += 1

        await _apply_bulk_events_and_notifications(
            db,
            task=task,
            actor_id=current_user.id,
            old_status=old_status,
            old_assignee=old_assignee,
            changed_payload_keys=list(payload.keys()),
            serialize_assignee_ids=_serialize_assignee_ids,
            notify_task_assigned=_notify_task_assigned,
            notify_task_updated=_notify_task_updated,
            log_task_event=log_task_event,
        )
        await _mark_escalation_response(task, current_user.id, db, log_task_event)

    await db.commit()
    return result
