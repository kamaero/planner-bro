from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import Task, TaskComment, TaskEvent, TaskDependency
from app.models.project import Project, ProjectMember
from app.models.deadline_change import DeadlineChange
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
from app.services.task_service import get_tasks_for_project, get_task_by_id
from app.services.notification_service import (
    notify_task_assigned,
    notify_task_updated,
    notify_new_task,
    notify_check_in_help_requested,
)
from app.services.check_in_policy import compute_next_check_in_due_at

router = APIRouter(tags=["tasks"])


async def _require_project_member(project_id: str, user: User, db: AsyncSession):
    if not await _is_project_member(project_id, user, db):
        raise HTTPException(status_code=403, detail="Access denied")


async def _require_project_manager(project_id: str, user: User, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not member or member.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Manager access required")


def _require_bulk_permission(user: User) -> None:
    if user.role == "admin":
        return
    if not user.can_bulk_edit:
        raise HTTPException(status_code=403, detail="No permission for bulk operations")


def _require_delete_permission(user: User) -> None:
    if user.role == "admin":
        return
    if not user.can_delete:
        raise HTTPException(status_code=403, detail="No permission to delete tasks")


async def _is_project_member(project_id: str, user: User, db: AsyncSession) -> bool:
    if user.role == "admin":
        return True
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id
        )
    )
    return result.scalar_one_or_none() is not None


async def _require_project_exists(project_id: str, db: AsyncSession) -> None:
    exists = (await db.execute(select(Project.id).where(Project.id == project_id))).scalar_one_or_none()
    if not exists:
        raise HTTPException(status_code=404, detail="Project not found")


