from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task
from app.models.user import User
from app.services.task_access_service import (
    ensure_member_for_assignee as _ensure_member_for_assignee,
    is_title_only_update as _is_title_only_update,
    require_project_member as _require_project_member,
    require_task_update_access as _require_task_update_access,
    serialize_assignee_ids as _serialize_assignee_ids,
    sync_task_assignees as _sync_task_assignees,
)
from app.services.task_activity_service import (
    apply_update_events_and_assignee_notifications as _apply_update_events_and_assignee_notifications,
    notify_task_created as _notify_task_created,
)
from app.services.task_create_service import (
    apply_default_escalation_assignee as _apply_default_escalation_assignee,
    split_create_payload as _split_create_payload,
)
from app.services.task_deadline_service import (
    record_deadline_change_and_date_events as _record_deadline_change_and_date_events,
    validate_deadline_reason as _validate_deadline_reason,
)
from app.services.task_dependency_service import (
    apply_outgoing_fs_autoplan as _apply_outgoing_fs_autoplan,
    sync_task_predecessors as _sync_task_predecessors,
    validate_incoming_dependency_rules as _validate_incoming_dependency_rules,
)
from app.services.task_lifecycle_service import (
    get_project_settings as _get_project_settings,
    mark_escalation_response as _mark_escalation_response,
    normalize_priority_for_control_ski as _normalize_priority_for_control_ski,
    now_utc as _now_utc,
    plan_next_check_in as _plan_next_check_in,
    prepare_escalation_fields as _prepare_escalation_fields,
    rollup_parent_schedule as _rollup_parent_schedule,
    validate_parent_task as _validate_parent_task,
)
from app.services.task_rules_service import (
    ensure_predecessors_done,
    validate_child_dates_within_parent,
    validate_strict_past_dates,
)
from app.services.task_service import (
    get_task_or_404,
    get_task_with_assignees_or_404,
)
from app.services.task_update_service import (
    apply_escalation_projection_for_update as _apply_escalation_projection_for_update,
    apply_update_status_side_effects as _apply_update_status_side_effects,
    should_revalidate_dependencies as _should_revalidate_dependencies,
    should_validate_predecessors as _should_validate_predecessors,
    split_update_payload as _split_update_payload,
)


async def _notify_task_assigned(db: AsyncSession, task: Task, user_id: str, actor_id: str | None = None) -> None:
    from app.services.notification_service import notify_task_assigned

    await notify_task_assigned(db, task, user_id, actor_id=actor_id)


async def _notify_new_task(db: AsyncSession, task: Task) -> None:
    from app.services.notification_service import notify_new_task

    await notify_new_task(db, task)


async def _notify_task_updated(db: AsyncSession, task: Task, actor_id: str | None = None) -> None:
    from app.services.notification_service import notify_task_updated

    await notify_task_updated(db, task, actor_id=actor_id)


async def create_task_from_payload(
    db: AsyncSession,
    *,
    project_id: str,
    payload: dict,
    assignee_ids_was_provided: bool,
    actor: User,
    log_task_event,
):
    await _require_project_member(project_id, actor, db)
    payload, predecessor_task_ids, assignee_ids = _split_create_payload(
        payload,
        assignee_ids_was_provided=assignee_ids_was_provided,
    )
    _prepare_escalation_fields(payload)
    payload["priority"] = _normalize_priority_for_control_ski(
        payload.get("priority", "medium"),
        bool(payload.get("control_ski")),
    )
    await _apply_default_escalation_assignee(
        db,
        project_id=project_id,
        payload=payload,
    )

    if payload.get("assigned_to_id"):
        await _ensure_member_for_assignee(project_id, payload["assigned_to_id"], actor, db)
    project = await _get_project_settings(project_id, db)
    task = Task(**payload, project_id=project_id, created_by_id=actor.id)
    task.next_check_in_due_at = _plan_next_check_in(task, _now_utc())
    db.add(task)
    await db.flush()
    parent_task = await _validate_parent_task(
        db,
        project_id=project_id,
        task_id=task.id,
        parent_task_id=task.parent_task_id,
    )
    validate_strict_past_dates(project, start_date=task.start_date, end_date=task.end_date)
    validate_child_dates_within_parent(
        project,
        parent=parent_task,
        start_date=task.start_date,
        end_date=task.end_date,
    )
    await _sync_task_predecessors(
        db,
        task=task,
        predecessor_task_ids=predecessor_task_ids,
        actor_id=actor.id,
        log_task_event=log_task_event,
    )
    await _validate_incoming_dependency_rules(db, task=task, auto_shift_fs=True)
    await ensure_predecessors_done(task, task.status, db)
    await _rollup_parent_schedule(db, task.parent_task_id)
    await _apply_outgoing_fs_autoplan(db, task.id)
    await log_task_event(
        db,
        task.id,
        actor.id,
        "task_created",
        f"is_escalation={task.is_escalation};assignee={task.assigned_to_id or ''}",
    )
    if assignee_ids is not None:
        await _sync_task_assignees(task, assignee_ids, project_id, actor, db)

    await _notify_task_created(
        db,
        task=task,
        actor_id=actor.id,
        serialize_assignee_ids=_serialize_assignee_ids,
        notify_task_assigned=_notify_task_assigned,
        notify_new_task=_notify_new_task,
    )
    await db.commit()
    await db.refresh(task)
    return await get_task_with_assignees_or_404(db, task.id)


