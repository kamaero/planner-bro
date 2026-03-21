from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from app.models.task import Task

EscalationPreparer = Callable[[dict, object | None], None]
NextCheckInPlanner = Callable[[Task, datetime], datetime | None]


def split_update_payload(raw_payload: dict) -> tuple[dict, list[str] | None, list[str] | None, str | None]:
    payload = dict(raw_payload)
    assignee_ids = payload.pop("assignee_ids", None)
    predecessor_task_ids = payload.pop("predecessor_task_ids", None)
    deadline_change_reason = payload.pop("deadline_change_reason", None)
    if assignee_ids is not None:
        payload["assigned_to_id"] = assignee_ids[0] if assignee_ids else None
    return payload, assignee_ids, predecessor_task_ids, deadline_change_reason


def apply_escalation_projection_for_update(
    task: Task,
    payload: dict,
    *,
    prepare_escalation_fields: EscalationPreparer,
) -> None:
    if not any(
        key in payload
        for key in (
            "is_escalation",
            "escalation_sla_hours",
            "escalation_due_at",
        )
    ):
        return
    projected = {
        "is_escalation": payload.get("is_escalation", task.is_escalation),
        "escalation_sla_hours": payload.get("escalation_sla_hours", task.escalation_sla_hours),
        "escalation_due_at": payload.get("escalation_due_at", task.escalation_due_at),
        "escalation_first_response_at": payload.get(
            "escalation_first_response_at", task.escalation_first_response_at
        ),
        "escalation_overdue_at": payload.get("escalation_overdue_at", task.escalation_overdue_at),
    }
    prepare_escalation_fields(projected, task.created_at)
    payload.update(projected)


def should_revalidate_dependencies(predecessor_task_ids: list[str] | None, payload: dict) -> bool:
    return predecessor_task_ids is not None or "start_date" in payload or "end_date" in payload


def should_validate_predecessors(
    *,
    payload: dict,
    predecessor_task_ids: list[str] | None,
    old_status: str,
    new_status: str,
) -> bool:
    return ("status" in payload and new_status != old_status) or predecessor_task_ids is not None


def apply_update_status_side_effects(
    task: Task,
    *,
    old_status: str,
    now: datetime,
    plan_next_check_in: NextCheckInPlanner,
) -> None:
    if task.status == "done":
        task.next_check_in_due_at = None
    elif old_status == "done" and task.status != "done":
        task.next_check_in_due_at = plan_next_check_in(task, now)
