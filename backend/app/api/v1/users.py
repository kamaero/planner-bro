import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete, func

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.security import hash_password
from app.models.user import User
from app.models.department import Department
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
    DepartmentCreate,
    DepartmentUpdate,
    DepartmentOut,
)

router = APIRouter(prefix="/users", tags=["users"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_optional_email(email: str | None) -> str | None:
    if email is None:
        return None
    cleaned = email.strip().lower()
    return cleaned or None


def _can_manage_team(user: User) -> bool:
    return user.role == "admin" or bool(user.can_manage_team)


def _require_team_manager(user: User) -> None:
    if not _can_manage_team(user):
        raise HTTPException(status_code=403, detail="No permission to manage team accounts")


def _can_manage_subordinate(actor: User, target: User) -> bool:
    if actor.role == "admin" or _can_manage_team(actor):
        return True
    return target.manager_id == actor.id and actor.role in ("manager", "admin")


def _can_create_subordinate(actor: User) -> bool:
    return actor.role in ("admin", "manager") or _can_manage_team(actor)


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
    if not _can_create_subordinate(current_user):
        raise HTTPException(status_code=403, detail="No permission to create team accounts")
    normalized_email = _normalize_email(data.email)
    normalized_work_email = _normalize_optional_email(data.work_email)

    existing = await db.execute(
        select(User).where(
            or_(
                func.lower(User.email) == normalized_email,
                func.lower(User.work_email) == normalized_email,
            )
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    if normalized_work_email:
        existing_work_email = await db.execute(
            select(User).where(
                or_(
                    func.lower(User.email) == normalized_work_email,
                    func.lower(User.work_email) == normalized_work_email,
                )
            )
        )
        if existing_work_email.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Work email already registered")
    if current_user.role != "admin" and data.role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can create admin accounts")
    if current_user.role not in ("admin",) and data.manager_id and data.manager_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only create direct subordinates")

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
        email=normalized_email,
        work_email=normalized_work_email,
        name=data.name,
        position_title=data.position_title,
        manager_id=data.manager_id or (current_user.id if current_user.role != "admin" else None),
        department_id=data.department_id,
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
    if current_user.id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Сброс собственного пароля через раздел Команда запрещен. Используйте отдельную смену пароля.",
        )
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if not _can_manage_subordinate(current_user, user):
        raise HTTPException(status_code=403, detail="No permission to reset password for this user")
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
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if not _can_manage_subordinate(current_user, user):
        raise HTTPException(status_code=403, detail="No permission to deactivate this user")

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
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if not _can_manage_subordinate(current_user, user):
        raise HTTPException(status_code=403, detail="No permission to update this user")
    if current_user.role != "admin" and user.role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can update admin permissions")

    payload = data.model_dump(exclude_unset=True)
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

    if "work_email" in payload:
        normalized_work_email = _normalize_optional_email(payload.get("work_email"))
        if normalized_work_email:
            conflict = await db.execute(
                select(User.id).where(
                    User.id != user.id,
                    or_(
                        func.lower(User.email) == normalized_work_email,
                        func.lower(User.work_email) == normalized_work_email,
                    ),
                )
            )
            if conflict.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Work email already registered")
        payload["work_email"] = normalized_work_email
    if "manager_id" in payload and payload["manager_id"] == user.id:
        raise HTTPException(status_code=400, detail="User cannot be their own manager")

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


@router.get("/org/departments", response_model=list[DepartmentOut])
async def list_departments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Department).order_by(Department.name.asc()))
    return result.scalars().all()


@router.post("/org/departments", response_model=DepartmentOut, status_code=201)
async def create_department(
    data: DepartmentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_team(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage departments")
    dep = Department(
        name=data.name.strip(),
        parent_id=data.parent_id,
        head_user_id=data.head_user_id,
    )
    db.add(dep)
    await db.commit()
    await db.refresh(dep)
    return dep


@router.patch("/org/departments/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: str,
    data: DepartmentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_team(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage departments")
    dep = (await db.execute(select(Department).where(Department.id == department_id))).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")
    payload = data.model_dump(exclude_unset=True)
    if payload.get("parent_id") == dep.id:
        raise HTTPException(status_code=400, detail="Department cannot be parent of itself")
    for field, value in payload.items():
        if field == "name" and isinstance(value, str):
            value = value.strip()
        setattr(dep, field, value)
    await db.commit()
    await db.refresh(dep)
    return dep


@router.delete("/org/departments/{department_id}", status_code=204)
async def delete_department(
    department_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_team(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage departments")
    dep = (await db.execute(select(Department).where(Department.id == department_id))).scalar_one_or_none()
    if not dep:
        raise HTTPException(status_code=404, detail="Department not found")
    has_children = (
        await db.execute(select(Department.id).where(Department.parent_id == department_id).limit(1))
    ).scalar_one_or_none()
    has_users = (
        await db.execute(select(User.id).where(User.department_id == department_id, User.is_active == True).limit(1))
    ).scalar_one_or_none()  # noqa: E712
    if has_children or has_users:
        raise HTTPException(status_code=400, detail="Department is not empty")
    await db.delete(dep)
    await db.commit()


@router.get("/org/tree")
async def get_org_tree(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    users = (
        await db.execute(select(User).where(User.is_active == True).order_by(User.name.asc()))  # noqa: E712
    ).scalars().all()
    deps = (await db.execute(select(Department).order_by(Department.name.asc()))).scalars().all()
    return {
        "departments": [
            {
                "id": d.id,
                "name": d.name,
                "parent_id": d.parent_id,
                "head_user_id": d.head_user_id,
            }
            for d in deps
        ],
        "users": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "manager_id": u.manager_id,
                "department_id": u.department_id,
                "position_title": u.position_title,
            }
            for u in users
        ],
    }
