from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.system_activity_log import SystemActivityLog


def _sanitize_text(value: str, max_len: int) -> str:
    cleaned = (value or "").strip()
    return cleaned[:max_len]


async def log_system_activity(
    db: AsyncSession,
    *,
    source: str,
    category: str,
    level: str,
    message: str,
    details: dict[str, Any] | None = None,
    commit: bool = False,
) -> None:
    row = SystemActivityLog(
        source=_sanitize_text(source, 64) or "unknown",
        category=_sanitize_text(category, 64) or "general",
        level=_sanitize_text(level, 16).lower() or "info",
        message=_sanitize_text(message, 1000) or "n/a",
        details=details or None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    if commit:
        await db.commit()


async def log_system_activity_standalone(
    *,
    source: str,
    category: str,
    level: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> None:
    try:
        async with AsyncSessionLocal() as db:
            await log_system_activity(
                db,
                source=source,
                category=category,
                level=level,
                message=message,
                details=details,
                commit=True,
            )
    except Exception:
        # Never break main flow because of activity logging.
        return
