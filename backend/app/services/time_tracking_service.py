"""Project time tracking summary.

Aggregates estimated_hours (plan) and actual_hours (fact) per project
and per assignee.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task
from app.models.user import User


async def get_project_time_summary(db: AsyncSession, project_id: str) -> dict:
    tasks = (
        await db.execute(select(Task).where(Task.project_id == project_id))
    ).scalars().all()

    if not tasks:
        return {
            "total_estimated": None,
            "total_actual": None,
            "by_assignee": [],
            "by_status": [],
        }

    # Aggregate totals
    total_estimated = sum(t.estimated_hours for t in tasks if t.estimated_hours is not None)
    total_actual = sum(float(t.actual_hours) for t in tasks if t.actual_hours is not None)

    has_estimated = any(t.estimated_hours is not None for t in tasks)
    has_actual    = any(t.actual_hours   is not None for t in tasks)

    # Per-assignee
    assignee_map: dict[str, dict] = {}
    unassigned = {"assignee_id": None, "assignee_name": "Без исполнителя", "estimated": 0.0, "actual": 0.0, "task_count": 0}

    for t in tasks:
        if not t.assigned_to_id:
            bucket = unassigned
        else:
            if t.assigned_to_id not in assignee_map:
                assignee_map[t.assigned_to_id] = {
                    "assignee_id": t.assigned_to_id,
                    "assignee_name": None,  # filled below
                    "estimated": 0.0,
                    "actual": 0.0,
                    "task_count": 0,
                }
            bucket = assignee_map[t.assigned_to_id]
        bucket["task_count"] += 1
        if t.estimated_hours is not None:
            bucket["estimated"] += t.estimated_hours
        if t.actual_hours is not None:
            bucket["actual"] += float(t.actual_hours)

    # Fill assignee names
    if assignee_map:
        users = (
            await db.execute(select(User).where(User.id.in_(assignee_map.keys())))
        ).scalars().all()
        for u in users:
            if u.id in assignee_map:
                assignee_map[u.id]["assignee_name"] = u.name

    by_assignee = list(assignee_map.values())
    if unassigned["task_count"] > 0:
        by_assignee.append(unassigned)
    by_assignee.sort(key=lambda x: -(x["estimated"] or 0))

    # Per-status
    status_map: dict[str, dict] = {}
    for t in tasks:
        if t.status not in status_map:
            status_map[t.status] = {"status": t.status, "estimated": 0.0, "actual": 0.0, "task_count": 0}
        status_map[t.status]["task_count"] += 1
        if t.estimated_hours is not None:
            status_map[t.status]["estimated"] += t.estimated_hours
        if t.actual_hours is not None:
            status_map[t.status]["actual"] += float(t.actual_hours)

    return {
        "total_estimated": total_estimated if has_estimated else None,
        "total_actual": round(total_actual, 2) if has_actual else None,
        "tasks_with_estimate": sum(1 for t in tasks if t.estimated_hours is not None),
        "tasks_with_actual": sum(1 for t in tasks if t.actual_hours is not None),
        "total_tasks": len(tasks),
        "by_assignee": by_assignee,
        "by_status": list(status_map.values()),
    }
