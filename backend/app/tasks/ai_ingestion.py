import asyncio
import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.ai import AIIngestionJob, AITaskDraft
from app.models.project import Project, ProjectFile, ProjectMember
from app.models.user import User
from app.services.ms_project_import_service import parse_ms_project_content
from app.services.ai_ingestion_service import extract_text_for_ai_bytes, generate_task_drafts_from_text
from app.services.project_file_storage import read_project_file_bytes
from app.services.websocket_manager import ws_manager
from app.services import events as ev
from app.services.system_activity_service import log_system_activity
from app.services.temp_assignee_service import upsert_temp_assignees
from app.tasks.celery_app import celery_app


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _fio_short(value: str | None) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return ""
    match = re.search(r"([А-ЯЁA-Z][а-яёa-z-]+)\s+([А-ЯЁA-Z])\.?\s*([А-ЯЁA-Z])\.?", cleaned)
    if match:
        return f"{match.group(1).lower()} {match.group(2).lower()}.{match.group(3).lower()}."
    parts = cleaned.split(" ")
    if len(parts) >= 3:
        return f"{parts[0].lower()} {parts[1][0].lower()}.{parts[2][0].lower()}."
    return cleaned.lower()


def _fio_short_from_parts(last_name: str | None, first_name: str | None, middle_name: str | None) -> str:
    last = re.sub(r"\s+", " ", (last_name or "")).strip()
    first = re.sub(r"\s+", " ", (first_name or "")).strip()
    middle = re.sub(r"\s+", " ", (middle_name or "")).strip()
    if not last:
        return ""
    initials: list[str] = []
    if first:
        initials.append(f"{first[0].lower()}.")
    if middle:
        initials.append(f"{middle[0].lower()}.")
    return f"{last.lower()} {' '.join(initials)}".strip()


def _match_assignee_id(assignee_hint: str | None, members: list[User]) -> str | None:
    if not assignee_hint:
        return None
    hint = assignee_hint.strip().lower()
    if not hint:
        return None
    for user in members:
        if user.email.lower() == hint:
            return user.id
        work_email = (user.work_email or "").strip().lower()
        if work_email and work_email == hint:
            return user.id
    for user in members:
        if user.name.strip().lower() == hint:
            return user.id
    hint_short = _fio_short(hint)
    if hint_short:
        for user in members:
            if _fio_short(user.name) == hint_short:
                return user.id
            if _fio_short_from_parts(
                getattr(user, "last_name", ""),
                getattr(user, "first_name", ""),
                getattr(user, "middle_name", ""),
            ) == hint_short:
                return user.id
    return None


def _match_assignee_ids(assignee_hints: list[str] | None, members: list[User]) -> list[str]:
    if not assignee_hints:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for hint in assignee_hints:
        user_id = _match_assignee_id(hint, members)
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        result.append(user_id)
    return result


def _drafts_from_ms_project_file(content: bytes) -> tuple[list[dict], int]:
    parsed = parse_ms_project_content(content)
    drafts: list[dict] = []
    for item in parsed.tasks:
        title = item.title
        if item.outline_number and not title.startswith(f"{item.outline_number} "):
            title = f"{item.outline_number} {title}"
        extra_parts: list[str] = []
        if item.department:
            extra_parts.append(f"Отдел: {item.department}")
        if item.bureau:
            extra_parts.append(f"Бюро: {item.bureau}")
        if item.task_kind:
            extra_parts.append(f"Вид задачи: {item.task_kind}")
        if item.customer:
            extra_parts.append(f"Заказчик: {item.customer}")
        merged_description = item.description
        if extra_parts:
            prefix = " | ".join(extra_parts)
            merged_description = f"{prefix}\n{merged_description}" if merged_description else prefix
        drafts.append(
            {
                "title": title[:500],
                "description": merged_description,
                "priority": item.priority,
                "end_date": item.end_date,
                "estimated_hours": item.estimated_hours,
                "assignee_hint": item.assignee_hint,
                "assignee_hints": item.assignee_hints,
                "progress_percent": item.progress_percent,
                "next_step": None,
                "source_quote": f"MS Project UID={item.uid}",
                "confidence": 100,
                "raw_payload": {
                    "ms_project_uid": item.uid,
                    "outline_number": item.outline_number,
                    "parent_uid": item.parent_uid,
                    "start_date": item.start_date.isoformat() if item.start_date else None,
                    "end_date": item.end_date.isoformat() if item.end_date else None,
                    "department": item.department,
                    "bureau": item.bureau,
                    "task_kind": item.task_kind,
                    "assignee_hint": item.assignee_hint,
                    "assignee_hints": item.assignee_hints,
                    "customer": item.customer,
                },
            }
        )
    return drafts, parsed.skipped_count


