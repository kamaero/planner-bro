from __future__ import annotations

from fastapi import HTTPException

VALID_TASK_PRIORITIES = {"low", "medium", "high", "critical"}


def normalize_bulk_task_ids(task_ids: list[str]) -> list[str]:
    raw_ids = [task_id.strip() for task_id in task_ids if task_id.strip()]
    normalized = list(dict.fromkeys(raw_ids))
    if not normalized:
        raise HTTPException(status_code=400, detail="task_ids must contain at least one id")
    return normalized


def parse_bulk_payload(payload: dict) -> tuple[dict, bool, list[str] | None]:
    work_payload = dict(payload)
    work_payload.pop("task_ids", None)
    delete_requested = bool(work_payload.pop("delete", False))

    if delete_requested and work_payload:
        raise HTTPException(status_code=400, detail="delete cannot be combined with update fields")
    if not delete_requested and not work_payload:
        raise HTTPException(status_code=400, detail="No changes specified")

    assignee_ids = work_payload.pop("assignee_ids", None)
    if assignee_ids is not None:
        work_payload["assigned_to_id"] = assignee_ids[0] if assignee_ids else None

    return work_payload, delete_requested, assignee_ids


def validate_bulk_priority(payload: dict) -> None:
    priority = payload.get("priority")
    if priority is None:
        return
    if priority not in VALID_TASK_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid priority. Must be one of: {VALID_TASK_PRIORITIES}",
        )


def apply_bulk_fields(task, payload: dict) -> bool:
    changed = False
    for field, value in payload.items():
        if getattr(task, field) != value:
            setattr(task, field, value)
            changed = True
    return changed
