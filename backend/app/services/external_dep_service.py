from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.task_external_dep import TaskExternalDep


def _effective_status(dep: TaskExternalDep) -> str:
    """Auto-upgrade to 'overdue' if due_date passed and still waiting."""
    if dep.status == "waiting" and dep.due_date and dep.due_date < date.today():
        return "overdue"
    return dep.status


def _to_dict(dep: TaskExternalDep) -> dict:
    return {
        "id": dep.id,
        "task_id": dep.task_id,
        "contractor_name": dep.contractor_name,
        "description": dep.description,
        "due_date": dep.due_date.isoformat() if dep.due_date else None,
        "status": _effective_status(dep),
        "stored_status": dep.status,
        "created_at": dep.created_at.isoformat() if dep.created_at else None,
    }


async def list_deps(db: AsyncSession, task_id: str) -> list[dict]:
    rows = (
        await db.execute(
            select(TaskExternalDep)
            .where(TaskExternalDep.task_id == task_id)
            .order_by(TaskExternalDep.created_at)
        )
    ).scalars().all()
    return [_to_dict(r) for r in rows]


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


async def create_dep(db: AsyncSession, task_id: str, data: dict) -> dict:
    dep = TaskExternalDep(
        task_id=task_id,
        contractor_name=data["contractor_name"],
        description=data.get("description"),
        due_date=_parse_date(data.get("due_date")),
        status=data.get("status", "waiting"),
    )
    db.add(dep)
    await db.flush()
    await db.refresh(dep)
    return _to_dict(dep)


async def update_dep(db: AsyncSession, dep_id: str, data: dict) -> dict | None:
    dep = (
        await db.execute(select(TaskExternalDep).where(TaskExternalDep.id == dep_id))
    ).scalar_one_or_none()
    if not dep:
        return None
    for field in ("contractor_name", "description", "status"):
        if field in data:
            setattr(dep, field, data[field])
    if "due_date" in data:
        dep.due_date = _parse_date(data["due_date"])
    dep.updated_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(dep)
    return _to_dict(dep)


async def delete_dep(db: AsyncSession, dep_id: str) -> bool:
    dep = (
        await db.execute(select(TaskExternalDep).where(TaskExternalDep.id == dep_id))
    ).scalar_one_or_none()
    if not dep:
        return False
    await db.delete(dep)
    await db.flush()
    return True
