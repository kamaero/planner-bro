from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskDependency
from app.services.task_service import get_task_by_id

TaskEventLogger = Callable[[AsyncSession, str, str | None, str, str | None, str | None], Awaitable[None]]


DEPENDENCY_TYPE_ALIASES = {
    "fs": "finish_to_start",
    "finish_to_start": "finish_to_start",
    "ss": "start_to_start",
    "start_to_start": "start_to_start",
    "ff": "finish_to_finish",
    "finish_to_finish": "finish_to_finish",
}


def normalize_dependency_type(raw: str | None) -> str:
    value = (raw or "finish_to_start").strip().lower()
    normalized = DEPENDENCY_TYPE_ALIASES.get(value)
    if not normalized:
        raise HTTPException(
            status_code=422,
            detail="dependency_type must be one of: finish_to_start(fs), start_to_start(ss), finish_to_finish(ff)",
        )
    return normalized


def dependency_short_label(dep_type: str) -> str:
    if dep_type == "start_to_start":
        return "SS"
    if dep_type == "finish_to_finish":
        return "FF"
    return "FS"


async def has_dependency_path(db: AsyncSession, start_task_id: str, target_task_id: str) -> bool:
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


async def enforce_dependency_dates_or_autoplan(
    predecessor: Task,
    successor: Task,
    dependency_type: str,
    lag_days: int,
    *,
    auto_shift_fs: bool,
) -> None:
    dep_type = normalize_dependency_type(dependency_type)
    lag = max(0, int(lag_days or 0))

    if dep_type == "finish_to_start":
        if predecessor.end_date is None:
            return
        required_start = predecessor.end_date + timedelta(days=lag)
        if successor.start_date is None:
            successor.start_date = required_start
        if successor.start_date >= required_start:
            return
        if not auto_shift_fs:
            raise HTTPException(
                status_code=422,
                detail="FS-зависимость нарушена: дата начала последующей задачи раньше завершения предшественника",
            )

        shift_days = (required_start - successor.start_date).days
        successor.start_date = required_start
        if successor.end_date is None:
            successor.end_date = required_start
        else:
            successor.end_date = successor.end_date + timedelta(days=shift_days)
        return

    if dep_type == "start_to_start":
        if predecessor.start_date is None or successor.start_date is None:
            return
        required_start = predecessor.start_date + timedelta(days=lag)
        if successor.start_date < required_start:
            raise HTTPException(
                status_code=422,
                detail="SS-зависимость нарушена: дата начала задачи раньше допустимой",
            )
        return

    if predecessor.end_date is None or successor.end_date is None:
        return
    required_end = predecessor.end_date + timedelta(days=lag)
    if successor.end_date < required_end:
        raise HTTPException(
            status_code=422,
            detail="FF-зависимость нарушена: дедлайн задачи раньше допустимого",
        )


async def apply_outgoing_fs_autoplan(db: AsyncSession, predecessor_id: str) -> None:
    queue: list[str] = [predecessor_id]
    visited: set[str] = set()
    while queue:
        current_id = queue.pop(0)
        if current_id in visited:
            continue
        visited.add(current_id)
        predecessor = await get_task_by_id(db, current_id)
        if not predecessor:
            continue

        links = (
            await db.execute(
                select(TaskDependency).where(
                    TaskDependency.predecessor_task_id == current_id,
                )
            )
        ).scalars().all()
        for link in links:
            successor = await get_task_by_id(db, link.successor_task_id)
            if not successor:
                continue
            before_start = successor.start_date
            before_end = successor.end_date
            await enforce_dependency_dates_or_autoplan(
                predecessor,
                successor,
                link.dependency_type,
                link.lag_days,
                auto_shift_fs=link.dependency_type == "finish_to_start",
            )
            if successor.start_date != before_start or successor.end_date != before_end:
                queue.append(successor.id)


