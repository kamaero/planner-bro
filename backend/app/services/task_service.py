from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from app.models.task import Task, TaskComment, TaskAssignee


async def get_tasks_for_project(db: AsyncSession, project_id: str) -> list[Task]:
    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
            selectinload(Task.predecessor_links),
        )
        .order_by(Task.created_at)
    )
    tasks = result.scalars().all()
    if not tasks:
        return tasks

    task_ids = [t.id for t in tasks]
    comments = (
        await db.execute(
            select(TaskComment)
            .where(TaskComment.task_id.in_(task_ids))
            .order_by(TaskComment.task_id.asc(), TaskComment.created_at.desc())
        )
    ).scalars().all()

    last_comment_by_task: dict[str, str] = {}
    for comment in comments:
        if comment.task_id not in last_comment_by_task:
            last_comment_by_task[comment.task_id] = comment.body

    for task in tasks:
        setattr(task, "last_comment", last_comment_by_task.get(task.id))
    return tasks


async def get_task_by_id(db: AsyncSession, task_id: str) -> Task | None:
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
            selectinload(Task.predecessor_links),
        )
    )
    return result.scalar_one_or_none()


async def get_task_or_404(
    db: AsyncSession,
    task_id: str,
    *,
    detail: str = "Task not found",
) -> Task:
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail=detail)
    return task


async def get_task_with_assignees(db: AsyncSession, task_id: str) -> Task | None:
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(
            selectinload(Task.assignee),
            selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
        )
    )
    return result.scalar_one_or_none()


async def get_task_with_assignees_or_404(
    db: AsyncSession,
    task_id: str,
    *,
    detail: str = "Task not found",
) -> Task:
    task = await get_task_with_assignees(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail=detail)
    return task


async def list_escalations_for_assignee(db: AsyncSession, assignee_id: str) -> list[Task]:
    result = await db.execute(
        select(Task)
        .where(
            Task.is_escalation == True,  # noqa: E712
            Task.assigned_to_id == assignee_id,
            Task.status != "done",
        )
        .options(
            selectinload(Task.assignee),
            selectinload(Task.assignee_links).selectinload(TaskAssignee.user),
        )
        .order_by(Task.created_at.desc())
    )
    return result.scalars().all()
