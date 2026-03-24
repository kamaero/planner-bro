from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from fastapi import HTTPException

from app.models.deadline_change import DeadlineChange
from app.models.project import Project, ProjectMember
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


async def _require_target_project_manager(target_project_id: str, current_user: User, db: AsyncSession) -> None:
    """Check user is manager/owner in target project (or admin)."""
    if current_user.role == "admin":
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == target_project_id,
            ProjectMember.user_id == current_user.id,
            ProjectMember.role.in_(["owner", "manager"]),
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=403, detail="Нет прав менеджера в целевом проекте")


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
    payload, delete_requested, assignee_ids, end_date_shift_days, deadline_change_reason, target_project_id = (
        _parse_bulk_payload(data_payload)
    )

    if delete_requested:
        _require_delete_permission(current_user)

    if end_date_shift_days is not None and not deadline_change_reason:
        raise HTTPException(status_code=422, detail="Укажите причину изменения дедлайна")

    if target_project_id is not None:
        if target_project_id == project_id:
            raise HTTPException(status_code=400, detail="Целевой проект совпадает с текущим")
        # verify target project exists
        tgt = await db.get(Project, target_project_id)
        if tgt is None:
            raise HTTPException(status_code=404, detail="Целевой проект не найден")
        await _require_target_project_manager(target_project_id, current_user, db)

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

    # --- move tasks between projects ---
    if target_project_id is not None:
        task_id_set = {task.id for task in tasks}
        for task in tasks:
            # detach subtask from parent if parent is in original project (not being moved)
            if task.parent_task_id and task.parent_task_id not in task_id_set:
                task.parent_task_id = None
            task.project_id = target_project_id
            await log_task_event(
                db, task.id, current_user.id, "task_moved_bulk",
                f"project:{project_id}->{target_project_id}", None,
            )
            result["updated"] += 1
        await db.commit()
        return result

    # --- regular field updates (status / priority / assignee / control_ski / etc.) ---
    for task in tasks:
        old_status = task.status
        old_assignee = task.assigned_to_id
        changed = False

        # deadline shift
        if end_date_shift_days is not None and task.end_date is not None:
            old_end_date = task.end_date
            task.end_date = old_end_date + timedelta(days=end_date_shift_days)
            db.add(
                DeadlineChange(
                    entity_type="task",
                    entity_id=task.id,
                    changed_by_id=current_user.id,
                    old_date=old_end_date,
                    new_date=task.end_date,
                    reason=deadline_change_reason,
                )
            )
            await log_task_event(
                db, task.id, current_user.id, "date_changed",
                f"end:{old_end_date}->{task.end_date}",
                deadline_change_reason,
            )
            changed = True

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
