from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.department import Department
from app.services.access_scope import get_user_access_scope
from app.services.permission_service import can_manage_team
from app.schemas.user import DepartmentCreate, DepartmentUpdate, DepartmentOut

router = APIRouter(prefix="/users", tags=["org"])


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
    if not can_manage_team(current_user):
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
    if not can_manage_team(current_user):
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
                raise HTTPException(status_code=400, detail="Обнаружен цикл в иерархии отделов")
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
    if not can_manage_team(current_user):
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
