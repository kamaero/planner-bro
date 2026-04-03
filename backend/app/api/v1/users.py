from datetime import datetime, timezone, date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, delete, func
from app.core.database import get_db
from app.core.security import get_current_user
from app.services.websocket_manager import ws_manager
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.models.project import Project, ProjectMember, ProjectDepartment
from app.models.task import Task
from app.models.task import TaskAssignee
from app.services.access_scope import get_user_access_scope, is_user_in_scope
from app.services.system_activity_service import log_system_activity
from app.api.v1._user_helpers import (
    normalize_email as _normalize_email,
    normalize_optional_email as _normalize_optional_email,
    short_name as _short_name,
    generate_temporary_password as _generate_temporary_password,
    default_permissions_for_role as _default_permissions_for_role,
    default_visibility_for_role as _default_visibility_for_role,
)
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
)

router = APIRouter(prefix="/users", tags=["users"])


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
    normalized_work_email = _normalize_optional_email(data.work_email)
    # email falls back to work_email when not provided
    raw_email = data.email or data.work_email
    if not raw_email:
        raise HTTPException(status_code=400, detail="Email or work_email is required")
    normalized_email = _normalize_email(str(raw_email))

    existing = await db.execute(
        select(User).where(func.lower(User.email) == normalized_email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    if normalized_work_email and normalized_work_email != normalized_email:
        existing_work_email = await db.execute(
            select(User).where(func.lower(User.work_email) == normalized_work_email)
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


# Login-events route moved to login_events.py


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


# Temp-assignee routes moved to temp_assignees.py


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
                    func.lower(User.work_email) == normalized_work_email,
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

    # build project name map for task results
    known_project_ids = {p.id for p in projects}
    extra_project_ids = {t.project_id for t in tasks} - known_project_ids
    extra_projects: list = []
    if extra_project_ids:
        extra_projects = (await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(extra_project_ids))
        )).all()
    project_name_map = {p.id: p.name for p in projects}
    for ep in extra_projects:
        project_name_map[ep.id] = ep.name

    # build assignee name map for task results
    assignee_ids = {t.assigned_to_id for t in tasks if t.assigned_to_id}
    assignee_map: dict = {}
    if assignee_ids:
        rows = (await db.execute(
            select(User.id, User.name).where(User.id.in_(assignee_ids))
        )).all()
        assignee_map = {r.id: r.name for r in rows}

    return {
        "projects": [
            {
                "id": p.id,
                "name": p.name,
                "status": p.status,
                "end_date": p.end_date.isoformat() if p.end_date else None,
            }
            for p in projects
        ],
        "tasks": [
            {
                "id": t.id,
                "title": t.title,
                "project_id": t.project_id,
                "project_name": project_name_map.get(t.project_id, ""),
                "status": t.status,
                "end_date": t.end_date.isoformat() if t.end_date else None,
                "assignee_name": assignee_map.get(t.assigned_to_id) if t.assigned_to_id else None,
            }
            for t in tasks
        ],
        "users": [{"id": u.id, "name": u.name, "email": u.email} for u in users],
    }


# ---------------------------------------------------------------------------
# External contractors (global list) — must be before /{user_id}
# ---------------------------------------------------------------------------

@router.get("/external-contractors")
async def list_external_contractors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.external_contractor import ExternalContractor
    rows = (await db.execute(
        select(ExternalContractor).order_by(ExternalContractor.name)
    )).scalars().all()
    return [{"id": r.id, "name": r.name} for r in rows]


@router.post("/external-contractors", status_code=201)
async def create_external_contractor(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.external_contractor import ExternalContractor
    name = (data.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")
    c = ExternalContractor(name=name)
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return {"id": c.id, "name": c.name}


@router.delete("/external-contractors/{contractor_id}", status_code=204)
async def delete_external_contractor(
    contractor_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.external_contractor import ExternalContractor
    c = (await db.execute(
        select(ExternalContractor).where(ExternalContractor.id == contractor_id)
    )).scalar_one_or_none()
    if c:
        await db.delete(c)
        await db.commit()


@router.get("/workload")
async def get_workload_calendar(
    start_date: date = Query(...),
    end_date: date = Query(...),
    department_id: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.services.workload_service import get_workload
    if (end_date - start_date).days > 90:
        raise HTTPException(status_code=400, detail="Date range must not exceed 90 days")
    return await get_workload(db, start_date, end_date, department_id)


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


# !! KEEP THIS LAST among GET routes — any GET "/{path}" added below will be shadowed by this !!
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


# Org/departments routes moved to org.py




