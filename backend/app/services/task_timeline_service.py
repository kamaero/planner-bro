from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.deadline_change import DeadlineChange
from app.models.task import TaskComment, TaskEvent


async def list_task_comments(db: AsyncSession, task_id: str) -> list[TaskComment]:
    result = await db.execute(
        select(TaskComment)
        .where(TaskComment.task_id == task_id)
        .options(selectinload(TaskComment.author))
        .order_by(TaskComment.created_at.asc())
    )
    return result.scalars().all()


async def get_task_comment_with_author(db: AsyncSession, comment_id: str) -> TaskComment:
    result = await db.execute(
        select(TaskComment).where(TaskComment.id == comment_id).options(selectinload(TaskComment.author))
    )
    return result.scalar_one()


async def list_task_events(db: AsyncSession, task_id: str) -> list[TaskEvent]:
    result = await db.execute(
        select(TaskEvent)
        .where(TaskEvent.task_id == task_id)
        .options(selectinload(TaskEvent.actor))
        .order_by(TaskEvent.created_at.desc())
        .limit(100)
    )
    return result.scalars().all()


async def list_task_deadline_history(db: AsyncSession, task_id: str) -> list[DeadlineChange]:
    result = await db.execute(
        select(DeadlineChange)
        .where(DeadlineChange.entity_type == "task", DeadlineChange.entity_id == task_id)
        .options(selectinload(DeadlineChange.changed_by))
        .order_by(DeadlineChange.created_at.desc())
    )
    return result.scalars().all()
