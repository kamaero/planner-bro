from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.task import Task


async def get_tasks_for_project(db: AsyncSession, project_id: str) -> list[Task]:
    result = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .options(selectinload(Task.assignee))
        .order_by(Task.created_at)
    )
    return result.scalars().all()


async def get_task_by_id(db: AsyncSession, task_id: str) -> Task | None:
    result = await db.execute(
        select(Task).where(Task.id == task_id).options(selectinload(Task.assignee))
    )
    return result.scalar_one_or_none()
