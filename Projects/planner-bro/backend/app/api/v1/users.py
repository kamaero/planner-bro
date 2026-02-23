from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.schemas.user import UserOut, UserUpdate, UserProfile, ReminderSettingsUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/me", response_model=UserProfile)
async def update_me(
    data: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/search", response_model=list[UserOut])
async def search_users(
    q: str = Query(default="", min_length=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .where(or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")))
        .limit(10)
    )
    return result.scalars().all()


@router.get("/", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(User))
    return result.scalars().all()


@router.put("/me/reminders", response_model=UserProfile)
async def update_reminder_settings(
    data: ReminderSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.reminder_days = data.reminder_days
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.get("/global/search")
async def global_search(
    q: str = Query(default="", min_length=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    like = f"%{q}%"

    if current_user.role == "admin":
        project_stmt = select(Project).where(or_(Project.name.ilike(like), Project.description.ilike(like))).limit(10)
        task_stmt = select(Task).where(or_(Task.title.ilike(like), Task.description.ilike(like))).limit(10)
    else:
        project_stmt = (
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == current_user.id)
            .where(or_(Project.name.ilike(like), Project.description.ilike(like)))
            .limit(10)
        )
        task_stmt = (
            select(Task)
            .join(ProjectMember, ProjectMember.project_id == Task.project_id)
            .where(ProjectMember.user_id == current_user.id)
            .where(or_(Task.title.ilike(like), Task.description.ilike(like)))
            .limit(10)
        )

    projects = (await db.execute(project_stmt)).scalars().all()
    tasks = (await db.execute(task_stmt)).scalars().all()
    users = (
        await db.execute(
            select(User)
            .where(or_(User.email.ilike(like), User.name.ilike(like)))
            .limit(10)
        )
    ).scalars().all()

    return {
        "projects": [{"id": p.id, "name": p.name, "status": p.status} for p in projects],
        "tasks": [{"id": t.id, "title": t.title, "project_id": t.project_id, "status": t.status} for t in tasks],
        "users": [{"id": u.id, "name": u.name, "email": u.email} for u in users],
    }


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
