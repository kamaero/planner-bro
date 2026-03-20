from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import Task, TaskEvent
from app.schemas.task import (
    TaskCreate,
    TaskUpdate,
    TaskStatusUpdate,
    TaskBulkUpdateRequest,
    TaskBulkUpdateResult,
    TaskOut,
    TaskCommentCreate,
    TaskCommentOut,
    TaskEventOut,
    TaskCheckInCreate,
    TaskDependencyCreate,
    TaskDependencyOut,
)
from app.schemas.deadline_change import DeadlineChangeOut
from app.services.task_service import (
    get_task_or_404,
    get_task_with_assignees_or_404,
    get_tasks_for_user,
    get_tasks_for_project,
    list_escalations_for_assignee,
)
from app.services.notification_service import (
    notify_task_assigned,
    notify_task_updated,
    notify_new_task,
)
from app.services.task_access_service import (
    ensure_member_for_assignee as _ensure_member_for_assignee,
    is_own_tasks_only as _is_own_tasks_only,
    is_title_only_update as _is_title_only_update,
    is_task_assignee as _is_task_assignee,
    require_delete_permission as _require_delete_permission,
    require_project_exists as _require_project_exists,
    require_project_member as _require_project_member,
    require_project_visibility as _require_project_visibility,
    require_task_editor as _require_task_editor,
    require_task_read_visibility as _require_task_read_visibility,
    require_task_update_access as _require_task_update_access,
    serialize_assignee_ids as _serialize_assignee_ids,
    sync_task_assignees as _sync_task_assignees,
)
from app.services.task_activity_service import (
    apply_update_events_and_assignee_notifications as _apply_update_events_and_assignee_notifications,
    notify_task_created as _notify_task_created,
)
from app.services.task_deadline_service import (
    record_deadline_change_and_date_events as _record_deadline_change_and_date_events,
    validate_deadline_reason as _validate_deadline_reason,
)
from app.services.task_update_service import (
    apply_update_status_side_effects as _apply_update_status_side_effects,
    apply_escalation_projection_for_update as _apply_escalation_projection_for_update,
    should_validate_predecessors as _should_validate_predecessors,
    should_revalidate_dependencies as _should_revalidate_dependencies,
    split_update_payload as _split_update_payload,
)
from app.services.task_create_service import (
    apply_default_escalation_assignee as _apply_default_escalation_assignee,
    split_create_payload as _split_create_payload,
)
from app.services.task_timeline_service import (
    list_task_comments as _list_task_comments,
    list_task_deadline_history as _list_task_deadline_history,
    list_task_events as _list_task_events,
)
from app.services.task_lifecycle_service import (
    get_project_settings as _get_project_settings,
    normalize_priority_for_control_ski as _normalize_priority_for_control_ski,
    prepare_escalation_fields as _prepare_escalation_fields,
    mark_escalation_response as _mark_escalation_response,
    now_utc as _now_utc,
    plan_next_check_in as _plan_next_check_in,
    rollup_parent_schedule as _rollup_parent_schedule,
    validate_parent_task as _validate_parent_task,
)
from app.services.task_route_mutation_service import (
    add_task_comment_and_refresh as _add_task_comment_and_refresh,
    check_in_task_and_refresh as _check_in_task_and_refresh,
    delete_task_and_rollup as _delete_task_and_rollup,
    update_task_status_and_refresh as _update_task_status_and_refresh,
)
from app.services.task_route_bulk_service import (
    apply_bulk_task_update_flow as _apply_bulk_task_update_flow,
)
from app.services.task_dependency_service import (
    apply_outgoing_fs_autoplan as _apply_outgoing_fs_autoplan,
    dependency_short_label as _dependency_short_label,
    enforce_dependency_dates_or_autoplan as _enforce_dependency_dates_or_autoplan,
    get_dependency_or_404 as _get_dependency_or_404,
    list_dependencies_for_successor as _list_dependencies_for_successor,
    project_critical_path,
    upsert_dependency as _upsert_dependency,
    sync_task_predecessors as _sync_task_predecessors,
    validate_incoming_dependency_rules as _validate_incoming_dependency_rules,
)
from app.services.task_rules_service import (
    ensure_predecessors_done,
    validate_child_dates_within_parent,
    validate_strict_past_dates,
)

router = APIRouter(tags=["tasks"])


async def _log_task_event(
    db: AsyncSession,
    task_id: str,
    actor_id: str | None,
    event_type: str,
    payload: str | None = None,
    reason: str | None = None,
):
    db.add(TaskEvent(task_id=task_id, actor_id=actor_id, event_type=event_type, payload=payload, reason=reason))
    await db.flush()


