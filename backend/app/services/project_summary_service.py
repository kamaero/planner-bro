from __future__ import annotations

from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskAssignee
from app.models.deadline_change import DeadlineChange


async def compute_project_summary(db: AsyncSession, project_id: str) -> dict:
    today = date.today()

    tasks_result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
        )
    )
    tasks = tasks_result.scalars().all()

    total = len(tasks)
    counts: dict[str, int] = {"done": 0, "in_progress": 0, "planning": 0, "todo": 0, "other": 0}
    overdue = 0
    progress_sum = 0

    assignee_map: dict[str, dict] = {}

    for task in tasks:
        status = task.status
        if status in counts:
            counts[status] += 1
        else:
            counts["other"] += 1

        if status != "done" and task.end_date and task.end_date < today:
            overdue += 1

        progress_sum += task.progress_percent

        for user in task.assignees:
            if user:
                uid = user.id
                if uid not in assignee_map:
                    last = (user.last_name or "").strip()
                    first = (user.first_name or "").strip()
                    initials = f"{first[0].upper()}." if first else ""
                    name = " ".join(p for p in [last, initials] if p) or user.name or user.email
                    assignee_map[uid] = {"name": name, "count": 0}
                assignee_map[uid]["count"] += 1

    avg_progress = round(progress_sum / total) if total > 0 else 0
    top_assignees = sorted(assignee_map.values(), key=lambda x: x["count"], reverse=True)[:5]

    dc_result = await db.execute(
        select(DeadlineChange)
        .where(
            DeadlineChange.entity_type == "project",
            DeadlineChange.entity_id == project_id,
        )
        .options(selectinload(DeadlineChange.changed_by))
        .order_by(DeadlineChange.created_at.desc())
        .limit(5)
    )
    deadline_changes = dc_result.scalars().all()

    return {
        "task_counts": {
            "total": total,
            "done": counts["done"],
            "in_progress": counts["in_progress"],
            "planning": counts["planning"],
            "todo": counts["todo"],
            "other": counts["other"],
            "overdue": overdue,
        },
        "avg_progress": avg_progress,
        "top_assignees": top_assignees,
        "deadline_changes": [
            {
                "id": dc.id,
                "old_date": dc.old_date.isoformat() if dc.old_date else None,
                "new_date": dc.new_date.isoformat() if dc.new_date else None,
                "reason": dc.reason,
                "created_at": dc.created_at.isoformat(),
                "changed_by": dc.changed_by.name if dc.changed_by else None,
            }
            for dc in deadline_changes
        ],
        "generated_at": today.isoformat(),
    }