async def sync_task_predecessors(
    db: AsyncSession,
    *,
    task: Task,
    predecessor_task_ids: list[str] | None,
    actor_id: str,
    log_task_event: TaskEventLogger,
) -> None:
    if predecessor_task_ids is None:
        return
    normalized = [pid.strip() for pid in predecessor_task_ids if pid and pid.strip()]
    unique_ids = list(dict.fromkeys(normalized))
    for predecessor_id in unique_ids:
        if predecessor_id == task.id:
            raise HTTPException(status_code=400, detail="Task cannot depend on itself")
        predecessor = await get_task_by_id(db, predecessor_id)
        if not predecessor:
            raise HTTPException(status_code=404, detail=f"Predecessor task not found: {predecessor_id}")
        if predecessor.project_id != task.project_id:
            raise HTTPException(status_code=400, detail="Dependencies must be inside one project")
        if await has_dependency_path(db, task.id, predecessor_id):
            raise HTTPException(status_code=400, detail="Dependency cycle is not allowed")

    existing_rows = (
        await db.execute(select(TaskDependency).where(TaskDependency.successor_task_id == task.id))
    ).scalars().all()
    existing_ids = {row.predecessor_task_id for row in existing_rows}
    desired_ids = set(unique_ids)

    for row in existing_rows:
        if row.predecessor_task_id not in desired_ids:
            await db.delete(row)
            await log_task_event(
                db,
                task.id,
                actor_id,
                "dependency_removed",
                f"{row.predecessor_task_id}->{task.id}",
            )

    for predecessor_id in unique_ids:
        if predecessor_id in existing_ids:
            continue
        db.add(
            TaskDependency(
                predecessor_task_id=predecessor_id,
                successor_task_id=task.id,
                created_by_id=actor_id,
                dependency_type="finish_to_start",
                lag_days=0,
            )
        )
        await log_task_event(
            db,
            task.id,
            actor_id,
            "dependency_added",
            f"{predecessor_id}->{task.id}",
        )


async def validate_incoming_dependency_rules(
    db: AsyncSession,
    *,
    task: Task,
    auto_shift_fs: bool,
) -> None:
    incoming = (
        await db.execute(
            select(TaskDependency).where(TaskDependency.successor_task_id == task.id)
        )
    ).scalars().all()
    for dep in incoming:
        predecessor = await get_task_by_id(db, dep.predecessor_task_id)
        if not predecessor:
            continue
        await enforce_dependency_dates_or_autoplan(
            predecessor,
            task,
            dep.dependency_type,
            dep.lag_days,
            auto_shift_fs=auto_shift_fs,
        )


async def upsert_dependency(
    db: AsyncSession,
    *,
    successor: Task,
    predecessor: Task,
    actor_id: str,
    dependency_type: str,
    lag_days: int,
) -> TaskDependency:
    if predecessor.project_id != successor.project_id:
        raise HTTPException(status_code=400, detail="Dependencies must be inside one project")
    if predecessor.id == successor.id:
        raise HTTPException(status_code=400, detail="Task cannot depend on itself")
    if await has_dependency_path(db, successor.id, predecessor.id):
        raise HTTPException(status_code=400, detail="Dependency cycle is not allowed")

    dep_type = normalize_dependency_type(dependency_type)
    lag = max(0, int(lag_days or 0))
    existing = (
        await db.execute(
            select(TaskDependency).where(
                TaskDependency.predecessor_task_id == predecessor.id,
                TaskDependency.successor_task_id == successor.id,
            )
        )
    ).scalar_one_or_none()

    dep = existing
    if dep is None:
        dep = TaskDependency(
            predecessor_task_id=predecessor.id,
            successor_task_id=successor.id,
            created_by_id=actor_id,
            dependency_type=dep_type,
            lag_days=lag,
        )
        db.add(dep)
    else:
        dep.dependency_type = dep_type
        dep.lag_days = lag
    return dep


async def get_dependency_or_404(
    db: AsyncSession,
    *,
    successor_task_id: str,
    predecessor_task_id: str,
) -> TaskDependency:
    dep = (
        await db.execute(
            select(TaskDependency).where(
                TaskDependency.successor_task_id == successor_task_id,
                TaskDependency.predecessor_task_id == predecessor_task_id,
            )
        )
    ).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    return dep


async def project_critical_path(db: AsyncSession, project_id: str) -> dict[str, object]:
    tasks = (await db.execute(select(Task).where(Task.project_id == project_id))).scalars().all()
    by_id = {task.id: task for task in tasks}
    children: dict[str, list[str]] = {}
    roots: list[str] = []
    for task in tasks:
        if task.parent_task_id and task.parent_task_id in by_id:
            children.setdefault(task.parent_task_id, []).append(task.id)
        else:
            roots.append(task.id)

    def score(task_id: str) -> tuple[int, list[str]]:
        childs = children.get(task_id, [])
        if not childs:
            return 1, [task_id]
        best = (0, [])
        for child_id in childs:
            scored = score(child_id)
            if scored[0] > best[0]:
                best = scored
        return best[0] + 1, [task_id] + best[1]

    best_path: list[str] = []
    best_len = 0
    for root_id in roots:
        length, path = score(root_id)
        if length > best_len:
            best_len = length
            best_path = path

    return {
        "project_id": project_id,
        "length": best_len,
        "task_ids": best_path,
        "tasks": [
            {
                "id": task_id,
                "title": by_id[task_id].title,
                "status": by_id[task_id].status,
                "end_date": by_id[task_id].end_date.isoformat() if by_id[task_id].end_date else None,
            }
            for task_id in best_path
        ],
    }
