"""
Workload calendar service.
Returns per-user, per-day task load within a date range.
Hours are distributed evenly across the task's date span.
"""
from datetime import date, timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskAssignee
from app.models.user import User
from app.models.project import Project
from app.models.department import Department


_DAILY_CAPACITY = 8.0  # hours per person per day


async def get_workload(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    department_id: str | None = None,
) -> dict:
    # 1. Fetch active users (optionally filtered by department)
    users_q = (
        select(User)
        .options(selectinload(User.department))
        .where(User.is_active == True)
    )
    if department_id:
        users_q = users_q.where(User.department_id == department_id)
    users = list((await db.execute(users_q)).scalars().all())
    user_ids = [u.id for u in users]

    if not user_ids:
        return {
            "dates": _date_range(start_date, end_date),
            "users": [],
            "departments": [],
        }

    # 2. Fetch tasks overlapping [start_date, end_date] assigned to these users.
    #    Tasks can be assigned via TaskAssignee (many-to-many) OR assigned_to_id (legacy).
    date_filter = [
        Task.start_date != None,
        Task.end_date != None,
        Task.start_date <= end_date,
        Task.end_date >= start_date,
    ]

    # 2a. Via TaskAssignee join table
    q_joinee = (
        select(Task, TaskAssignee.user_id, Project.name.label("project_name"))
        .join(TaskAssignee, TaskAssignee.task_id == Task.id)
        .join(Project, Project.id == Task.project_id)
        .where(TaskAssignee.user_id.in_(user_ids), *date_filter)
    )
    rows_joinee = (await db.execute(q_joinee)).all()

    # 2b. Via assigned_to_id (primary assignee field)
    q_direct = (
        select(Task, Task.assigned_to_id, Project.name.label("project_name"))
        .join(Project, Project.id == Task.project_id)
        .where(Task.assigned_to_id.in_(user_ids), *date_filter)
    )
    rows_direct = (await db.execute(q_direct)).all()

    # Merge, deduplicating by (task_id, user_id)
    seen: set[tuple[str, str]] = set()
    merged_rows: list[tuple] = []
    for row in list(rows_joinee) + list(rows_direct):
        task, uid, project_name = row
        key = (task.id, uid)
        if key not in seen:
            seen.add(key)
            merged_rows.append(row)

    # 3. Build workload map: user_id → day_str → {hours, tasks}
    workload: dict[str, dict[str, dict]] = {uid: {} for uid in user_ids}

    for task, uid, project_name in merged_rows:
        t_start: date = max(task.start_date, start_date)
        t_end: date = min(task.end_date, end_date)
        visible_days = (t_end - t_start).days + 1

        # Distribute estimated hours over the full task span
        full_span = (task.end_date - task.start_date).days + 1
        hours_per_day: float = (
            (task.estimated_hours / full_span) if task.estimated_hours else 0.0
        )

        task_info = {
            "id": task.id,
            "title": task.title,
            "project_id": task.project_id,
            "project_name": project_name,
            "priority": task.priority,
            "status": task.status,
        }

        for i in range(visible_days):
            day = t_start + timedelta(days=i)
            day_str = day.isoformat()
            entry = workload[uid].setdefault(day_str, {"hours": 0.0, "tasks": []})
            entry["hours"] += hours_per_day
            entry["tasks"].append(task_info)

    # 4. Collect departments for the filter UI
    dept_ids = {u.department_id for u in users if u.department_id}
    dept_map: dict[str, str] = {}
    if dept_ids:
        dept_rows = (
            await db.execute(select(Department).where(Department.id.in_(dept_ids)))
        ).scalars().all()
        dept_map = {d.id: d.name for d in dept_rows}

    return {
        "dates": _date_range(start_date, end_date),
        "daily_capacity": _DAILY_CAPACITY,
        "users": [
            {
                "id": u.id,
                "name": f"{u.first_name} {u.last_name}".strip() or u.email,
                "department_id": u.department_id,
                "department_name": dept_map.get(u.department_id) if u.department_id else None,
                "days": workload[u.id],
            }
            for u in users
        ],
        "departments": [
            {"id": did, "name": dname} for did, dname in sorted(dept_map.items(), key=lambda x: x[1])
        ],
    }


def _date_range(start: date, end: date) -> list[str]:
    days = (end - start).days + 1
    return [(start + timedelta(days=i)).isoformat() for i in range(days)]
