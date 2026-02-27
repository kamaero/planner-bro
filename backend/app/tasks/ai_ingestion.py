import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.models.ai import AIIngestionJob, AITaskDraft
from app.models.project import Project, ProjectFile, ProjectMember
from app.models.user import User
from app.services.ms_project_import_service import parse_ms_project_content
from app.services.ai_ingestion_service import extract_text_for_ai, generate_task_drafts_from_text
from app.services.websocket_manager import ws_manager
from app.services import events as ev
from app.services.system_activity_service import log_system_activity
from app.tasks.celery_app import celery_app


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)

def _match_assignee_id(assignee_hint: str | None, members: list[User]) -> str | None:
    if not assignee_hint:
        return None
    hint = assignee_hint.strip().lower()
    if not hint:
        return None
    for user in members:
        if user.email.lower() == hint:
            return user.id
    for user in members:
        if user.name.strip().lower() == hint:
            return user.id
    return None


def _drafts_from_ms_project_file(content: bytes) -> list[dict]:
    parsed = parse_ms_project_content(content)
    drafts: list[dict] = []
    for item in parsed.tasks:
        title = item.title
        if item.outline_number and not title.startswith(f"{item.outline_number} "):
            title = f"{item.outline_number} {title}"
        drafts.append(
            {
                "title": title[:500],
                "description": item.description,
                "priority": item.priority,
                "end_date": item.end_date,
                "estimated_hours": item.estimated_hours,
                "assignee_hint": None,
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
                },
            }
        )
    return drafts


@celery_app.task(name="app.tasks.ai_ingestion.process_file_for_ai")
def process_file_for_ai(job_id: str):
    asyncio.run(_async_process_file_for_ai(job_id))


async def _async_process_file_for_ai(job_id: str):
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
        member_hints = [f"{user.name} <{user.email}>" for user in member_users]

        try:
            lower_name = (file_record.filename or "").lower()
            lower_ct = (file_record.content_type or "").lower()
            is_project_plan_source = (
                lower_name.endswith((".xml", ".mpp", ".xlsx", ".xls"))
                or "xml" in lower_ct
                or "excel" in lower_ct
            )

            drafts = None
            if is_project_plan_source:
                raw = Path(file_record.storage_path).read_bytes()
                try:
                    drafts = _drafts_from_ms_project_file(raw)
                except ValueError as exc:
                    msg = str(exc).lower()
                    # For explicit .mpp uploads keep clear error; otherwise fallback to generic AI parser.
                    if lower_name.endswith(".mpp"):
                        raise
                    if "mpp" in msg:
                        raise

            if drafts is None:
                text = extract_text_for_ai(file_record.storage_path, file_record.content_type)
                drafts = await generate_task_drafts_from_text(text, project.name, member_hints)

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
            for item in drafts:
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
                    assigned_to_id=_match_assignee_id(item.get("assignee_hint"), member_users),
                    assignee_hint=item.get("assignee_hint"),
                    progress_percent=item["progress_percent"],
                    next_step=item.get("next_step"),
                    source_quote=item.get("source_quote"),
                    confidence=item["confidence"],
                    raw_payload=item.get("raw_payload", {}),
                )
                db.add(draft)
                created_count += 1

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