async def _ensure_member_for_assignee(project_id: str, assignee_id: str, db: AsyncSession) -> None:
    user = (await db.execute(select(User).where(User.id == assignee_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Assignee not found")
    member = (
        await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == assignee_id,
            )
        )
    ).scalar_one_or_none()
    if not member:
        db.add(ProjectMember(project_id=project_id, user_id=assignee_id, role="member"))
        await db.flush()


async def _require_task_editor(task: Task, user: User, db: AsyncSession) -> None:
    if user.role == "admin":
        return
    if task.assigned_to_id == user.id:
        return
    if await _is_project_member(task.project_id, user, db):
        return
    raise HTTPException(status_code=403, detail="Edit access denied")


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


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_priority_for_control_ski(priority: str, control_ski: bool) -> str:
    if control_ski:
        return "critical"
    if priority == "critical":
        return "medium"
    return priority


def _prepare_escalation_fields(payload: dict, task_created_at: datetime | None = None) -> None:
    is_escalation = bool(payload.get("is_escalation"))
    if not is_escalation:
        payload["escalation_due_at"] = None
        payload["escalation_first_response_at"] = None
        payload["escalation_overdue_at"] = None
        payload["escalation_sla_hours"] = int(payload.get("escalation_sla_hours") or 24)
        return

    sla_hours = int(payload.get("escalation_sla_hours") or 24)
    if sla_hours < 1:
        sla_hours = 1
    payload["escalation_sla_hours"] = sla_hours
    if not payload.get("escalation_due_at"):
        base_dt = task_created_at or _now_utc()
        payload["escalation_due_at"] = base_dt + timedelta(hours=sla_hours)


async def _mark_escalation_response(task: Task, actor_id: str, db: AsyncSession) -> None:
    if (
        task.is_escalation
        and task.assigned_to_id
        and task.assigned_to_id == actor_id
        and task.escalation_first_response_at is None
    ):
        task.escalation_first_response_at = _now_utc()
        await _log_task_event(db, task.id, actor_id, "escalation_first_response")


async def _ensure_predecessors_done(task: Task, target_status: str, db: AsyncSession) -> None:
    if target_status in ("todo", "done"):
        return
    deps = (
        await db.execute(
            select(TaskDependency.predecessor_task_id).where(TaskDependency.successor_task_id == task.id)
        )
    ).all()
    predecessor_ids = [row[0] for row in deps]
    if not predecessor_ids:
        return
    not_done = (
        await db.execute(
            select(Task.title).where(Task.id.in_(predecessor_ids), Task.status != "done")
        )
    ).scalars().all()
    if not_done:
        raise HTTPException(
            status_code=409,
            detail=f"Нельзя начать задачу до завершения зависимостей: {', '.join(not_done[:3])}",
        )


def _plan_next_check_in(task: Task, base_dt: datetime) -> datetime | None:
    if task.status == "done":
        return None
    return compute_next_check_in_due_at(task, from_dt=base_dt)


async def _has_dependency_path(
    db: AsyncSession, start_task_id: str, target_task_id: str
) -> bool:
    visited: set[str] = set()
    queue: list[str] = [start_task_id]
    while queue:
        current = queue.pop(0)
        if current == target_task_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        next_rows = await db.execute(
            select(TaskDependency.successor_task_id).where(TaskDependency.predecessor_task_id == current)
        )
        queue.extend([row[0] for row in next_rows.all() if row[0] not in visited])
    return False


@router.get("/projects/{project_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    return await get_tasks_for_project(db, project_id)


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: str,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_member(project_id, current_user, db)
    payload = data.model_dump()
    _prepare_escalation_fields(payload)
    payload["priority"] = _normalize_priority_for_control_ski(
        payload.get("priority", "medium"),
        bool(payload.get("control_ski")),
    )
    if payload.get("is_escalation") and not payload.get("assigned_to_id"):
        owner_id = (
            await db.execute(select(Project.owner_id).where(Project.id == project_id))
        ).scalar_one_or_none()
        if owner_id:
            payload["assigned_to_id"] = owner_id

    if payload.get("assigned_to_id"):
        await _ensure_member_for_assignee(project_id, payload["assigned_to_id"], db)
    task = Task(**payload, project_id=project_id, created_by_id=current_user.id)
    task.next_check_in_due_at = _plan_next_check_in(task, _now_utc())
    db.add(task)
    await db.flush()
    await _log_task_event(
        db,
        task.id,
        current_user.id,
        "task_created",
        f"is_escalation={task.is_escalation};assignee={task.assigned_to_id or ''}",
    )

    # Notify assignee
    if task.assigned_to_id:
        await notify_task_assigned(db, task, task.assigned_to_id)

    await notify_new_task(db, task)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)

    old_assignee = task.assigned_to_id
    old_status = task.status
    old_start_date = task.start_date
    old_end_date = task.end_date
    payload = data.model_dump(exclude_none=True)
    deadline_change_reason = payload.pop("deadline_change_reason", None)

    # Validate deadline change requires a reason
    new_end_date = payload.get("end_date")
    if new_end_date is not None and new_end_date != old_end_date:
        if not deadline_change_reason:
            raise HTTPException(status_code=422, detail="Укажите причину изменения дедлайна")

    if any(
        key in payload
        for key in (
            "is_escalation",
            "escalation_sla_hours",
            "escalation_due_at",
        )
    ):
        projected = {
            "is_escalation": payload.get("is_escalation", task.is_escalation),
            "escalation_sla_hours": payload.get("escalation_sla_hours", task.escalation_sla_hours),
            "escalation_due_at": payload.get("escalation_due_at", task.escalation_due_at),
            "escalation_first_response_at": payload.get(
                "escalation_first_response_at", task.escalation_first_response_at
            ),
            "escalation_overdue_at": payload.get("escalation_overdue_at", task.escalation_overdue_at),
        }
        _prepare_escalation_fields(projected, task.created_at)
        payload.update(projected)

    for field, value in payload.items():
        setattr(task, field, value)

    if task.status == "done":
        task.next_check_in_due_at = None
    elif old_status == "done" and task.status != "done":
        task.next_check_in_due_at = _plan_next_check_in(task, _now_utc())

    # Record deadline change if end_date actually changed
    if new_end_date is not None and new_end_date != old_end_date and deadline_change_reason:
        db.add(DeadlineChange(
            entity_type="task",
            entity_id=task.id,
            changed_by_id=current_user.id,
            old_date=old_end_date,
            new_date=new_end_date,
            reason=deadline_change_reason,
        ))

    # Log date_changed events to task_events
    new_start_date = payload.get("start_date")
    if new_start_date is not None and new_start_date != old_start_date:
        await _log_task_event(
            db, task.id, current_user.id, "date_changed",
            f"start:{old_start_date}->{task.start_date}",
        )
    if new_end_date is not None and new_end_date != old_end_date:
        await _log_task_event(
            db, task.id, current_user.id, "date_changed",
            f"end:{old_end_date}->{task.end_date}",
            reason=deadline_change_reason,
        )

    task.priority = _normalize_priority_for_control_ski(task.priority, bool(task.control_ski))
    await db.flush()

    if "assigned_to_id" in payload and task.assigned_to_id:
        await _ensure_member_for_assignee(task.project_id, task.assigned_to_id, db)

    # Notify new assignee
    if task.assigned_to_id and task.assigned_to_id != old_assignee:
        await notify_task_assigned(db, task, task.assigned_to_id)
        await _log_task_event(
            db,
            task.id,
            current_user.id,
            "assignee_changed",
            f"{old_assignee or ''}->{task.assigned_to_id}",
        )
    if task.status != old_status:
        await _log_task_event(
            db,
            task.id,
            current_user.id,
            "status_changed",
            f"{old_status}->{task.status}",
        )
    await _mark_escalation_response(task, current_user.id, db)

    await notify_task_updated(db, task, current_user.id)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.get("/tasks/{task_id}/dependencies", response_model=list[TaskDependencyOut])
async def list_task_dependencies(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)
    result = await db.execute(
        select(TaskDependency)
        .where(TaskDependency.successor_task_id == task_id)
        .order_by(TaskDependency.created_at.asc())
    )
    return result.scalars().all()


@router.post("/tasks/{task_id}/dependencies", response_model=TaskDependencyOut, status_code=201)
async def add_task_dependency(
    task_id: str,
    data: TaskDependencyCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    successor = await get_task_by_id(db, task_id)
    if not successor:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(successor, current_user, db)

    predecessor = await get_task_by_id(db, data.predecessor_task_id)
    if not predecessor:
        raise HTTPException(status_code=404, detail="Predecessor task not found")
    if predecessor.project_id != successor.project_id:
        raise HTTPException(status_code=400, detail="Dependencies must be inside one project")
    if predecessor.id == successor.id:
        raise HTTPException(status_code=400, detail="Task cannot depend on itself")

    exists = (
        await db.execute(
            select(TaskDependency).where(
                TaskDependency.predecessor_task_id == predecessor.id,
                TaskDependency.successor_task_id == successor.id,
            )
        )
    ).scalar_one_or_none()
    if exists:
        return exists

    if await _has_dependency_path(db, successor.id, predecessor.id):
        raise HTTPException(status_code=400, detail="Dependency cycle is not allowed")

    dep = TaskDependency(
        predecessor_task_id=predecessor.id,
        successor_task_id=successor.id,
        created_by_id=current_user.id,
    )
    db.add(dep)
    await _log_task_event(
        db,
        successor.id,
        current_user.id,
        "dependency_added",
        f"{predecessor.id}->{successor.id}",
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
    successor = await get_task_by_id(db, task_id)
    if not successor:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(successor, current_user, db)
    dep = (
        await db.execute(
            select(TaskDependency).where(
                TaskDependency.successor_task_id == task_id,
                TaskDependency.predecessor_task_id == predecessor_task_id,
            )
        )
    ).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
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
    _require_bulk_permission(current_user)
    await _require_project_exists(project_id, db)
    await _require_project_manager(project_id, current_user, db)

    raw_ids = [task_id.strip() for task_id in data.task_ids if task_id.strip()]
    task_ids = list(dict.fromkeys(raw_ids))
    if not task_ids:
        raise HTTPException(status_code=400, detail="task_ids must contain at least one id")

    payload = data.model_dump(exclude_unset=True)
    payload.pop("task_ids", None)
    delete_requested = bool(payload.pop("delete", False))
    if delete_requested and payload:
        raise HTTPException(status_code=400, detail="delete cannot be combined with update fields")
    if not delete_requested and not payload:
        raise HTTPException(status_code=400, detail="No changes specified")
    if delete_requested:
        _require_delete_permission(current_user)

    if "status" in payload:
        valid_statuses = {"todo", "in_progress", "review", "done"}
        if payload["status"] not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    if "priority" in payload:
        valid_priorities = {"low", "medium", "high", "critical"}
        if payload["priority"] not in valid_priorities:
            raise HTTPException(
                status_code=400, detail=f"Invalid priority. Must be one of: {valid_priorities}"
            )
    if "assigned_to_id" in payload and payload["assigned_to_id"]:
        await _ensure_member_for_assignee(project_id, payload["assigned_to_id"], db)

    tasks = (
        await db.execute(
            select(Task)
            .where(
                Task.project_id == project_id,
                Task.id.in_(task_ids),
            )
            .options(selectinload(Task.assignee))
        )
    ).scalars().all()

    requested = len(task_ids)
    result = TaskBulkUpdateResult(requested=requested, skipped=max(0, requested - len(tasks)))

    if delete_requested:
        for task in tasks:
            await _log_task_event(db, task.id, current_user.id, "task_deleted_bulk")
            await db.delete(task)
            result.deleted += 1
        await db.commit()
        return result

    for task in tasks:
        old_status = task.status
        old_assignee = task.assigned_to_id
        changed = False

        if "status" in payload:
            await _ensure_predecessors_done(task, payload["status"], db)

        for field, value in payload.items():
            if getattr(task, field) != value:
                setattr(task, field, value)
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
        result.updated += 1

        if task.status != old_status:
            await _log_task_event(
                db,
                task.id,
                current_user.id,
                "status_changed",
                f"{old_status}->{task.status}",
            )
        if task.assigned_to_id != old_assignee:
            await _log_task_event(
                db,
                task.id,
                current_user.id,
                "assignee_changed",
                f"{old_assignee or ''}->{task.assigned_to_id or ''}",
            )
            if task.assigned_to_id:
                await notify_task_assigned(db, task, task.assigned_to_id)

        await _log_task_event(
            db,
            task.id,
            current_user.id,
            "task_bulk_updated",
            ",".join(sorted(payload.keys())),
        )
        await _mark_escalation_response(task, current_user.id, db)
        await notify_task_updated(db, task, current_user.id)

    await db.commit()
    return result


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_delete_permission(current_user)
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)
    await _log_task_event(db, task.id, current_user.id, "task_deleted")
    await db.delete(task)
    await db.commit()


@router.patch("/tasks/{task_id}/status", response_model=TaskOut)
async def update_task_status(
    task_id: str,
    data: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)

    valid_statuses = {"todo", "in_progress", "review", "done"}
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    await _ensure_predecessors_done(task, data.status, db)

    now = _now_utc()
    task.status = data.status
    if data.progress_percent is not None:
        task.progress_percent = data.progress_percent
    elif data.status == "done":
        task.progress_percent = 100
    if data.next_step is not None:
        task.next_step = data.next_step.strip() or None
    task.last_check_in_at = now
    task.last_check_in_note = "Статус обновлен"
    task.next_check_in_due_at = _plan_next_check_in(task, now)
    await _log_task_event(db, task.id, current_user.id, "status_changed", data.status)
    if data.progress_percent is not None:
        await _log_task_event(
            db,
            task.id,
            current_user.id,
            "progress_updated",
            str(data.progress_percent),
        )
    if data.next_step is not None:
        await _log_task_event(
            db,
            task.id,
            current_user.id,
            "next_step_updated",
            task.next_step,
        )

    if data.status == "done" and task.repeat_every_days and task.repeat_every_days > 0:
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
            created_by_id=current_user.id,
            estimated_hours=task.estimated_hours,
        )
        db.add(next_task)
        await db.flush()
        await _log_task_event(
            db,
            next_task.id,
            current_user.id,
            "task_created_from_recurrence",
            f"source={task.id}",
        )
    await notify_task_updated(db, task, current_user.id)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.post("/tasks/{task_id}/check-in", response_model=TaskOut)
async def check_in_task(
    task_id: str,
    data: TaskCheckInCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)

    now = _now_utc()
    summary = data.summary.strip()
    blockers = data.blockers.strip() if data.blockers else None

    task.last_check_in_at = now
    task.last_check_in_note = summary
    if task.status == "done":
        task.next_check_in_due_at = None
    elif data.next_check_in_due_at:
        task.next_check_in_due_at = data.next_check_in_due_at
    else:
        task.next_check_in_due_at = _plan_next_check_in(task, now)

    comment_lines = [f"CHECK-IN: {summary}"]
    if blockers:
        comment_lines.append(f"Blockers: {blockers}")
    comment_lines.append(
        f"Next check-in due: {task.next_check_in_due_at.isoformat() if task.next_check_in_due_at else 'n/a'}"
    )
    if data.need_manager_help:
        comment_lines.append("Manager help requested: yes")
    comment = TaskComment(task_id=task.id, author_id=current_user.id, body="\n".join(comment_lines))
    db.add(comment)

    await _log_task_event(
        db,
        task.id,
        current_user.id,
        "check_in_recorded",
        f"help={'1' if data.need_manager_help else '0'}",
    )
    await _mark_escalation_response(task, current_user.id, db)
    await db.commit()

    if data.need_manager_help:
        await notify_check_in_help_requested(
            db,
            task=task,
            actor_id=current_user.id,
            actor_name=current_user.name,
            summary=summary,
            blockers=blockers,
        )

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.get("/tasks/escalations/inbox", response_model=list[TaskOut])
async def escalation_inbox(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task)
        .where(
            Task.is_escalation == True,  # noqa: E712
            Task.assigned_to_id == current_user.id,
            Task.status != "done",
        )
        .options(selectinload(Task.assignee))
        .order_by(Task.created_at.desc())
    )
    return result.scalars().all()


