"""Build a dependency graph for a project.

Returns nodes (tasks) and edges (dependencies) in a format suitable
for the frontend React Flow visualisation.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskDependency
from app.models.user import User


async def get_dependency_graph(db: AsyncSession, project_id: str) -> dict:
    tasks = (
        await db.execute(select(Task).where(Task.project_id == project_id))
    ).scalars().all()

    if not tasks:
        return {"nodes": [], "edges": []}

    task_ids = {t.id for t in tasks}

    # Load all dependencies for this project in one query
    deps = (
        await db.execute(
            select(TaskDependency).where(
                TaskDependency.predecessor_task_id.in_(task_ids),
                TaskDependency.successor_task_id.in_(task_ids),
            )
        )
    ).scalars().all()

    # Build critical path via longest dependency chain (using dependency edges)
    critical_ids = _compute_critical_ids(tasks, deps)

    today = date.today()

    # Load assignee names in one query
    assignee_ids = {t.assigned_to_id for t in tasks if t.assigned_to_id}
    assignee_names: dict[str, str] = {}
    if assignee_ids:
        users = (
            await db.execute(select(User).where(User.id.in_(assignee_ids)))
        ).scalars().all()
        assignee_names = {u.id: u.name for u in users}

    nodes = []
    for t in tasks:
        is_overdue = bool(t.end_date and t.end_date < today and t.status != "done")
        nodes.append({
            "id": t.id,
            "title": t.title,
            "status": t.status,
            "priority": t.priority,
            "end_date": t.end_date.isoformat() if t.end_date else None,
            "assignee_name": assignee_names.get(t.assigned_to_id) if t.assigned_to_id else None,
            "parent_task_id": t.parent_task_id,
            "is_overdue": is_overdue,
            "is_critical": t.id in critical_ids,
        })

    edges = [
        {
            "predecessor_id": d.predecessor_task_id,
            "successor_id": d.successor_task_id,
            "dependency_type": d.dependency_type,
            "lag_days": d.lag_days,
        }
        for d in deps
    ]

    return {"nodes": nodes, "edges": edges}


def _compute_critical_ids(tasks: list[Task], deps: list[TaskDependency]) -> set[str]:
    """Return IDs on the longest dependency chain (by number of tasks)."""
    if not deps:
        return set()

    # Build successor map: predecessor → [successors]
    successors: dict[str, list[str]] = {}
    predecessors: dict[str, list[str]] = {}
    for d in deps:
        successors.setdefault(d.predecessor_task_id, []).append(d.successor_task_id)
        predecessors.setdefault(d.successor_task_id, []).append(d.predecessor_task_id)

    all_ids = {t.id for t in tasks}
    # Roots in dependency graph = tasks with no predecessors but that appear in deps
    dep_task_ids = {d.predecessor_task_id for d in deps} | {d.successor_task_id for d in deps}
    roots = [tid for tid in dep_task_ids if tid not in predecessors]

    # Longest path from each root
    memo: dict[str, tuple[int, list[str]]] = {}

    def longest(tid: str, visiting: frozenset[str] = frozenset()) -> tuple[int, list[str]]:
        if tid in memo:
            return memo[tid]
        if tid in visiting:
            return 0, []
        nv = visiting | {tid}
        best: tuple[int, list[str]] = (1, [tid])
        for s in successors.get(tid, []):
            length, path = longest(s, nv)
            if length + 1 > best[0]:
                best = (length + 1, [tid] + path)
        memo[tid] = best
        return best

    best_path: list[str] = []
    for root in roots:
        _, path = longest(root)
        if len(path) > len(best_path):
            best_path = path

    return set(best_path)
