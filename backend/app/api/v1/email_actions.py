"""Email quick-action endpoint.

Validates a signed token and executes a lightweight task mutation, then redirects
the user to the task page. No Bearer auth required — the token carries the identity.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.task import Task
from app.services.email_actions import verify_action_token

logger = logging.getLogger(__name__)
router = APIRouter()

_FALLBACK_URL = settings.APP_WEB_URL


def _task_url(project_id: str, task_id: str) -> str:
    base = settings.APP_WEB_URL.rstrip("/")
    return f"{base}/projects/{project_id}?task={task_id}"


@router.get("/email-actions/execute", include_in_schema=False)
async def execute_email_action(token: str):
    """Execute a quick action from an email button and redirect to the task."""
    payload = verify_action_token(token)
    if not payload:
        logger.warning("email_action: invalid or expired token")
        return RedirectResponse(url=_FALLBACK_URL, status_code=302)

    task_id: str = payload["tid"]
    user_id: str = payload["sub"]
    action: str = payload["act"]

    async with AsyncSessionLocal() as db:
        task = (await db.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
        if not task:
            logger.warning("email_action: task %s not found", task_id)
            return RedirectResponse(url=_FALLBACK_URL, status_code=302)

        redirect_url = _task_url(task.project_id, task.id)

        if task.status == "done":
            return RedirectResponse(url=redirect_url, status_code=302)

        try:
            if action == "take_task":
                if not task.assigned_to_id:
                    task.assigned_to_id = user_id
                if task.status in ("planning", "tz", "todo"):
                    task.status = "in_progress"
                await db.commit()

            elif action == "checkin":
                task.last_check_in_at = datetime.now(timezone.utc)
                task.next_check_in_due_at = None  # will be recalculated by checker
                await db.commit()

            elif action == "escalate":
                from datetime import timedelta

                if not task.is_escalation:
                    now = datetime.now(timezone.utc)
                    task.is_escalation = True
                    task.escalation_due_at = now + timedelta(hours=task.escalation_sla_hours)
                    await db.commit()

        except Exception:
            logger.exception("email_action: failed to execute %s on task %s", action, task_id)

    return RedirectResponse(url=redirect_url, status_code=302)
