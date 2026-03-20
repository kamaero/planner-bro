from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import TaskDependency
from app.models.user import User
from app.services.task_access_service import require_task_editor as _require_task_editor
from app.services.task_dependency_service import (
    apply_outgoing_fs_autoplan as _apply_outgoing_fs_autoplan,
    dependency_short_label as _dependency_short_label,
    enforce_dependency_dates_or_autoplan as _enforce_dependency_dates_or_autoplan,
    get_dependency_or_404 as _get_dependency_or_404,
    list_dependencies_for_successor as _list_dependencies_for_successor,
    upsert_dependency as _upsert_dependency,
)
from app.services.task_lifecycle_service import rollup_parent_schedule as _rollup_parent_schedule
from app.services.task_service import get_task_or_404


async def list_dependencies_for_task_editor(
    db: AsyncSession,
    *,
    task_id: str,
    actor: User,
) -> list[TaskDependency]:
    task = await get_task_or_404(db, task_id)
    await _require_task_editor(task, actor, db)
    return await _list_dependencies_for_successor(db, task_id)


async def add_dependency_for_task_editor(
    db: AsyncSession,
    *,
    task_id: str,
    predecessor_task_id: str,
    dependency_type: str,
    lag_days: int | None,
    actor: User,
    log_task_event,
) -> TaskDependency:
    successor = await get_task_or_404(db, task_id)
    await _require_task_editor(successor, actor, db)

    predecessor = await get_task_or_404(db, predecessor_task_id, detail="Predecessor task not found")
    normalized_lag_days = max(0, int(lag_days or 0))
    dep = await _upsert_dependency(
        db,
        successor=successor,
        predecessor=predecessor,
        actor_id=actor.id,
        dependency_type=dependency_type,
        lag_days=normalized_lag_days,
    )
    await _enforce_dependency_dates_or_autoplan(
        predecessor,
        successor,
        dep.dependency_type,
        normalized_lag_days,
        auto_shift_fs=True,
    )
    await _apply_outgoing_fs_autoplan(db, successor.id)
    await _rollup_parent_schedule(db, successor.parent_task_id)
    await log_task_event(
        db,
        successor.id,
        actor.id,
        "dependency_added",
        f"{predecessor.id}->{successor.id} [{_dependency_short_label(dep.dependency_type)};+{normalized_lag_days}d]",
    )
    await db.commit()
    await db.refresh(dep)
    return dep


async def remove_dependency_for_task_editor(
    db: AsyncSession,
    *,
    task_id: str,
    predecessor_task_id: str,
    actor: User,
    log_task_event,
) -> None:
    successor = await get_task_or_404(db, task_id)
    await _require_task_editor(successor, actor, db)
    dep = await _get_dependency_or_404(
        db,
        successor_task_id=task_id,
        predecessor_task_id=predecessor_task_id,
    )
    await db.delete(dep)
    await log_task_event(
        db,
        successor.id,
        actor.id,
        "dependency_removed",
        f"{predecessor_task_id}->{task_id}",
    )
    await db.commit()
