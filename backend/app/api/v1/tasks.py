from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import TaskEvent
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
    TaskReorderRequest,
)
from app.schemas.deadline_change import DeadlineChangeOut
from app.services.task_service import (
    get_task_or_404,
    get_tasks_for_user,
    get_tasks_for_project,
    list_escalations_for_assignee,
)
from app.services.task_access_service import (
    is_own_tasks_only as _is_own_tasks_only,
    is_task_assignee as _is_task_assignee,
    require_delete_permission as _require_delete_permission,
    require_project_exists as _require_project_exists,
    require_project_visibility as _require_project_visibility,
    require_task_editor as _require_task_editor,
    require_task_read_visibility as _require_task_read_visibility,
)
from app.services.task_timeline_service import (
    list_task_comments as _list_task_comments,
    list_task_deadline_history as _list_task_deadline_history,
    list_task_events as _list_task_events,
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
from app.services.task_route_write_service import (
    create_task_from_payload as _create_task_from_payload,
    update_task_from_payload as _update_task_from_payload,
)
from app.services.task_route_dependency_service import (
    add_dependency_for_task_editor as _add_dependency_for_task_editor,
    list_dependencies_for_task_editor as _list_dependencies_for_task_editor,
    remove_dependency_for_task_editor as _remove_dependency_for_task_editor,
)
from app.services.task_dependency_service import (
    project_critical_path,
)
from app.services.dependency_graph_service import get_dependency_graph
from app.services.time_tracking_service import get_project_time_summary
from app.services.custom_fields_service import get_task_custom_values, save_task_custom_values
from app.services.project_access_service import require_project_access
from app.services.task_reorder_service import renumber_task_titles_after_reorder

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
    return await _create_task_from_payload(
        db,
        project_id=project_id,
        payload=data.model_dump(),
        assignee_ids_was_provided="assignee_ids" in data.model_fields_set,
        actor=current_user,
        log_task_event=_log_task_event,
    )


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
    return await _update_task_from_payload(
        db,
        task_id=task_id,
        payload=data.model_dump(exclude_unset=True),
        actor=current_user,
        log_task_event=_log_task_event,
    )


@router.get("/tasks/{task_id}/dependencies", response_model=list[TaskDependencyOut])
async def list_task_dependencies(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _list_dependencies_for_task_editor(
        db,
        task_id=task_id,
        actor=current_user,
    )


@router.post("/tasks/{task_id}/dependencies", response_model=TaskDependencyOut, status_code=201)
async def add_task_dependency(
    task_id: str,
    data: TaskDependencyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _add_dependency_for_task_editor(
        db,
        task_id=task_id,
        predecessor_task_id=data.predecessor_task_id,
        dependency_type=data.dependency_type,
        lag_days=data.lag_days,
        actor=current_user,
        log_task_event=_log_task_event,
    )


@router.delete("/tasks/{task_id}/dependencies/{predecessor_task_id}", status_code=204)
async def remove_task_dependency(
    task_id: str,
    predecessor_task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _remove_dependency_for_task_editor(
        db,
        task_id=task_id,
        predecessor_task_id=predecessor_task_id,
        actor=current_user,
        log_task_event=_log_task_event,
    )


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


@router.put("/projects/{project_id}/tasks/reorder", status_code=204)
async def reorder_tasks(
    project_id: str,
    data: TaskReorderRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.task import Task as TaskModel

    await require_project_access(project_id, current_user, db)
    task_ids = [item.task_id for item in data.items]
    tasks = (await db.execute(
        select(TaskModel).where(TaskModel.id.in_(task_ids), TaskModel.project_id == project_id)
    )).scalars().all()
    order_map = {item.task_id: item.order for item in data.items}
    for task in tasks:
        task.order = order_map[task.id]

    all_project_tasks = (
        await db.execute(select(TaskModel).where(TaskModel.project_id == project_id))
    ).scalars().all()
    renumber_task_titles_after_reorder(all_project_tasks)
    await db.commit()


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


@router.get("/projects/{project_id}/dependency-graph")
async def dependency_graph(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    await _require_project_visibility(project_id, current_user, db)
    return await get_dependency_graph(db, project_id)


@router.get("/projects/{project_id}/time-summary")
async def project_time_summary(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    await _require_project_visibility(project_id, current_user, db)
    return await get_project_time_summary(db, project_id)


@router.get("/projects/{project_id}/external-deps")
async def project_external_deps(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.external_dep_service import list_deps_for_project
    await _require_project_exists(project_id, db)
    await _require_project_visibility(project_id, current_user, db)
    return await list_deps_for_project(db, project_id)


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


# ── Custom field values ───────────────────────────────────────────────────────

@router.get("/tasks/{task_id}/custom-values")
async def get_custom_values(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_project_visibility(task.project_id, current_user, db)
    return await get_task_custom_values(db, task_id)


@router.put("/tasks/{task_id}/custom-values")
async def save_custom_values(
    task_id: str,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task_id, current_user, db)
    # data is {field_id: value_string}
    return await save_task_custom_values(db, task_id=task_id, values=data)


# ── External dependencies (contractors / blockers) ────────────────────────────

@router.get("/tasks/{task_id}/external-deps")
async def list_external_deps(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.external_dep_service import list_deps
    task = await get_task_or_404(db, task_id)
    await _require_project_visibility(task.project_id, current_user, db)
    return await list_deps(db, task_id)


@router.post("/tasks/{task_id}/external-deps", status_code=201)
async def create_external_dep(
    task_id: str,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.external_dep_service import create_dep
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task_id, current_user, db)
    return await create_dep(db, task_id, data)


@router.put("/tasks/{task_id}/external-deps/{dep_id}")
async def update_external_dep(
    task_id: str,
    dep_id: str,
    data: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.external_dep_service import update_dep
    from fastapi import HTTPException
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task_id, current_user, db)
    result = await update_dep(db, dep_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="External dep not found")
    return result


@router.delete("/tasks/{task_id}/external-deps/{dep_id}", status_code=204)
async def delete_external_dep(
    task_id: str,
    dep_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.services.external_dep_service import delete_dep
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task_id, current_user, db)
    await delete_dep(db, dep_id)