@router.get("/projects/{project_id}/critical-path")
async def critical_path(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_exists(project_id, db)
    tasks = (await db.execute(select(Task).where(Task.project_id == project_id))).scalars().all()
    by_id = {t.id: t for t in tasks}
    children: dict[str, list[str]] = {}
    roots: list[str] = []
    for t in tasks:
        if t.parent_task_id and t.parent_task_id in by_id:
            children.setdefault(t.parent_task_id, []).append(t.id)
        else:
            roots.append(t.id)

    def score(task_id: str) -> tuple[int, list[str]]:
        childs = children.get(task_id, [])
        if not childs:
            return 1, [task_id]
        best = (0, [])
        for c in childs:
            s = score(c)
            if s[0] > best[0]:
                best = s
        return best[0] + 1, [task_id] + best[1]

    best_path: list[str] = []
    best_len = 0
    for r in roots:
        l, p = score(r)
        if l > best_len:
            best_len = l
            best_path = p

    return {
        "project_id": project_id,
        "length": best_len,
        "task_ids": best_path,
        "tasks": [
            {
                "id": tid,
                "title": by_id[tid].title,
                "status": by_id[tid].status,
                "end_date": by_id[tid].end_date.isoformat() if by_id[tid].end_date else None,
            }
            for tid in best_path
        ],
    }


@router.get("/tasks/{task_id}/comments", response_model=list[TaskCommentOut])
async def list_task_comments(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.task_id == task_id)
        .options(selectinload(TaskComment.author))
        .order_by(TaskComment.created_at.asc())
    )
    return result.scalars().all()


