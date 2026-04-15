from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.task import Task
from app.services.check_in_policy import compute_next_check_in_due_at
from app.services.task_service import get_task_by_id

TaskEventLogger = Callable[[AsyncSession, str, str | None, str, str | None, str | None], Awaitable[None]]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


async def rollup_parent_schedule(db: AsyncSession, parent_task_id: str | None) -> None:
    cursor = parent_task_id
    visited: set[str] = set()
    while cursor and cursor not in visited:
        visited.add(cursor)
        parent = await get_task_by_id(db, cursor)
        if not parent:
            break

        min_start, max_end = (
            await db.execute(
                select(
                    func.min(Task.start_date),
                    func.max(Task.end_date),
                ).where(Task.parent_task_id == parent.id)
            )
        ).one()

        if parent.start_date != min_start:
            parent.start_date = min_start
        if parent.end_date != max_end:
            parent.end_date = max_end

        cursor = parent.parent_task_id


def normalize_priority_for_control_ski(priority: str, control_ski: bool) -> str:
    if control_ski:
        return "critical"
    return priority


def prepare_escalation_fields(payload: dict, task_created_at: datetime | None = None) -> None:
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
        base_dt = task_created_at or now_utc()
        payload["escalation_due_at"] = base_dt + timedelta(hours=sla_hours)


async def mark_escalation_response(
    task: Task,
    actor_id: str,
    db: AsyncSession,
    log_task_event: TaskEventLogger,
) -> None:
    if (
        task.is_escalation
        and task.assigned_to_id
        and task.assigned_to_id == actor_id
        and task.escalation_first_response_at is None
    ):
        task.escalation_first_response_at = now_utc()
        await log_task_event(db, task.id, actor_id, "escalation_first_response")


def plan_next_check_in(task: Task, base_dt: datetime) -> datetime | None:
    if task.status == "done":
        return None
    return compute_next_check_in_due_at(task, from_dt=base_dt)


async def validate_parent_task(
    db: AsyncSession,
    *,
    project_id: str,
    task_id: str,
    parent_task_id: str | None,
) -> Task | None:
    if not parent_task_id:
        return None
    if parent_task_id == task_id:
        raise HTTPException(status_code=400, detail="Task cannot be its own parent")
    parent = await get_task_by_id(db, parent_task_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent task not found")
    if parent.project_id != project_id:
        raise HTTPException(status_code=400, detail="Parent must be in the same project")

    visited: set[str] = set()
    cursor: str | None = parent_task_id
    while cursor:
        if cursor == task_id:
            raise HTTPException(status_code=400, detail="Parent-child cycle is not allowed")
        if cursor in visited:
            break
        visited.add(cursor)
        cursor = (
            await db.execute(select(Task.parent_task_id).where(Task.id == cursor))
        ).scalar_one_or_none()
    return parent


async def get_project_settings(project_id: str, db: AsyncSession) -> Project:
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project