@celery_app.task(name="app.tasks.ai_ingestion.process_file_for_ai")
def process_file_for_ai(job_id: str, prompt_instruction: str | None = None):
    asyncio.run(_async_process_file_for_ai(job_id, prompt_instruction))


async def _async_process_file_for_ai(job_id: str, prompt_instruction: str | None = None):
    async with AsyncSessionLocal() as db:
        job = (
            await db.execute(select(AIIngestionJob).where(AIIngestionJob.id == job_id))
        ).scalar_one_or_none()
        if not job:
            return
        job.status = "processing"
        job.started_at = _now_utc()
        job.error_message = None
        await log_system_activity(
            db,
            source="ai_worker",
            category="ai",
            level="info",
            message=f"AI ingestion job started: {job.id}",
            details={
                "job_id": job.id,
                "project_id": job.project_id,
                "project_file_id": job.project_file_id,
                "created_by_id": job.created_by_id,
            },
            commit=False,
        )
        await db.commit()

        file_record = (
            await db.execute(
                select(ProjectFile).where(
                    ProjectFile.id == job.project_file_id,
                    ProjectFile.project_id == job.project_id,
                )
            )
        ).scalar_one_or_none()
        project = (
            await db.execute(select(Project).where(Project.id == job.project_id))
        ).scalar_one_or_none()
        if not file_record or not project:
            job.status = "failed"
            job.error_message = "Project/file not found"
            job.finished_at = _now_utc()
            await log_system_activity(
                db,
                source="ai_worker",
                category="ai",
                level="error",
                message=f"AI ingestion job failed: {job.id} (project/file not found)",
                details={
                    "job_id": job.id,
                    "project_id": job.project_id,
                    "project_file_id": job.project_file_id,
                },
                commit=False,
            )
            await db.commit()
            return

        member_users = (
            await db.execute(
                select(User)
                .join(ProjectMember, ProjectMember.user_id == User.id)
                .where(ProjectMember.project_id == project.id)
            )
        ).scalars().all()
        user_candidates = (
            await db.execute(select(User).where(User.is_active == True))
        ).scalars().all()
        member_hints = [f"{user.name} <{user.email}>" for user in member_users]

        try:
            lower_name = (file_record.filename or "").lower()
            lower_ct = (file_record.content_type or "").lower()
            is_project_plan_source = (
                lower_name.endswith((".xml", ".mpp", ".xlsx"))
                or "xml" in lower_ct
                or "spreadsheetml" in lower_ct
                or "ms-excel" in lower_ct
            )

            drafts = None
            source_skipped_rows = 0
            raw = read_project_file_bytes(file_record)
            if is_project_plan_source:
                try:
                    drafts, source_skipped_rows = _drafts_from_ms_project_file(raw)
                except ValueError as exc:
                    # For explicit .mpp uploads keep clear error; otherwise fallback to generic AI parser.
                    if lower_name.endswith(".mpp"):
                        raise
                # Some XLSX files are not structured as project-plan tables.
                # If parser returned nothing, fallback to generic AI text extraction.
                if lower_name.endswith(".xlsx") and drafts is not None and len(drafts) == 0:
                    drafts = None

            if drafts is None:
                text = extract_text_for_ai_bytes(raw, file_record.filename, file_record.content_type)
                drafts = await generate_task_drafts_from_text(
                    text,
                    project.name,
                    member_hints,
                    prompt_instruction=prompt_instruction,
                )

            existing_drafts = (
                await db.execute(
                    select(AITaskDraft).where(
                        AITaskDraft.project_file_id == file_record.id,
                        AITaskDraft.status == "pending",
                    )
                )
            ).scalars().all()
            for item in existing_drafts:
                await db.delete(item)
            await db.flush()

            created_count = 0
            known_emails = {(u.email or "").strip().lower() for u in user_candidates if u.email}
            known_names = {u.name.strip().lower() for u in user_candidates if u.name}
            known_short_names = {_fio_short(u.name) for u in user_candidates if u.name}
            unresolved_for_registry: list[str] = []
            for item in drafts:
                assignee_hints = [
                    str(value).strip()
                    for value in (item.get("assignee_hints") or [])
                    if isinstance(value, str) and str(value).strip()
                ]
                if item.get("assignee_hint"):
                    primary_hint = str(item.get("assignee_hint")).strip()
                    if primary_hint:
                        assignee_hints = [primary_hint, *[h for h in assignee_hints if h.lower() != primary_hint.lower()]]
                matched_assignee_ids = _match_assignee_ids(assignee_hints, user_candidates)
                unresolved_hints = [
                    hint
                    for hint in assignee_hints
                    if hint
                    and hint.lower() not in known_emails
                    and hint.lower() not in known_names
                    and _fio_short(hint) not in known_short_names
                ]
                unresolved_for_registry.extend(unresolved_hints)
                raw_payload = dict(item.get("raw_payload", {}) or {})
                if assignee_hints:
                    raw_payload["assignee_hints"] = assignee_hints
                if matched_assignee_ids:
                    raw_payload["matched_assignee_ids"] = matched_assignee_ids
                draft = AITaskDraft(
                    project_id=project.id,
                    project_file_id=file_record.id,
                    job_id=job.id,
                    status="pending",
                    title=item["title"],
                    description=item.get("description"),
                    priority=item["priority"],
                    end_date=item.get("end_date"),
                    estimated_hours=item.get("estimated_hours"),
                    assigned_to_id=matched_assignee_ids[0] if matched_assignee_ids else None,
                    assignee_hint=assignee_hints[0] if assignee_hints else item.get("assignee_hint"),
                    progress_percent=item["progress_percent"],
                    next_step=item.get("next_step"),
                    source_quote=item.get("source_quote"),
                    confidence=item["confidence"],
                    raw_payload=raw_payload,
                )
                db.add(draft)
                created_count += 1

            if unresolved_for_registry:
                await upsert_temp_assignees(
                    db,
                    names=unresolved_for_registry,
                    source="ai_ingestion",
                    project_id=project.id,
                    created_by_id=job.created_by_id,
                )

            job.status = "completed"
            job.drafts_count = created_count
            job.finished_at = _now_utc()
            await log_system_activity(
                db,
                source="ai_worker",
                category="ai",
                level="info",
                message=f"AI ingestion completed: {job.id}",
                details={
                    "job_id": job.id,
                    "project_id": project.id,
                    "project_file_id": file_record.id,
                    "drafts_count": created_count,
                    "source_skipped_rows": source_skipped_rows,
                    "prompt_instruction_set": bool((prompt_instruction or "").strip()),
                },
                commit=False,
            )
            await db.commit()
            await ws_manager.broadcast_to_project(
                project.id,
                ev.AI_DRAFTS_READY,
                {
                    "project_id": project.id,
                    "project_file_id": file_record.id,
                    "job_id": job.id,
                    "drafts_count": created_count,
                },
            )
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)[:2000]
            job.finished_at = _now_utc()
            await log_system_activity(
                db,
                source="ai_worker",
                category="ai",
                level="error",
                message=f"AI ingestion failed: {job.id}",
                details={
                    "job_id": job.id,
                    "project_id": job.project_id,
                    "project_file_id": job.project_file_id,
                    "error": str(exc),
                },
                commit=False,
            )
            await db.commit()
            await ws_manager.broadcast_to_project(
                project.id,
                ev.AI_DRAFTS_FAILED,
                {
                    "project_id": project.id,
                    "project_file_id": file_record.id,
                    "job_id": job.id,
                    "error": job.error_message,
                },
            )
