"""Signed short-lived tokens for email quick-action buttons.

Each token encodes: action, task_id, user_id, expiry.
The /email-actions/execute endpoint validates the token and performs the action
without requiring a Bearer auth header (so email clients can open the link directly).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings

_ALGORITHM = "HS256"
_PURPOSE = "email_action_v1"

ALLOWED_ACTIONS = frozenset({"take_task", "checkin", "escalate"})


def create_action_token(
    action: str,
    task_id: str,
    user_id: str,
    ttl_days: int = 7,
) -> str:
    if action not in ALLOWED_ACTIONS:
        raise ValueError(f"Unknown email action: {action!r}")
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "tid": task_id,
        "act": action,
        "pur": _PURPOSE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=ttl_days)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=_ALGORITHM)


def verify_action_token(token: str) -> dict | None:
    """Return decoded payload dict or None if invalid/expired."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[_ALGORITHM])
    except Exception:
        return None
    if payload.get("pur") != _PURPOSE:
        return None
    if payload.get("act") not in ALLOWED_ACTIONS:
        return None
    if not payload.get("tid") or not payload.get("sub"):
        return None
    return payload


def action_url(action: str, task_id: str, user_id: str) -> str:
    """Build a full URL for an email action button.

    In production nginx proxies /api/ → FastAPI, so we use APP_WEB_URL as the base.
    In local dev (port 3000 SPA / 8000 API) we substitute the port.
    """
    token = create_action_token(action, task_id, user_id)
    base = settings.APP_WEB_URL.rstrip("/")
    # Local dev: SPA on :3000, FastAPI on :8000
    if ":3000" in base:
        base = base.replace(":3000", ":8000")
    return f"{base}/api/v1/email-actions/execute?token={token}"
