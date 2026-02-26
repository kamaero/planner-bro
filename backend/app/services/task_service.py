from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.task import Task, TaskComment, TaskAssignee


async def get_tasks_for_project(db: AsyncSession, project_id: str) -> list[Task]:
    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.assignee), selectinload(Task.assignees).selectinload(TaskAssignee.user))
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
        assignee_ids = [link.user_id for link in task.assignees] if task.assignees else (
            [task.assigned_to_id] if task.assigned_to_id else []
        )
        assignees = [link.user for link in task.assignees if link.user] if task.assignees else (
            [task.assignee] if task.assignee else []
        )
        setattr(task, "assignee_ids", assignee_ids)
        setattr(task, "assignees", assignees)
    return tasks


async def get_task_by_id(db: AsyncSession, task_id: str) -> Task | None:
    result = await db.execute(
        select(Task)
        .where(Task.id == task_id)
        .options(selectinload(Task.assignee), selectinload(Task.assignees).selectinload(TaskAssignee.user))
    )
    task = result.scalar_one_or_none()
    if not task:
        return None
    assignee_ids = [link.user_id for link in task.assignees] if task.assignees else (
        [task.assigned_to_id] if task.assigned_to_id else []
    )
    assignees = [link.user for link in task.assignees if link.user] if task.assignees else (
        [task.assignee] if task.assignee else []
    )
    setattr(task, "assignee_ids", assignee_ids)
    setattr(task, "assignees", assignees)
    return task
