import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectMember
from app.models.task import Task, TaskAssignee
from app.models.user import User

_LEADING_TASK_NO_RE = re.compile(r"^(\d+(?:\.\d+)*)(?:[.)])?\s+")
_NOISE_PUNCT_RE = re.compile(r"[\"'`«»“”„‟’.,;:!?()\\[\\]{}<>]+")
_SPACE_RE = re.compile(r"\s+")
_QUARTER_MARKER_RE = re.compile(
    r"\b(?:q[1-4]|[1-4]\s*(?:кв|квартал)|квартал\s*[1-4]|[1-4]\s*quarter)\b",
    flags=re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b20\d{2}\b")


def extract_task_number(value: str | None) -> str | None:
    if not value:
        return None
    match = re.match(r"^(\d+(?:\.\d+)*)(?:[.)])?\s+", value.strip())
    if not match:
        return None
    return match.group(1)


def normalize_rollover_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = value.strip().lower()
    normalized = _LEADING_TASK_NO_RE.sub("", normalized)
    normalized = _NOISE_PUNCT_RE.sub(" ", normalized)
    return _SPACE_RE.sub(" ", normalized).strip()


def normalize_rollover_title(value: str | None) -> str:
    normalized = normalize_rollover_text(value)
    normalized = _YEAR_RE.sub(" ", normalized)
    normalized = _QUARTER_MARKER_RE.sub(" ", normalized)
    return _SPACE_RE.sub(" ", normalized).strip()


def is_conservative_rollover_description_match(lhs: str | None, rhs: str | None) -> bool:
    left = normalize_rollover_text(lhs)
    right = normalize_rollover_text(rhs)
    if not left or not right:
        return False
    if left == right:
        return True
    shorter, longer = (left, right) if len(left) <= len(right) else (right, left)
    if len(shorter) < 32:
        return False
    if shorter in longer:
        overlap = len(shorter) / max(1, len(longer))
        return overlap >= 0.85
    return False


def fio_short(value: str | None) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return ""
    match = re.search(r"([\u0410-\u042f\u0401A-Z][\u0430-\u044f\u0451a-z-]+)\s+([\u0410-\u042f\u0401A-Z])\.?\s*([\u0410-\u042f\u0401A-Z])\.?", cleaned)
    if match:
        return f"{match.group(1).lower()} {match.group(2).lower()}.{match.group(3).lower()}."
    parts = cleaned.split(" ")
    if len(parts) >= 3:
        return f"{parts[0].lower()} {parts[1][0].lower()}.{parts[2][0].lower()}."
    return cleaned.lower()


def fio_short_from_parts(last_name: str | None, first_name: str | None, middle_name: str | None) -> str:
    last = re.sub(r"\s+", " ", (last_name or "")).strip()
    first = re.sub(r"\s+", " ", (first_name or "")).strip()
    middle = re.sub(r"\s+", " ", (middle_name or "")).strip()
    if not (last and first):
        return ""
    first_initial = first[0].lower()
    middle_initial = middle[0].lower() if middle else ""
    return f"{last.lower()} {first_initial}.{middle_initial + '.' if middle_initial else ''}"


def collect_assignee_hints(primary_hint: str | None, raw_payload: dict | None) -> list[str]:
    hints: list[str] = []
    if primary_hint and primary_hint.strip():
        hints.append(primary_hint.strip())
    payload_hints = (raw_payload or {}).get("assignee_hints")
    if isinstance(payload_hints, list):
        for value in payload_hints:
            if isinstance(value, str) and value.strip():
                hints.append(value.strip())
    if not hints:
        fallback = (raw_payload or {}).get("assignee_hint")
        if isinstance(fallback, str) and fallback.strip():
            hints.append(fallback.strip())
    deduped: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        key = hint.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(hint)
    return deduped


def match_assignee_ids(hints: list[str], users: list[User]) -> list[str]:
    matched: list[str] = []
    seen: set[str] = set()
    normalized_users = [
        (
            u,
            (u.email or "").strip().lower(),
            (u.work_email or "").strip().lower(),
            u.name.strip().lower(),
            fio_short(u.name),
            fio_short_from_parts(u.last_name, u.first_name, getattr(u, "middle_name", "")),
        )
        for u in users
    ]
    for raw_hint in hints:
        hint = raw_hint.strip().lower()
        if not hint:
            continue
        candidate_id: str | None = None
        for user, email, work_email, _, _, _ in normalized_users:
            if (email and email == hint) or (work_email and work_email == hint):
                candidate_id = user.id
                break
        if not candidate_id:
            for user, _, _, name, _, _ in normalized_users:
                if name == hint:
                    candidate_id = user.id
                    break
        if not candidate_id:
            hint_short = fio_short(hint)
            if hint_short:
                for user, _, _, _, user_short, user_short_from_parts in normalized_users:
                    if (user_short and user_short == hint_short) or (
                        user_short_from_parts and user_short_from_parts == hint_short
                    ):
                        candidate_id = user.id
                        break
        if candidate_id and candidate_id not in seen:
            seen.add(candidate_id)
            matched.append(candidate_id)
    return matched


async def sync_task_assignees_for_project(
    task: Task,
    project_id: str,
    assignee_ids: list[str],
    db: AsyncSession,
) -> None:
    desired = [uid.strip() for uid in assignee_ids if uid and uid.strip()]
    desired = list(dict.fromkeys(desired))

    existing_links = (
        await db.execute(select(TaskAssignee).where(TaskAssignee.task_id == task.id))
    ).scalars().all()
    existing_ids = {link.user_id for link in existing_links}
    desired_set = set(desired)

    for link in existing_links:
        if link.user_id not in desired_set:
            await db.delete(link)

    for user_id in desired:
        if user_id not in existing_ids:
            db.add(TaskAssignee(task_id=task.id, user_id=user_id))
        member_exists = (
            await db.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if not member_exists:
            db.add(ProjectMember(project_id=project_id, user_id=user_id, role="member"))

    task.assigned_to_id = desired[0] if desired else None


def normalize_checklist(items: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for item in items or []:
        item_id = str(item.get("id", "")).strip()
        label = str(item.get("label", "")).strip()
        if not item_id or not label:
            continue
        normalized.append({"id": item_id, "label": label, "done": bool(item.get("done", False))})
    return normalized


def ensure_project_completion_allowed(checklist: list[dict]) -> None:
    if not checklist:
        raise HTTPException(
            status_code=400,
            detail="\u041d\u0435\u043b\u044c\u0437\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442: \u0437\u0430\u043f\u043e\u043b\u043d\u0438\u0442\u0435 checklist definition of done.",
        )
    if any(not bool(item.get("done", False)) for item in checklist):
        raise HTTPException(
            status_code=400,
            detail="\u041d\u0435\u043b\u044c\u0437\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u043f\u0440\u043e\u0435\u043a\u0442: \u0432\u0441\u0435 \u043f\u0443\u043d\u043a\u0442\u044b definition of done \u0434\u043e\u043b\u0436\u043d\u044b \u0431\u044b\u0442\u044c \u043e\u0442\u043c\u0435\u0447\u0435\u043d\u044b.",
        )


def apply_control_ski(payload: dict, existing_priority: str | None = None, existing_control_ski: bool = False):
    control_ski = payload.get("control_ski", existing_control_ski)
    priority = payload.get("priority", existing_priority or "medium")

    if control_ski:
        payload["control_ski"] = True
        payload["priority"] = "critical"
        return

    if "control_ski" in payload:
        payload["control_ski"] = False
    if priority == "critical":
        payload["priority"] = "medium"


def require_import_permission(user: User) -> None:
    """Kept for backwards compatibility — delegates to permission_service."""
    from app.services.permission_service import can_import
    if not can_import(user):
        raise HTTPException(status_code=403, detail="Нет права на импорт")


def require_delete_permission(user: User) -> None:
    """Kept for backwards compatibility — delegates to permission_service."""
    from app.services.permission_service import can_delete
    if not can_delete(user):
        raise HTTPException(status_code=403, detail="Нет права на удаление")
