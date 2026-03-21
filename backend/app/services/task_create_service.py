from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project


def split_create_payload(payload: dict, *, assignee_ids_was_provided: bool) -> tuple[dict, list[str], list[str] | None]:
    work_payload = dict(payload)
    predecessor_task_ids = work_payload.pop("predecessor_task_ids", [])
    assignee_ids = work_payload.pop("assignee_ids", None)
    if not assignee_ids_was_provided:
        assignee_ids = None
    if assignee_ids is not None:
        work_payload["assigned_to_id"] = assignee_ids[0] if assignee_ids else None
    return work_payload, predecessor_task_ids, assignee_ids


async def apply_default_escalation_assignee(
    db: AsyncSession,
    *,
    project_id: str,
    payload: dict,
) -> None:
    if not payload.get("is_escalation") or payload.get("assigned_to_id"):
        return
    owner_id = (await db.execute(select(Project.owner_id).where(Project.id == project_id))).scalar_one_or_none()
    if owner_id:
        payload["assigned_to_id"] = owner_id
