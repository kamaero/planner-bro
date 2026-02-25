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
    UserCreate,
    UserOut,
    UserUpdate,
    UserProfile,
    UserPermissionsUpdate,
    ReminderSettingsUpdate,
    ResetPasswordResponse,
)

router = APIRouter(prefix="/users", tags=["users"])


def _can_manage_team(user: User) -> bool:
    return user.role == "admin" or bool(user.can_manage_team)


def _require_team_manager(user: User) -> None:
    if not _can_manage_team(user):
        raise HTTPException(status_code=403, detail="No permission to manage team accounts")


def _default_permissions_for_role(role: str) -> dict[str, bool]:
    if role == "admin":
        return {
            "can_manage_team": True,
            "can_delete": True,
            "can_import": True,
            "can_bulk_edit": True,
        }
    if role == "manager":
        return {
            "can_manage_team": False,
            "can_delete": True,
            "can_import": True,
            "can_bulk_edit": True,
        }
    return {
        "can_manage_team": False,
        "can_delete": False,
        "can_import": False,
        "can_bulk_edit": False,
    }


def _generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/", response_model=UserOut, status_code=201)
async def create_user_by_admin(
    data: UserCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_manager(current_user)
    existing = await db.execute(select(User).where(User.email == data.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    if current_user.role != "admin" and data.role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can create admin accounts")

    permissions = _default_permissions_for_role(data.role)
    if current_user.role == "admin":
        overrides = {
            "can_manage_team": data.can_manage_team,
            "can_delete": data.can_delete,
            "can_import": data.can_import,
            "can_bulk_edit": data.can_bulk_edit,
        }
        for key, value in overrides.items():
            if value is not None:
                permissions[key] = value

    user = User(
        email=data.email,
        name=data.name,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=True,
        **permissions,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


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
    _require_team_manager(current_user)
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
    _require_team_manager(current_user)
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


@router.patch("/{user_id}/permissions", response_model=UserOut)
async def update_user_permissions(
    user_id: str,
    data: UserPermissionsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_manager(current_user)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if current_user.role != "admin" and user.role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can update admin permissions")

    payload = data.model_dump(exclude_none=True)
    if not payload:
        return user

    if "role" in payload:
        new_role = payload["role"]
        if new_role not in ("admin", "manager", "developer"):
            raise HTTPException(status_code=400, detail="Invalid role")
        if current_user.role != "admin" and new_role == "admin":
            raise HTTPException(status_code=403, detail="Only admin can assign admin role")
        if current_user.id == user.id and new_role != "admin":
            raise HTTPException(status_code=400, detail="You cannot demote your own admin role")
        user.role = new_role

    if current_user.id == user.id and payload.get("can_manage_team") is False:
        raise HTTPException(status_code=400, detail="You cannot remove your own team management permission")

    for field, value in payload.items():
        if field == "role":
            continue
        if field == "can_manage_team" and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Only admin can grant team management permission")
        setattr(user, field, value)

    await db.commit()
    await db.refresh(user)
    return user


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
