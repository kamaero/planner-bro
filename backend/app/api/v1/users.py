import secrets
import string

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, delete, func
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.services.websocket_manager import ws_manager
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.models.auth_login_event import AuthLoginEvent
from app.models.department import Department
from app.models.project import Project, ProjectMember, ProjectDepartment
from app.models.task import Task
from app.models.task import TaskAssignee
from app.models.temp_assignee import TempAssignee
from app.services.access_scope import get_user_access_scope, is_user_in_scope
from app.services.system_activity_service import log_system_activity
from app.schemas.user import (
    UserCreate,
    UserOut,
    UserUpdate,
    UserNameUpdate,
    UserProfile,
    UserPermissionsUpdate,
    ReminderSettingsUpdate,
    ResetPasswordResponse,
    ChangeMyPasswordRequest,
    DepartmentCreate,
    DepartmentUpdate,
    DepartmentOut,
    AuthLoginEventOut,
    TempAssigneeOut,
    TempAssigneeLinkRequest,
    TempAssigneePromoteRequest,
)

router = APIRouter(prefix="/users", tags=["users"])


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _normalize_optional_email(email: str | None) -> str | None:
    if email is None:
        return None
    cleaned = email.strip().lower()
    return cleaned or None


def _normalize_name_part(value: str | None) -> str:
    return " ".join((value or "").strip().split())


def _short_name(last_name: str, first_name: str, middle_name: str) -> str:
    last = _normalize_name_part(last_name)
    first = _normalize_name_part(first_name)
    middle = _normalize_name_part(middle_name)
    if not last and not first and not middle:
        return ""
    initials = ""
    if first:
        initials += f"{first[0].upper()}."
    if middle:
        initials += f"{middle[0].upper()}."
    if last:
        return f"{last} {initials}".strip()
    return initials.strip()


def _can_manage_team(user: User) -> bool:
    from app.services.permission_service import can_manage_team
    return can_manage_team(user)


def _require_team_manager(user: User) -> None:
    if not _can_manage_team(user):
        raise HTTPException(status_code=403, detail="Нет права на управление командой")


def _can_manage_subordinate(actor: User, target: User) -> bool:
    return target.manager_id == actor.id and actor.role in ("manager", "admin")


async def _can_manage_user_with_scope(actor: User, target: User, db: AsyncSession) -> bool:
    if actor.role == "admin":
        return True
    if actor.id == target.id:
        return False
    if not (actor.role == "manager" or _can_manage_team(actor)):
        return False
    return await is_user_in_scope(db, actor, target.id)


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


def _default_visibility_for_role(role: str) -> str:
    if role == "admin":
        return "full_scope"
    if role == "developer":
        return "own_tasks_only"
    return "department_scope"


def _validate_visibility_scope(value: str | None, actor: User) -> str | None:
    if value is None:
        return None
    if value not in ("own_tasks_only", "department_scope", "full_scope"):
        raise HTTPException(status_code=400, detail="Invalid visibility_scope")
    if actor.role != "admin" and value == "full_scope":
        raise HTTPException(status_code=403, detail="Only admin can grant full_scope")
    return value


def _validate_own_tasks_toggle(value: bool | None, actor: User, target: User | None = None) -> bool | None:
    if value is None:
        return None
    if actor.role == "admin":
        return value
    if not (actor.role == "manager" or _can_manage_team(actor)):
        raise HTTPException(status_code=403, detail="No permission to change own-tasks visibility")
    if target and target.manager_id != actor.id:
        raise HTTPException(status_code=403, detail="You can only change this setting for direct subordinates")
    return value


def _generate_temporary_password(length: int = 14) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


@router.get("/me", response_model=UserProfile)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/me/permissions")
async def get_my_permissions(current_user: User = Depends(get_current_user)):
    """Return the full capabilities matrix for the current user.

    Frontend and mobile use this to show/hide actions and UI sections.
    """
    from app.services.permission_service import capabilities
    return capabilities(current_user)