@router.get("/projects/{project_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    await _require_project_visibility(project_id, current_user, db)
    tasks = await get_tasks_for_project(db, project_id)
    if _is_own_tasks_only(current_user):
        return [task for task in tasks if _is_task_assignee(task, current_user.id)]
    return tasks


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: str,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_member(project_id, current_user, db)
    payload, predecessor_task_ids, assignee_ids = _split_create_payload(
        data.model_dump(),
        assignee_ids_was_provided="assignee_ids" in data.model_fields_set,
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
        await _ensure_member_for_assignee(project_id, payload["assigned_to_id"], current_user, db)
    project = await _get_project_settings(project_id, db)
    task = Task(**payload, project_id=project_id, created_by_id=current_user.id)
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
        actor_id=current_user.id,
        log_task_event=_log_task_event,
    )
    await _validate_incoming_dependency_rules(db, task=task, auto_shift_fs=True)
    await ensure_predecessors_done(task, task.status, db)
    await _rollup_parent_schedule(db, task.parent_task_id)
    await _apply_outgoing_fs_autoplan(db, task.id)
    await _log_task_event(
        db,
        task.id,
        current_user.id,
        "task_created",
        f"is_escalation={task.is_escalation};assignee={task.assigned_to_id or ''}",
    )
    if assignee_ids is not None:
        await _sync_task_assignees(task, assignee_ids, project_id, current_user, db)

    await _notify_task_created(
        db,
        task=task,
        actor_id=current_user.id,
        serialize_assignee_ids=_serialize_assignee_ids,
        notify_task_assigned=notify_task_assigned,
        notify_new_task=notify_new_task,
    )
    await db.commit()
    await db.refresh(task)

    return await get_task_with_assignees_or_404(db, task.id)


@router.get("/tasks/my", response_model=list[TaskOut])
async def list_my_tasks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await get_tasks_for_user(db, current_user.id)


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_read_visibility(task, current_user, db)
    return task


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)

    old_assignee = task.assigned_to_id
    old_status = task.status
    old_start_date = task.start_date
    old_end_date = task.end_date
    old_parent_task_id = task.parent_task_id
    # Keep explicitly passed nulls (e.g. clearing dates/assignee) but ignore fields not sent by client.
    payload, assignee_ids, predecessor_task_ids, deadline_change_reason = _split_update_payload(
        data.model_dump(exclude_unset=True)
    )

    title_only_update = _is_title_only_update(
        payload,
        assignee_ids=assignee_ids,
        deadline_change_reason=deadline_change_reason,
    )
    await _require_task_update_access(
        task,
        current_user,
        db,
        title_only_update=title_only_update,
    )

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
        validate_strict_past_dates(
            project,
            start_date=effective_start_date,
            end_date=effective_end_date,
        )
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
        actor_id=current_user.id,
        log_task_event=_log_task_event,
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
        actor_id=current_user.id,
        old_start_date=old_start_date,
        old_end_date=old_end_date,
        projected_status=projected_status,
        deadline_change_reason=deadline_change_reason,
        log_task_event=_log_task_event,
    )

    if _should_revalidate_dependencies(predecessor_task_ids, payload):
        await _apply_outgoing_fs_autoplan(db, task.id)

    await _rollup_parent_schedule(db, old_parent_task_id)
    await _rollup_parent_schedule(db, task.parent_task_id)

    task.priority = _normalize_priority_for_control_ski(task.priority, bool(task.control_ski))
    await db.flush()

    if "assigned_to_id" in payload and task.assigned_to_id:
        await _ensure_member_for_assignee(task.project_id, task.assigned_to_id, current_user, db)
    await _sync_task_assignees(task, assignee_ids, task.project_id, current_user, db)

    await _apply_update_events_and_assignee_notifications(
        db,
        task=task,
        actor_id=current_user.id,
        old_status=old_status,
        old_assignee=old_assignee,
        serialize_assignee_ids=_serialize_assignee_ids,
        notify_task_assigned=notify_task_assigned,
        log_task_event=_log_task_event,
    )
    await _mark_escalation_response(task, current_user.id, db, _log_task_event)

    await notify_task_updated(db, task, current_user.id)
    await db.commit()
    await db.refresh(task)

    return await get_task_with_assignees_or_404(db, task.id)


@router.get("/tasks/{task_id}/dependencies", response_model=list[TaskDependencyOut])
async def list_task_dependencies(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, current_user, db)
    return await _list_dependencies_for_successor(db, task_id)


