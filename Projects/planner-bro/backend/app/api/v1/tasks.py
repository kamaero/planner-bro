from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.task import Task
from app.models.project import ProjectMember
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate, TaskOut
from app.services.task_service import get_tasks_for_project, get_task_by_id
from app.services.notification_service import notify_task_assigned, notify_task_updated, notify_new_task

router = APIRouter(tags=["tasks"])


async def _require_project_member(project_id: str, user: User, db: AsyncSession):
    if user.role == "admin":
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Access denied")


@router.get("/projects/{project_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_member(project_id, current_user, db)
    return await get_tasks_for_project(db, project_id)


@router.post("/projects/{project_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: str,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_member(project_id, current_user, db)
    task = Task(**data.model_dump(), project_id=project_id, created_by_id=current_user.id)
    db.add(task)
    await db.flush()

    # Notify assignee
    if task.assigned_to_id:
        await notify_task_assigned(db, task, task.assigned_to_id)

    await notify_new_task(db, task)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.get("/tasks/{task_id}", response_model=TaskOut)
async def get_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_project_member(task.project_id, current_user, db)
    return task


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_project_member(task.project_id, current_user, db)

    old_assignee = task.assigned_to_id
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    await db.flush()

    # Notify new assignee
    if task.assigned_to_id and task.assigned_to_id != old_assignee:
        await notify_task_assigned(db, task, task.assigned_to_id)

    await notify_task_updated(db, task, current_user.id)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_project_member(task.project_id, current_user, db)
    await db.delete(task)
    await db.commit()


@router.patch("/tasks/{task_id}/status", response_model=TaskOut)
async def update_task_status(
    task_id: str,
    data: TaskStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_by_id(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await _require_project_member(task.project_id, current_user, db)

    valid_statuses = {"todo", "in_progress", "review", "done"}
    if data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    task.status = data.status
    await notify_task_updated(db, task, current_user.id)
    await db.commit()
    await db.refresh(task)

    result = await db.execute(
        select(Task).where(Task.id == task.id).options(selectinload(Task.assignee))
    )
    return result.scalar_one()