@router.post("/me/change-password")
async def change_my_password(
    data: ChangeMyPasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not current_user.password_hash:
        raise HTTPException(status_code=400, detail="Password login is not configured for this account")
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u0431\u044b\u0442\u044c \u043d\u0435 \u043a\u043e\u0440\u043e\u0447\u0435 6 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=400, detail="\u041d\u043e\u0432\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043e\u043b\u0436\u0435\u043d \u043e\u0442\u043b\u0438\u0447\u0430\u0442\u044c\u0441\u044f \u043e\u0442 \u0442\u0435\u043a\u0443\u0449\u0435\u0433\u043e")
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u0443\u043a\u0430\u0437\u0430\u043d \u043d\u0435\u0432\u0435\u0440\u043d\u043e")

    current_user.password_hash = hash_password(data.new_password)
    await db.commit()
    return {"message": "\u041f\u0430\u0440\u043e\u043b\u044c \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d"}


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
    if current_user.role != "admin":
        scope = await get_user_access_scope(db, current_user)
        if data.department_id and data.department_id not in scope.department_ids:
            raise HTTPException(status_code=403, detail="No permission to assign this department")
        if data.manager_id and data.manager_id not in scope.user_ids:
            raise HTTPException(status_code=403, detail="No permission to assign this manager")

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

    first_name = _normalize_name_part(data.first_name)
    middle_name = _normalize_name_part(data.middle_name)
    last_name = _normalize_name_part(data.last_name)
    if not (first_name or middle_name or last_name):
        computed_name = _normalize_name_part(data.name)
        parts = [part for part in computed_name.split(" ") if part]
        if len(parts) >= 3:
            last_name = parts[0]
            first_name = parts[1]
            middle_name = " ".join(parts[2:])
        elif len(parts) == 2:
            last_name, first_name = parts
        elif len(parts) == 1:
            last_name = parts[0]
    computed_name = _short_name(last_name, first_name, middle_name)

    user = User(
        email=normalized_email,
        work_email=normalized_work_email,
        name=computed_name,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        position_title=data.position_title,
        manager_id=data.manager_id or (current_user.id if current_user.role != "admin" else None),
        department_id=data.department_id,
        password_hash=hash_password(data.password),
        role=data.role,
        visibility_scope=_validate_visibility_scope(data.visibility_scope, current_user) or _default_visibility_for_role(data.role),
        own_tasks_visibility_enabled=(
            _validate_own_tasks_toggle(data.own_tasks_visibility_enabled, current_user)
            if data.own_tasks_visibility_enabled is not None
            else True
        ),
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
    payload = data.model_dump(exclude_none=True)
    first_name = payload.pop("first_name", None)
    middle_name = payload.pop("middle_name", None)
    last_name = payload.pop("last_name", None)
    for field, value in payload.items():
        setattr(current_user, field, value)
    if first_name is not None:
        current_user.first_name = _normalize_name_part(first_name)
    if middle_name is not None:
        current_user.middle_name = _normalize_name_part(middle_name)
    if last_name is not None:
        current_user.last_name = _normalize_name_part(last_name)
    if first_name is not None or middle_name is not None or last_name is not None:
        current_user.name = _short_name(
            current_user.last_name,
            current_user.first_name,
            current_user.middle_name,
        )
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.patch("/{user_id}/name", response_model=UserOut)
async def update_user_name(
    user_id: str,
    data: UserNameUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_manager(current_user)
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    user.first_name = _normalize_name_part(data.first_name)
    user.middle_name = _normalize_name_part(data.middle_name)
    user.last_name = _normalize_name_part(data.last_name)
    user.name = _short_name(user.last_name, user.first_name, user.middle_name)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/search", response_model=list[UserOut])
async def search_users(
    q: str = Query(default="", min_length=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = await get_user_access_scope(db, current_user)
    result = await db.execute(
        select(User)
        .where(
            User.is_active == True,  # noqa: E712
            User.id.in_(scope.user_ids),
            or_(User.email.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")),
        )
        .limit(10)
    )
    return result.scalars().all()


@router.get("/login-events", response_model=list[AuthLoginEventOut])
async def list_login_events(
    limit: int = Query(default=200, ge=1, le=1000),
    user_id: str | None = Query(default=None),
    success: bool | None = Query(default=None),
    email_query: str | None = Query(default=None),
    from_dt: datetime | None = Query(default=None),
    to_dt: datetime | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _require_team_manager(current_user)
    scope = await get_user_access_scope(db, current_user)

    base_stmt = (
        select(AuthLoginEvent)
        .options(selectinload(AuthLoginEvent.user))
        .order_by(AuthLoginEvent.created_at.desc())
        .limit(limit)
    )

    filters = []
    if user_id:
        filters.append(AuthLoginEvent.user_id == user_id)
    if success is not None:
        filters.append(AuthLoginEvent.success == success)
    if email_query:
        like = f"%{email_query.strip().lower()}%"
        filters.append(AuthLoginEvent.normalized_email.ilike(like))
    if from_dt:
        filters.append(AuthLoginEvent.created_at >= from_dt)
    if to_dt:
        filters.append(AuthLoginEvent.created_at <= to_dt)

    if current_user.role != "admin":
        scoped_users = set(scope.user_ids)
        scoped_emails: set[str] = set()
        if scoped_users:
            rows = (
                await db.execute(
                    select(User.email, User.work_email).where(User.id.in_(scoped_users))
                )
            ).all()
            for row in rows:
                if row.email:
                    scoped_emails.add(row.email.strip().lower())
                if row.work_email:
                    scoped_emails.add(row.work_email.strip().lower())

        visibility_filters = []
        if scoped_users:
            visibility_filters.append(AuthLoginEvent.user_id.in_(scoped_users))
        if scoped_emails:
            visibility_filters.append(AuthLoginEvent.normalized_email.in_(scoped_emails))
        if not visibility_filters:
            return []
        filters.append(or_(*visibility_filters))

    if filters:
        base_stmt = base_stmt.where(and_(*filters))

    events = (await db.execute(base_stmt)).scalars().all()
    return [
        AuthLoginEventOut(
            id=event.id,
            user_id=event.user_id,
            user_name=event.user.name if event.user else None,
            user_email=event.user.email if event.user else None,
            email_entered=event.email_entered,
            normalized_email=event.normalized_email,
            success=event.success,
            failure_reason=event.failure_reason,
            client_ip=event.client_ip,
            user_agent=event.user_agent,
            created_at=event.created_at,
        )
        for event in events
    ]


@router.get("/", response_model=list[UserOut])
async def list_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = await get_user_access_scope(db, current_user)
    result = await db.execute(
        select(User)
        .where(
            User.is_active == True,  # noqa: E712
            User.id.in_(scope.user_ids),
        )
        .order_by(User.created_at.desc())
    )
    return result.scalars().all()


def _can_manage_temp_assignees(user: User) -> bool:
    return user.role in ("admin", "manager") or bool(user.can_manage_team)


@router.get("/temp-assignees", response_model=list[TempAssigneeOut])
async def list_temp_assignees(
    status: str | None = Query(default="pending"),
    limit: int = Query(default=200, ge=1, le=2000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    scope = await get_user_access_scope(db, current_user)
    stmt = (
        select(TempAssignee)
        .options(selectinload(TempAssignee.linked_user))
        .order_by(TempAssignee.last_seen_at.desc())
        .limit(limit)
    )
    if current_user.role != "admin":
        stmt = stmt.where(
            or_(
                TempAssignee.created_by_id == current_user.id,
                TempAssignee.created_by_id.in_(scope.user_ids),
            )
        )
    if status:
        stmt = stmt.where(TempAssignee.status == status)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/temp-assignees/{temp_assignee_id}/link", response_model=TempAssigneeOut)
async def link_temp_assignee(
    temp_assignee_id: str,
    data: TempAssigneeLinkRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(
            select(TempAssignee)
            .where(TempAssignee.id == temp_assignee_id)
            .options(selectinload(TempAssignee.linked_user))
        )
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    user = (await db.execute(select(User).where(User.id == data.user_id, User.is_active == True))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    temp.linked_user_id = user.id
    temp.status = "linked"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(temp)
    return temp


@router.patch("/temp-assignees/{temp_assignee_id}/ignore", response_model=TempAssigneeOut)
async def ignore_temp_assignee(
    temp_assignee_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(
            select(TempAssignee)
            .where(TempAssignee.id == temp_assignee_id)
            .options(selectinload(TempAssignee.linked_user))
        )
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    temp.status = "ignored"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(temp)
    return temp


@router.post("/temp-assignees/{temp_assignee_id}/promote")
async def promote_temp_assignee(
    temp_assignee_id: str,
    data: TempAssigneePromoteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _can_manage_temp_assignees(current_user):
        raise HTTPException(status_code=403, detail="No permission to manage temp assignees")
    temp = (
        await db.execute(select(TempAssignee).where(TempAssignee.id == temp_assignee_id))
    ).scalar_one_or_none()
    if not temp:
        raise HTTPException(status_code=404, detail="Temp assignee not found")
    scope = await get_user_access_scope(db, current_user)
    if current_user.role != "admin" and temp.created_by_id not in scope.user_ids | {current_user.id}:
        raise HTTPException(status_code=403, detail="No permission to manage this temp assignee")

    normalized_email = _normalize_email(str(data.email))
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

    parts = [part for part in temp.raw_name.split(" ") if part.strip()]
    last_name = parts[0].strip() if parts else temp.raw_name.strip()
    first_name = parts[1].strip() if len(parts) > 1 else ""
    middle_name = " ".join(parts[2:]).strip() if len(parts) > 2 else ""
    password = data.password or _generate_temporary_password()
    role = data.role if data.role in ("developer", "manager", "admin") else "developer"
    if current_user.role != "admin" and role == "admin":
        raise HTTPException(status_code=403, detail="Only admin can create admin accounts")

    created_user = User(
        email=normalized_email,
        work_email=_normalize_optional_email(str(data.work_email)) if data.work_email else None,
        name=_short_name(last_name, first_name, middle_name),
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        position_title=data.position_title,
        manager_id=data.manager_id or (current_user.id if current_user.role != "admin" else None),
        department_id=data.department_id,
        password_hash=hash_password(password),
        role=role,
        visibility_scope=_default_visibility_for_role(role),
        own_tasks_visibility_enabled=True,
        is_active=True,
        **_default_permissions_for_role(role),
    )
    db.add(created_user)
    await db.flush()

    temp.linked_user_id = created_user.id
    temp.status = "promoted"
    temp.last_seen_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(created_user)
    await db.refresh(temp)
    return {
        "user": UserOut.model_validate(created_user),
        "temporary_password": password if not data.password else None,
        "temp_assignee": TempAssigneeOut.model_validate(temp),
    }


@router.post("/{user_id}/reset-password", response_model=ResetPasswordResponse)
async def reset_user_password(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.id == user_id:
        raise HTTPException(
            status_code=400,
            detail="\u0421\u0431\u0440\u043e\u0441 \u0441\u043e\u0431\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0433\u043e \u043f\u0430\u0440\u043e\u043b\u044f \u0447\u0435\u0440\u0435\u0437 \u0440\u0430\u0437\u0434\u0435\u043b \u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u0437\u0430\u043f\u0440\u0435\u0449\u0435\u043d. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439\u0442\u0435 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0443\u044e \u0441\u043c\u0435\u043d\u0443 \u043f\u0430\u0440\u043e\u043b\u044f.",
        )
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    if not await _can_manage_user_with_scope(current_user, user, db):
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
    if not await _can_manage_user_with_scope(current_user, user, db):
        raise HTTPException(status_code=403, detail="No permission to deactivate this user")

    owns_projects = (
        await db.execute(select(Project.id).where(Project.owner_id == user_id).limit(1))
    ).scalar_one_or_none()
    if owns_projects:
        raise HTTPException(
            status_code=400,
            detail="\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430: \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u043f\u0435\u0440\u0435\u0434\u0430\u0439\u0442\u0435 \u0435\u0433\u043e \u043f\u0440\u043e\u0435\u043a\u0442\u044b \u0434\u0440\u0443\u0433\u043e\u043c\u0443 \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0443.",
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
    if not await _can_manage_user_with_scope(current_user, user, db):
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
        if "visibility_scope" not in payload:
            payload["visibility_scope"] = _default_visibility_for_role(new_role)

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
    if "visibility_scope" in payload:
        payload["visibility_scope"] = _validate_visibility_scope(payload.get("visibility_scope"), current_user)
    if "own_tasks_visibility_enabled" in payload:
        payload["own_tasks_visibility_enabled"] = _validate_own_tasks_toggle(
            payload.get("own_tasks_visibility_enabled"), current_user, user
        )
    old_own_tasks_visibility = user.own_tasks_visibility_enabled

    if "manager_id" in payload and payload["manager_id"]:
        new_manager_id: str = payload["manager_id"]
        visited: set[str] = set()
        current_id: str | None = new_manager_id
        while current_id:
            if current_id == user.id:
                raise HTTPException(status_code=400, detail="Обнаружен цикл в иерархии менеджеров")
            if current_id in visited:
                break
            visited.add(current_id)
            row = (
                await db.execute(select(User.manager_id).where(User.id == current_id))
            ).scalar_one_or_none()
            current_id = row

    if current_user.role != "admin":
        scope = await get_user_access_scope(db, current_user)
        if "department_id" in payload and payload["department_id"] and payload["department_id"] not in scope.department_ids:
            raise HTTPException(status_code=403, detail="No permission to assign this department")
        if "manager_id" in payload and payload["manager_id"] and payload["manager_id"] not in scope.user_ids:
            raise HTTPException(status_code=403, detail="No permission to assign this manager")

    for field, value in payload.items():
        if field == "role":
            continue
        if field == "can_manage_team" and current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Only admin can grant team management permission")
        setattr(user, field, value)

    if "own_tasks_visibility_enabled" in payload and user.own_tasks_visibility_enabled != old_own_tasks_visibility:
        await log_system_activity(
            db,
            source="backend",
            category="authz",
            level="info",
            message="own_tasks_visibility toggled",
            details={
                "actor_user_id": current_user.id,
                "target_user_id": user.id,
                "target_user_email": user.email,
                "old_value": old_own_tasks_visibility,
                "new_value": user.own_tasks_visibility_enabled,
            },
            commit=False,
        )

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
    scope = await get_user_access_scope(db, current_user)
    member_project_ids = (
        await db.execute(select(ProjectMember.project_id).where(ProjectMember.user_id.in_(scope.user_ids)))
    ).scalars().all()
    department_project_ids = []
    if scope.department_ids:
        department_project_ids = (
            await db.execute(
                select(ProjectDepartment.project_id).where(
                    ProjectDepartment.department_id.in_(scope.department_ids)
                )
            )
        ).scalars().all()
    project_ids = set(member_project_ids) | set(department_project_ids)
    own_task_project_ids = (
        await db.execute(select(Task.project_id).where(Task.assigned_to_id == current_user.id))
    ).scalars().all()
    own_multi_task_project_ids = (
        await db.execute(
            select(Task.project_id)
            .join(TaskAssignee, TaskAssignee.task_id == Task.id)
            .where(TaskAssignee.user_id == current_user.id)
        )
    ).scalars().all()
    project_ids |= set(own_task_project_ids) | set(own_multi_task_project_ids)

    project_stmt = (
        select(Project)
        .where(
            Project.id.in_(project_ids or {""}),
            or_(Project.name.ilike(like), Project.description.ilike(like)),
        )
        .limit(10)
    )
    task_stmt = select(Task).where(
        Task.project_id.in_(project_ids or {""}),
        or_(Task.title.ilike(like), Task.description.ilike(like)),
    )
    if (
        current_user.visibility_scope == "own_tasks_only"
        and current_user.role != "admin"
        and bool(getattr(current_user, "own_tasks_visibility_enabled", True))
    ):
        own_task_ids = (
            await db.execute(select(TaskAssignee.task_id).where(TaskAssignee.user_id == current_user.id))
        ).scalars().all()
        task_stmt = task_stmt.where(
            or_(
                Task.assigned_to_id == current_user.id,
                Task.id.in_(set(own_task_ids) or {""}),
            )
        )
    task_stmt = task_stmt.limit(10)

    projects = (await db.execute(project_stmt)).scalars().all()
    tasks = (await db.execute(task_stmt)).scalars().all()
    users = (
        await db.execute(
            select(User)
            .where(
                User.is_active == True,  # noqa: E712
                User.id.in_(scope.user_ids),
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


@router.get("/online/presence")
async def list_online_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return users who currently have an active WebSocket connection."""
    online_ids = list(ws_manager._user_sockets.keys())
    if not online_ids:
        return []
    stmt = select(User.id, User.name).where(User.id.in_(online_ids), User.is_active == True)  # noqa: E712
    if current_user.role != "admin":
        scope = await get_user_access_scope(db, current_user)
        stmt = stmt.where(User.id.in_(scope.user_ids))
    result = await db.execute(stmt)
    return [{"id": row.id, "name": row.name} for row in result.all()]


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
    if current_user.role != "admin":
        scope = await get_user_access_scope(db, current_user)
        if user.id not in scope.user_ids:
            raise HTTPException(status_code=403, detail="Access denied")
    return user


@router.get("/org/departments", response_model=list[DepartmentOut])
async def list_departments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        result = await db.execute(select(Department).order_by(Department.name.asc()))
        return result.scalars().all()
    scope = await get_user_access_scope(db, current_user)
    if not scope.department_ids:
        return []
    result = await db.execute(
        select(Department)
        .where(Department.id.in_(scope.department_ids))
        .order_by(Department.name.asc())
    )
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

    if payload.get("parent_id"):
        visited: set[str] = set()
        current_id: str | None = payload["parent_id"]
        while current_id:
            if current_id == department_id:
                raise HTTPException(status_code=400, detail="\u041e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d \u0446\u0438\u043a\u043b \u0432 \u0438\u0435\u0440\u0430\u0440\u0445\u0438\u0438 \u043e\u0442\u0434\u0435\u043b\u043e\u0432")
            if current_id in visited:
                break
            visited.add(current_id)
            row = (
                await db.execute(select(Department.parent_id).where(Department.id == current_id))
            ).scalar_one_or_none()
            current_id = row

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
    scope = await get_user_access_scope(db, current_user)
    users = (
        await db.execute(
            select(User)
            .where(User.is_active == True, User.id.in_(scope.user_ids))  # noqa: E712
            .order_by(User.name.asc())
        )
    ).scalars().all()
    deps_query = select(Department).order_by(Department.name.asc())
    if current_user.role != "admin":
        deps_query = deps_query.where(Department.id.in_(scope.department_ids or {""})) 
    deps = (await db.execute(deps_query)).scalars().all()
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