@router.post("/tasks/{task_id}/dependencies", response_model=TaskDependencyOut, status_code=201)
async def add_task_dependency(
    task_id: str,
    data: TaskDependencyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    successor = await get_task_or_404(db, task_id)
    await _require_task_editor(successor, current_user, db)

    predecessor = await get_task_or_404(db, data.predecessor_task_id, detail="Predecessor task not found")
    lag_days = max(0, int(data.lag_days or 0))
    dep = await _upsert_dependency(
        db,
        successor=successor,
        predecessor=predecessor,
        actor_id=current_user.id,
        dependency_type=data.dependency_type,
        lag_days=lag_days,
    )

    await _enforce_dependency_dates_or_autoplan(
        predecessor,
        successor,
        dep.dependency_type,
        lag_days,
        auto_shift_fs=True,
    )
    await _apply_outgoing_fs_autoplan(db, successor.id)
    await _rollup_parent_schedule(db, successor.parent_task_id)
    await _log_task_event(
        db,
        successor.id,
        current_user.id,
        "dependency_added",
        f"{predecessor.id}->{successor.id} [{_dependency_short_label(dep.dependency_type)};+{lag_days}d]",
    )
    await db.commit()
    await db.refresh(dep)
    return dep


@router.delete("/tasks/{task_id}/dependencies/{predecessor_task_id}", status_code=204)
async def remove_task_dependency(
    task_id: str,
    predecessor_task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    successor = await get_task_or_404(db, task_id)
    await _require_task_editor(successor, current_user, db)
    dep = await _get_dependency_or_404(
        db,
        successor_task_id=task_id,
        predecessor_task_id=predecessor_task_id,
    )
    await db.delete(dep)
    await _log_task_event(
        db,
        successor.id,
        current_user.id,
        "dependency_removed",
        f"{predecessor_task_id}->{task_id}",
    )
    await db.commit()


@router.post("/projects/{project_id}/tasks/bulk", response_model=TaskBulkUpdateResult)
async def bulk_update_tasks(
    project_id: str,
    data: TaskBulkUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await _apply_bulk_task_update_flow(
        db,
        project_id=project_id,
        current_user=current_user,
        data_payload=data.model_dump(exclude_unset=True),
        log_task_event=_log_task_event,
    )
    return TaskBulkUpdateResult(**result)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_delete_permission(current_user)
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, current_user, db)
    await _delete_task_and_rollup(
        db,
        task=task,
        actor_id=current_user.id,
        log_task_event=_log_task_event,
    )


@router.patch("/tasks/{task_id}/status", response_model=TaskOut)
async def update_task_status(
    task_id: str,
    data: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, current_user, db)
    return await _update_task_status_and_refresh(
        db,
        task=task,
        data=data,
        actor_id=current_user.id,
        log_task_event=_log_task_event,
    )


@router.post("/tasks/{task_id}/check-in", response_model=TaskOut)
async def check_in_task(
    task_id: str,
    data: TaskCheckInCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, current_user, db)
    return await _check_in_task_and_refresh(
        db,
        task=task,
        data=data,
        actor_id=current_user.id,
        actor_name=current_user.name,
        log_task_event=_log_task_event,
    )


@router.get("/tasks/escalations/inbox", response_model=list[TaskOut])
async def escalation_inbox(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await list_escalations_for_assignee(db, current_user.id)


@router.get("/projects/{project_id}/critical-path")
async def critical_path(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    await _require_project_visibility(project_id, current_user, db)
    return await project_critical_path(db, project_id)


@router.get("/tasks/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_task_comments(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_read_visibility(task, current_user, db)
    return await _list_task_comments(db, task_id)


@router.post("/tasks/{task_id}/comments", response_model=TaskCommentOut, status_code=201)
async def add_task_comment(
    task_id: str,
    data: TaskCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, current_user, db)
    return await _add_task_comment_and_refresh(
        db,
        task=task,
        task_id=task_id,
        actor_id=current_user.id,
        body=data.body,
        log_task_event=_log_task_event,
    )


@router.get("/tasks/{task_id}/events", response_model=list[TaskEventOut])
async def list_task_events(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_read_visibility(task, current_user, db)
    return await _list_task_events(db, task_id)


@router.get("/tasks/{task_id}/deadline-history", response_model=list[DeadlineChangeOut])
async def list_task_deadline_history(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_project_visibility(task.project_id, current_user, db)
    return await _list_task_deadline_history(db, task_id)
