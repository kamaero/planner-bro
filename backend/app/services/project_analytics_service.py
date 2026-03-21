from __future__ import annotations

from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.deadline_change import DeadlineChange
from app.models.project import Project
from app.models.task import Task


async def compute_deadline_stats_summary(db: AsyncSession) -> dict:
    all_changes = (
        await db.execute(
            select(DeadlineChange).options(selectinload(DeadlineChange.changed_by))
        )
    ).scalars().all()

    total_shifts = len(all_changes)
    task_ids_with_shifts = {c.entity_id for c in all_changes if c.entity_type == "task"}
    project_ids_with_shifts = {c.entity_id for c in all_changes if c.entity_type == "project"}
    shift_days = [abs((c.new_date - c.old_date).days) for c in all_changes]
    avg_shift_days = round(sum(shift_days) / len(shift_days), 1) if shift_days else 0.0

    today = date_type.today()
    real_overdue_tasks = []
    if task_ids_with_shifts:
        tasks_with_history = (
            await db.execute(
                select(Task).where(Task.id.in_(task_ids_with_shifts), Task.status != "done")
            )
        ).scalars().all()
        for task in tasks_with_history:
            task_changes = sorted(
                [c for c in all_changes if c.entity_type == "task" and c.entity_id == task.id],
                key=lambda c: c.created_at,
            )
            original_end = task_changes[0].old_date if task_changes else task.end_date
            if original_end and original_end < today:
                real_overdue_tasks.append(
                    {
                        "id": task.id,
                        "title": task.title,
                        "project_id": task.project_id,
                        "original_end_date": original_end.isoformat(),
                        "current_end_date": task.end_date.isoformat() if task.end_date else None,
                        "shifts": len(task_changes),
                    }
                )

    shifts_by_project_map: dict[str, int] = {}
    task_to_project: dict[str, str] = {}
    if task_ids_with_shifts:
        rows = (
            await db.execute(select(Task.id, Task.project_id).where(Task.id.in_(task_ids_with_shifts)))
        ).all()
        task_to_project = {task_id: project_id for task_id, project_id in rows}

    for change in all_changes:
        if change.entity_type == "task":
            pid = task_to_project.get(change.entity_id)
            if pid:
                shifts_by_project_map[pid] = shifts_by_project_map.get(pid, 0) + 1
            continue
        shifts_by_project_map[change.entity_id] = shifts_by_project_map.get(change.entity_id, 0) + 1

    project_names: dict[str, str] = {}
    if shifts_by_project_map:
        for pid, pname in (
            await db.execute(
                select(Project.id, Project.name).where(Project.id.in_(list(shifts_by_project_map.keys())))
            )
        ).all():
            project_names[pid] = pname

    shifts_by_project = [
        {"project_id": pid, "project_name": project_names.get(pid, pid), "shifts": count}
        for pid, count in sorted(shifts_by_project_map.items(), key=lambda item: -item[1])
    ]
    return {
        "total_shifts": total_shifts,
        "tasks_with_shifts": len(task_ids_with_shifts),
        "projects_with_shifts": len(project_ids_with_shifts),
        "avg_shift_days": avg_shift_days,
        "real_overdue_tasks": real_overdue_tasks,
        "shifts_by_project": shifts_by_project,
    }
