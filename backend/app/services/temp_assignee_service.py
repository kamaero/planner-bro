import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.temp_assignee import TempAssignee


_EMAIL_RE = re.compile(r"^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$", re.IGNORECASE)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_temp_assignee_name(value: str) -> tuple[str, str | None]:
    cleaned = re.sub(r"\s+", " ", (value or "")).strip(" ;,")
    if not cleaned:
        return "", None
    lowered = cleaned.lower()
    if _EMAIL_RE.fullmatch(cleaned):
        return lowered, lowered
    return lowered, None


async def upsert_temp_assignees(
    db: AsyncSession,
    names: list[str],
    source: str,
    project_id: str | None = None,
    created_by_id: str | None = None,
) -> None:
    now = _now_utc()
    for raw_name in names:
        normalized_name, email = normalize_temp_assignee_name(raw_name)
        if not normalized_name:
            continue
        existing = (
            await db.execute(
                select(TempAssignee).where(
                    TempAssignee.normalized_name == normalized_name,
                    TempAssignee.email == email,
                    TempAssignee.project_id == project_id,
                    TempAssignee.status.in_(("pending", "linked")),
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.last_seen_at = now
            existing.seen_count = int(existing.seen_count or 0) + 1
            if existing.status == "linked" and existing.linked_user_id:
                continue
            existing.status = "pending"
            continue
        db.add(
            TempAssignee(
                raw_name=raw_name.strip()[:255],
                normalized_name=normalized_name[:255],
                email=email[:255] if email else None,
                source=source[:64],
                status="pending",
                linked_user_id=None,
                project_id=project_id,
                created_by_id=created_by_id,
                seen_count=1,
                first_seen_at=now,
                last_seen_at=now,
            )
        )