async def update_task_from_payload(
    db: AsyncSession,
    *,
    task_id: str,
    payload: dict,
    actor: User,
    log_task_event,
):
    task = await get_task_or_404(db, task_id)
    old_assignee = task.assigned_to_id
    old_status = task.status
    old_start_date = task.start_date
    old_end_date = task.end_date
    old_parent_task_id = task.parent_task_id

    payload, assignee_ids, predecessor_task_ids, deadline_change_reason = _split_update_payload(payload)
    title_only_update = _is_title_only_update(
        payload,
        assignee_ids=assignee_ids,
        deadline_change_reason=deadline_change_reason,
    )
    await _require_task_update_access(task, actor, db, title_only_update=title_only_update)

    projected_status = payload.get("status", task.status)
    _validate_deadline_reason(
        old_end_date=old_end_date,
        new_end_date=payload.get("end_date"),
        projected_status=projected_status,
        deadline_change_reason=deadline_change_reason,
    )
    _apply_escalation_projection_for_update(
        task,
        payload,
        prepare_escalation_fields=_prepare_escalation_fields,
    )
    for field, value in payload.items():
        setattr(task, field, value)

    parent_task = await _validate_parent_task(
        db,
        project_id=task.project_id,
        task_id=task.id,
        parent_task_id=task.parent_task_id,
    )
    project = await _get_project_settings(task.project_id, db)
    effective_start_date = task.start_date
    effective_end_date = task.end_date
    if "start_date" in payload or "end_date" in payload:
        validate_strict_past_dates(project, start_date=effective_start_date, end_date=effective_end_date)
    if "parent_task_id" in payload or "start_date" in payload or "end_date" in payload:
        validate_child_dates_within_parent(
            project,
            parent=parent_task,
            start_date=effective_start_date,
            end_date=effective_end_date,
        )
    await _sync_task_predecessors(
        db,
        task=task,
        predecessor_task_ids=predecessor_task_ids,
        actor_id=actor.id,
        log_task_event=log_task_event,
    )
    if _should_revalidate_dependencies(predecessor_task_ids, payload):
        await _validate_incoming_dependency_rules(db, task=task, auto_shift_fs=True)
    if _should_validate_predecessors(
        payload=payload,
        predecessor_task_ids=predecessor_task_ids,
        old_status=old_status,
        new_status=task.status,
    ):
        await ensure_predecessors_done(task, task.status, db)

    _apply_update_status_side_effects(
        task,
        old_status=old_status,
        now=_now_utc(),
        plan_next_check_in=_plan_next_check_in,
    )
    await _record_deadline_change_and_date_events(
        db,
        task=task,
        actor_id=actor.id,
        old_start_date=old_start_date,
        old_end_date=old_end_date,
        projected_status=projected_status,
        deadline_change_reason=deadline_change_reason,
        log_task_event=log_task_event,
    )
    if _should_revalidate_dependencies(predecessor_task_ids, payload):
        await _apply_outgoing_fs_autoplan(db, task.id)

    await _rollup_parent_schedule(db, old_parent_task_id)
    await _rollup_parent_schedule(db, task.parent_task_id)
    task.priority = _normalize_priority_for_control_ski(task.priority, bool(task.control_ski))
    await db.flush()

    if "assigned_to_id" in payload and task.assigned_to_id:
        await _ensure_member_for_assignee(task.project_id, task.assigned_to_id, actor, db)
    await _sync_task_assignees(task, assignee_ids, task.project_id, actor, db)
    await _apply_update_events_and_assignee_notifications(
        db,
        task=task,
        actor_id=actor.id,
        old_status=old_status,
        old_assignee=old_assignee,
        serialize_assignee_ids=_serialize_assignee_ids,
        notify_task_assigned=_notify_task_assigned,
        log_task_event=log_task_event,
    )
    await _mark_escalation_response(task, actor.id, db, log_task_event)
    await _notify_task_updated(db, task, actor.id)
    await db.commit()
    await db.refresh(task)
    return await get_task_with_assignees_or_404(db, task.id)
