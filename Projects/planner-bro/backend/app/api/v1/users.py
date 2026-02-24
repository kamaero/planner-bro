import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.security import hash_password
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.schemas.user import (
    UserOut,
    UserUpdate,
    UserProfile,
    ReminderSettingsUpdate,
    ResetPasswordResponse,
)

router = APIRouter(prefix="/users", tags=["users"])


def _require_team_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can manage team accounts")


def _generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


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
        .where(
            User.is_active == True,  # noqa: E712
            or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")),
        )
        .limit(10)
    )
    return result.scalars().all()


@router.get("/", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.is_active == True).order_by(User.created_at.desc())  # noqa: E712
    )
    return result.scalars().all()


@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse)
async def reset_user_password(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_admin(current_user)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    temporary_password = _generate_temporary_password()
    user.password_hash = hash_password(temporary_password)
    await db.commit()
    return ResetPasswordResponse(temporary_password=temporary_password)


@router.delete("/{user_id}", status_code=204)
async def deactivate_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_admin(current_user)
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    owns_projects = (
        await db.execute(select(Project.id).where(Project.owner_id == user_id).limit(1))
    ).scalar_one_or_none()
    if owns_projects:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить сотрудника: сначала передайте его проекты другому владельцу.",
        )

    user.is_active = False
    user.password_hash = None
    user.google_id = None
    user.fcm_token = None

    await db.execute(
        delete(ProjectMember).where(ProjectMember.user_id == user_id)
    )
    await db.commit()


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

    project_stmt = select(Project).where(or_(Project.name.ilike(like), Project.description.ilike(like))).limit(10)
    task_stmt = select(Task).where(or_(Task.title.ilike(like), Task.description.ilike(like))).limit(10)

    projects = (await db.execute(project_stmt)).scalars().all()
    tasks = (await db.execute(task_stmt)).scalars().all()
    users = (
        await db.execute(
            select(User)
            .where(
                User.is_active == True,  # noqa: E712
                or_(User.email.ilike(like), User.name.ilike(like)),
            )
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
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    return user
