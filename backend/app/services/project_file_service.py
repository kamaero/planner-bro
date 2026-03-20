from __future__ import annotations

import io
import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ai import AIIngestionJob
from app.models.project import ProjectFile
from app.models.user import User
from app.services.ms_project_import_service import inspect_import_file
from app.services.project_access_service import get_project_file_or_404
from app.services.system_activity_service import log_system_activity

if TYPE_CHECKING:
    from app.schemas.project import ImportFilePrecheckOut


def _read_project_file_bytes(record: ProjectFile) -> bytes:
    from app.services.project_file_storage import read_project_file_bytes

    return read_project_file_bytes(record)


def _store_project_file_encrypted(file_id: str, content: bytes) -> tuple[str, str, int]:
    from app.services.project_file_storage import store_project_file_encrypted

    return store_project_file_encrypted(file_id, content)


def _delete_project_file_blob(record: ProjectFile) -> None:
    from app.services.project_file_storage import delete_project_file_blob

    delete_project_file_blob(record)


def _queue_ai_ingestion_job(job_id: str, prompt_instruction: str | None = None) -> None:
    from app.tasks.ai_ingestion import process_file_for_ai

    if prompt_instruction is None:
        process_file_for_ai.delay(job_id)
        return
    process_file_for_ai.delay(job_id, prompt_instruction)


def read_project_file_payload_or_http(record: ProjectFile) -> bytes:
    try:
        return _read_project_file_bytes(record)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File missing on disk")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not decrypt file: {exc}")


def build_project_file_download_response(record: ProjectFile, payload: bytes) -> StreamingResponse:
    headers = {"Content-Disposition": f'attachment; filename="{record.filename}"'}
    return StreamingResponse(
        io.BytesIO(payload),
        media_type=record.content_type or "application/octet-stream",
        headers=headers,
    )


def build_project_file_import_precheck(record: ProjectFile) -> dict:
    payload = read_project_file_payload_or_http(record)
    return inspect_import_file(payload, filename=record.filename).__dict__


async def upload_project_file_with_ai(
    db: AsyncSession,
    *,
    project_id: str,
    upload: UploadFile,
    actor: User,
) -> ProjectFile:
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_id = str(uuid.uuid4())
    storage_path, nonce, encrypted_size = _store_project_file_encrypted(file_id, content)
    size = len(content)

    db.add(
        ProjectFile(
            id=file_id,
            project_id=project_id,
            filename=upload.filename,
            content_type=upload.content_type,
            size=size,
            encrypted_size=encrypted_size,
            is_encrypted=True,
            nonce=nonce,
            storage_path=str(storage_path),
            uploaded_by_id=actor.id,
        )
    )
    await db.commit()

    file_out = (
        await db.execute(
            select(ProjectFile)
            .where(ProjectFile.id == file_id)
            .options(selectinload(ProjectFile.uploaded_by))
        )
    ).scalar_one()

    job = AIIngestionJob(
        project_id=project_id,
        project_file_id=file_id,
        created_by_id=actor.id,
        status="queued",
    )
    db.add(job)
    await db.commit()

    _queue_ai_ingestion_job(job.id)
    await log_system_activity(
        db,
        source="backend",
        category="file_upload",
        level="info",
        message=f"Uploaded file '{upload.filename}' in project {project_id}",
        details={
            "project_id": project_id,
            "file_id": file_id,
            "filename": upload.filename,
            "size": size,
            "uploaded_by_id": actor.id,
            "ai_job_id": job.id,
        },
        commit=True,
    )
    return file_out


async def delete_project_file_with_audit(
    db: AsyncSession,
    *,
    project_id: str,
    file_id: str,
    actor_id: str,
) -> None:
    record = await get_project_file_or_404(db, project_id=project_id, file_id=file_id)
    _delete_project_file_blob(record)
    await log_system_activity(
        db,
        source="backend",
        category="file_delete",
        level="warning",
        message=f"Deleted file '{record.filename}' from project {project_id}",
        details={
            "project_id": project_id,
            "file_id": file_id,
            "filename": record.filename,
            "deleted_by_id": actor_id,
        },
        commit=False,
    )
    await db.delete(record)
    await db.commit()


async def start_ai_processing_job_for_file(
    db: AsyncSession,
    *,
    project_id: str,
    file_id: str,
    actor_id: str,
    prompt_instruction: str | None,
) -> AIIngestionJob:
    await get_project_file_or_404(db, project_id=project_id, file_id=file_id)

    job = AIIngestionJob(
        project_id=project_id,
        project_file_id=file_id,
        created_by_id=actor_id,
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    normalized_instruction = (prompt_instruction or "").strip() or None
    _queue_ai_ingestion_job(job.id, normalized_instruction)
    await log_system_activity(
        db,
        source="backend",
        category="ai",
        level="info",
        message=f"AI processing started for file {file_id}",
        details={
            "project_id": project_id,
            "file_id": file_id,
            "job_id": job.id,
            "requested_by_id": actor_id,
            "prompt_instruction_set": bool(normalized_instruction),
        },
        commit=True,
    )
    return job
