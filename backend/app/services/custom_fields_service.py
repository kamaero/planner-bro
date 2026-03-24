"""Custom field definitions (per project) and values (per task)."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.custom_fields import ProjectCustomField, TaskCustomValue

VALID_TYPES = {"text", "number", "date", "select"}


# ── Field definitions ─────────────────────────────────────────────────────────

async def list_custom_fields(db: AsyncSession, project_id: str) -> list[ProjectCustomField]:
    return (
        await db.execute(
            select(ProjectCustomField)
            .where(ProjectCustomField.project_id == project_id)
            .order_by(ProjectCustomField.sort_order, ProjectCustomField.created_at)
        )
    ).scalars().all()


async def create_custom_field(
    db: AsyncSession,
    project_id: str,
    name: str,
    field_type: str,
    options: list[str] | None,
    required: bool,
    sort_order: int,
) -> ProjectCustomField:
    if field_type not in VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"field_type must be one of {sorted(VALID_TYPES)}")
    if field_type == "select" and not options:
        raise HTTPException(status_code=422, detail="options required for select field")

    field = ProjectCustomField(
        project_id=project_id,
        name=name.strip(),
        field_type=field_type,
        options=options if field_type == "select" else None,
        required=required,
        sort_order=sort_order,
        created_at=datetime.now(timezone.utc),
    )
    db.add(field)
    await db.commit()
    await db.refresh(field)
    return field


async def update_custom_field(
    db: AsyncSession,
    field_id: str,
    project_id: str,
    data: dict[str, Any],
) -> ProjectCustomField:
    field = await _get_field_or_404(db, field_id, project_id)
    for key in ("name", "options", "required", "sort_order"):
        if key in data and data[key] is not None:
            setattr(field, key, data[key])
    await db.commit()
    await db.refresh(field)
    return field


async def delete_custom_field(db: AsyncSession, field_id: str, project_id: str) -> None:
    field = await _get_field_or_404(db, field_id, project_id)
    await db.delete(field)
    await db.commit()


async def _get_field_or_404(db: AsyncSession, field_id: str, project_id: str) -> ProjectCustomField:
    field = (
        await db.execute(
            select(ProjectCustomField).where(
                ProjectCustomField.id == field_id,
                ProjectCustomField.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Custom field not found")
    return field


# ── Task values ───────────────────────────────────────────────────────────────

async def get_task_custom_values(db: AsyncSession, task_id: str) -> dict[str, str | None]:
    """Return {field_id: value} dict for a task."""
    rows = (
        await db.execute(
            select(TaskCustomValue).where(TaskCustomValue.task_id == task_id)
        )
    ).scalars().all()
    return {r.field_id: r.value for r in rows}


async def save_task_custom_values(
    db: AsyncSession,
    task_id: str,
    values: dict[str, str | None],
) -> dict[str, str | None]:
    """Upsert all custom values for a task."""
    existing = {r.field_id: r for r in (
        await db.execute(
            select(TaskCustomValue).where(TaskCustomValue.task_id == task_id)
        )
    ).scalars().all()}

    for field_id, value in values.items():
        if field_id in existing:
            existing[field_id].value = value
        else:
            db.add(TaskCustomValue(task_id=task_id, field_id=field_id, value=value))

    await db.commit()
    return await get_task_custom_values(db, task_id)