@router.post("/tasks/{task_id}/comments", response_model=TaskCommentOut, status_code=201)
async def add_task_comment(
    task_id: str,
    data: TaskCommentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_task_editor(task, current_user, db)
    comment = TaskComment(task_id=task_id, author_id=current_user.id, body=data.body)
    db.add(comment)
    await db.flush()
    await _mark_escalation_response(task, current_user.id, db)
    await _log_task_event(db, task_id, current_user.id, "comment_added")
    await db.commit()
    result = await db.execute(
        select(TaskComment).where(TaskComment.id == comment.id).options(selectinload(TaskComment.author))
    )
    return result.scalar_one()


@router.get("/tasks/{task_id}/events", response_model=list[TaskEventOut])
async def list_task_events(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    result = await db.execute(
        select(TaskEvent)
        .where(TaskEvent.task_id == task_id)
        .order_by(TaskEvent.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()


@router.get("/tasks/{task_id}/deadline-history", response_model=list[DeadlineChangeOut])
async def list_task_deadline_history(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    result = await db.execute(
        select(DeadlineChange)
        .where(DeadlineChange.entity_type == "task", DeadlineChange.entity_id == task_id)
        .options(selectinload(DeadlineChange.changed_by))
        .order_by(DeadlineChange.created_at.desc())
    )
    return result.scalars().all()
