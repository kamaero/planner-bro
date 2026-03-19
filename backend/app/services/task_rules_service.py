from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.models.task import Task, TaskDependency


def is_strict_project(project: Project) -> bool:
    return getattr(project, "planning_mode", "flexible") == "strict"


def validate_strict_past_dates(
    project: Project,
    *,
    start_date: date | None,
    end_date: date | None,
) -> None:
    if not is_strict_project(project):
        return
    today = date.today()
    if getattr(project, "strict_no_past_start_date", False) and start_date and start_date < today:
        raise HTTPException(status_code=422, detail="В строгом режиме дата начала не может быть в прошлом")
    if getattr(project, "strict_no_past_end_date", False) and end_date and end_date < today:
        raise HTTPException(status_code=422, detail="В строгом режиме дедлайн не может быть в прошлом")


def validate_child_dates_within_parent(
    project: Project,
    *,
    parent: Task | None,
    start_date: date | None,
    end_date: date | None,
) -> None:
    if not is_strict_project(project):
        return
    if not getattr(project, "strict_child_within_parent_dates", True):
        return
    if not parent:
        return
    if start_date and parent.start_date and start_date < parent.start_date:
        raise HTTPException(status_code=422, detail="Дата начала дочерней задачи раньше даты начала родительской")
    if end_date and parent.end_date and end_date > parent.end_date:
        raise HTTPException(status_code=422, detail="Дедлайн дочерней задачи позже дедлайна родительской")


async def ensure_predecessors_done(task: Task, target_status: str, db: AsyncSession) -> None:
    if target_status in ("planning", "tz", "todo", "done"):
        return
    deps = (
        await db.execute(
            select(TaskDependency.predecessor_task_id).where(
                TaskDependency.successor_task_id == task.id,
                TaskDependency.dependency_type == "finish_to_start",
            )
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
