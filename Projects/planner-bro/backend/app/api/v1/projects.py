import uuid
from pathlib import Path
import shutil
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.project import Project, ProjectMember, ProjectFile, default_completion_checklist
from app.models.task import Task, TaskEvent
from app.models.ai import AIIngestionJob, AITaskDraft
from app.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectOut, ProjectMemberOut,
    AddMemberRequest, UpdateMemberRoleRequest, GanttData, ProjectFileOut, MSProjectImportResult
)
from app.schemas.ai import AIIngestionJobOut, AITaskDraftOut, AITaskDraftBulkApproveRequest
from app.services.project_service import get_projects_for_user, get_gantt_data
from app.services.notification_service import notify_project_updated, notify_new_task, notify_task_assigned
from app.services.ms_project_import_service import parse_ms_project_xml
from app.tasks.ai_ingestion import process_file_for_ai

router = APIRouter(prefix="/projects", tags=["projects"])


def _normalize_checklist(items: list[dict] | None) -> list[dict]:
    normalized: list[dict] = []
    for item in items or []:
        item_id = str(item.get("id", "")).strip()
        label = str(item.get("label", "")).strip()
        if not item_id or not label:
            continue
        normalized.append({"id": item_id, "label": label, "done": bool(item.get("done", False))})
    return normalized


def _ensure_project_completion_allowed(checklist: list[dict]) -> None:
    if not checklist:
        raise HTTPException(
            status_code=400,
            detail="Нельзя завершить проект: заполните checklist definition of done.",
        )
    if any(not bool(item.get("done", False)) for item in checklist):
        raise HTTPException(
            status_code=400,
            detail="Нельзя завершить проект: все пункты definition of done должны быть отмечены.",
        )


async def _require_project_access(
    project_id: str, user: User, db: AsyncSession, require_manager: bool = False
) -> Project:
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.owner))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    member_result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id
        )
    )
    member = member_result.scalar_one_or_none()
    if not member and user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    if require_manager and member and member.role not in ("owner", "manager") and user.role != "admin":
        raise HTTPException(status_code=403, detail="Manager access required")

    return project


async def _get_member(project_id: str, user_id: str, db: AsyncSession) -> ProjectMember | None:
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


@router.get("/", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        result = await db.execute(
            select(Project).options(selectinload(Project.owner))
        )
        return result.scalars().all()
    return await get_projects_for_user(db, current_user.id)


@router.post("/", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    incoming_checklist = _normalize_checklist(payload.get("completion_checklist"))
    payload["completion_checklist"] = incoming_checklist or default_completion_checklist()
    project = Project(**payload, owner_id=current_user.id)
    db.add(project)
    await db.flush()

    # Add owner as member
    member = ProjectMember(project_id=project.id, user_id=current_user.id, role="owner")
    db.add(member)
    await db.commit()
    await db.refresh(project)

    result = await db.execute(
        select(Project).where(Project.id == project.id).options(selectinload(Project.owner))
    )
    return result.scalar_one()


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await _require_project_access(project_id, current_user, db)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_access(project_id, current_user, db, require_manager=True)
    requester_member = await _get_member(project_id, current_user.id, db)
    payload = data.model_dump(exclude_none=True)
    owner_id = payload.pop("owner_id", None)
    checklist_payload = payload.pop("completion_checklist", None)
    if checklist_payload is not None:
        project.completion_checklist = _normalize_checklist(checklist_payload)
    target_status = payload.get("status", project.status)
    if target_status == "completed":
        _ensure_project_completion_allowed(project.completion_checklist)
    for field, value in payload.items():
        setattr(project, field, value)
    if owner_id and owner_id != project.owner_id:
        if current_user.role != "admin" and (not requester_member or requester_member.role != "owner"):
            raise HTTPException(status_code=403, detail="Only owner or admin can transfer ownership")
        owner_result = await db.execute(select(User).where(User.id == owner_id))
        new_owner = owner_result.scalar_one_or_none()
        if not new_owner:
            raise HTTPException(status_code=404, detail="Owner not found")
        project.owner_id = owner_id
        members_result = await db.execute(
            select(ProjectMember).where(ProjectMember.project_id == project_id)
        )
        members = members_result.scalars().all()
        for member in members:
            if member.role == "owner" and member.user_id != owner_id:
                member.role = "manager"
        target_member = next((m for m in members if m.user_id == owner_id), None)
        if target_member:
            target_member.role = "owner"
        else:
            db.add(ProjectMember(project_id=project_id, user_id=owner_id, role="owner"))
    await db.commit()
    result = await db.execute(
        select(Project).where(Project.id == project_id).options(selectinload(Project.owner))
    )
    project = result.scalar_one()
    await notify_project_updated(db, project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await _require_project_access(project_id, current_user, db, require_manager=True)
    await db.delete(project)
    await db.commit()


@router.get("/{project_id}/gantt", response_model=GanttData)
async def get_gantt(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    return await get_gantt_data(db, project_id)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
async def list_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(ProjectMember)
        .where(ProjectMember.project_id == project_id)
        .options(selectinload(ProjectMember.user))
    )
    return result.scalars().all()


@router.get("/{project_id}/files", response_model=list[ProjectFileOut])
async def list_project_files(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .options(selectinload(ProjectFile.uploaded_by))
    )
    return result.scalars().all()


@router.post("/{project_id}/files", response_model=ProjectFileOut, status_code=201)
async def upload_project_file(
    project_id: str,
    upload: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    files_root = Path(settings.PROJECT_FILES_DIR)
    project_dir = files_root / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    file_id = str(uuid.uuid4())
    suffix = Path(upload.filename).suffix
    stored_name = f"{file_id}{suffix}"
    storage_path = project_dir / stored_name

    with storage_path.open("wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    size = storage_path.stat().st_size
    record = ProjectFile(
        id=file_id,
        project_id=project_id,
        filename=upload.filename,
        content_type=upload.content_type,
        size=size,
        storage_path=str(storage_path),
        uploaded_by_id=current_user.id,
    )
    db.add(record)
    await db.commit()
    result = await db.execute(
        select(ProjectFile)
        .where(ProjectFile.id == file_id)
        .options(selectinload(ProjectFile.uploaded_by))
    )
    file_out = result.scalar_one()

    # Queue AI parsing job (best-effort)
    job = AIIngestionJob(
        project_id=project_id,
        project_file_id=file_id,
        created_by_id=current_user.id,
        status="queued",
    )
    db.add(job)
    await db.commit()
    process_file_for_ai.delay(job.id)
    return file_out


@router.post("/{project_id}/tasks/import/ms-project", response_model=MSProjectImportResult)
async def import_tasks_from_ms_project(
    project_id: str,
    upload: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        parsed = parse_ms_project_xml(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not parsed.tasks:
        return MSProjectImportResult(
            total_in_file=0,
            created=0,
            linked_to_parent=0,
            skipped=parsed.skipped_count,
        )

    created_by_uid: dict[str, Task] = {}
    parent_links: list[tuple[Task, str]] = []
    for item in parsed.tasks:
        status = "done" if item.progress_percent >= 100 else ("in_progress" if item.progress_percent > 0 else "todo")
        task = Task(
            project_id=project_id,
            title=item.title,
            description=item.description,
            status=status,
            priority=item.priority,
            progress_percent=item.progress_percent,
            start_date=item.start_date,
            end_date=item.end_date,
            estimated_hours=item.estimated_hours,
            created_by_id=current_user.id,
        )
        db.add(task)
        await db.flush()
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=current_user.id,
                event_type="task_imported_from_ms_project",
                payload=f"ms_project_uid={item.uid}",
            )
        )
        created_by_uid[item.uid] = task
        if item.parent_uid:
            parent_links.append((task, item.parent_uid))

    linked_to_parent = 0
    for task, parent_uid in parent_links:
        parent_task = created_by_uid.get(parent_uid)
        if not parent_task:
            continue
        task.parent_task_id = parent_task.id
        linked_to_parent += 1

    await db.commit()
    return MSProjectImportResult(
        total_in_file=len(parsed.tasks) + parsed.skipped_count,
        created=len(parsed.tasks),
        linked_to_parent=linked_to_parent,
        skipped=parsed.skipped_count,
    )


@router.get("/{project_id}/files/{file_id}/download")
async def download_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    path = Path(record.storage_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(
        path=str(path),
        media_type=record.content_type or "application/octet-stream",
        filename=record.filename,
    )


@router.delete("/{project_id}/files/{file_id}", status_code=204)
async def delete_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db, require_manager=True)
    result = await db.execute(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    path = Path(record.storage_path)
    if path.exists():
        path.unlink()
    await db.delete(record)
    await db.commit()


@router.get("/{project_id}/ai-jobs", response_model=list[AIIngestionJobOut])
async def list_ai_jobs(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(AIIngestionJob)
        .where(AIIngestionJob.project_id == project_id)
        .order_by(AIIngestionJob.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.get("/{project_id}/ai-drafts", response_model=list[AITaskDraftOut])
async def list_ai_drafts(
    project_id: str,
    file_id: str | None = None,
    status_filter: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    stmt = (
        select(AITaskDraft)
        .where(AITaskDraft.project_id == project_id)
        .options(selectinload(AITaskDraft.assignee))
        .order_by(AITaskDraft.created_at.desc())
    )
    if file_id:
        stmt = stmt.where(AITaskDraft.project_file_id == file_id)
    if status_filter:
        stmt = stmt.where(AITaskDraft.status == status_filter)
    result = await db.execute(stmt.limit(200))
    return result.scalars().all()


async def _approve_single_ai_draft(
    project_id: str,
    draft: AITaskDraft,
    actor: User,
    db: AsyncSession,
) -> Task:
    task = Task(
        project_id=project_id,
        title=draft.title,
        description=draft.description,
        status="todo",
        priority=draft.priority,
        end_date=draft.end_date,
        assigned_to_id=draft.assigned_to_id,
        estimated_hours=draft.estimated_hours,
        progress_percent=draft.progress_percent,
        next_step=draft.next_step,
        created_by_id=actor.id,
    )
    db.add(task)
    await db.flush()
    db.add(
        TaskEvent(
            task_id=task.id,
            actor_id=actor.id,
            event_type="task_created_from_ai_draft",
            payload=f"draft_id={draft.id}",
        )
    )
    draft.status = "approved"
    draft.approved_by_id = actor.id
    draft.approved_task_id = task.id
    await db.flush()
    if task.assigned_to_id:
        await notify_task_assigned(db, task, task.assigned_to_id)
    await notify_new_task(db, task)
    return task


@router.post("/{project_id}/ai-drafts/{draft_id}/approve", response_model=AITaskDraftOut)
async def approve_ai_draft(
    project_id: str,
    draft_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    draft = (
        await db.execute(
            select(AITaskDraft)
            .where(
                AITaskDraft.id == draft_id,
                AITaskDraft.project_id == project_id,
            )
            .options(selectinload(AITaskDraft.assignee))
        )
    ).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="AI draft not found")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="AI draft is already processed")

    await _approve_single_ai_draft(project_id, draft, current_user, db)
    await db.commit()
    await db.refresh(draft)
    return draft


@router.post("/{project_id}/ai-drafts/approve-bulk", response_model=list[AITaskDraftOut])
async def approve_ai_drafts_bulk(
    project_id: str,
    data: AITaskDraftBulkApproveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(AITaskDraft)
        .where(
            AITaskDraft.project_id == project_id,
            AITaskDraft.id.in_(data.draft_ids),
        )
        .options(selectinload(AITaskDraft.assignee))
    )
    drafts = result.scalars().all()
    draft_map = {d.id: d for d in drafts}
    approved: list[AITaskDraft] = []
    for draft_id in data.draft_ids:
        draft = draft_map.get(draft_id)
        if not draft or draft.status != "pending":
            continue
        await _approve_single_ai_draft(project_id, draft, current_user, db)
        approved.append(draft)
    await db.commit()
    return approved


@router.post("/{project_id}/ai-drafts/{draft_id}/reject", response_model=AITaskDraftOut)
async def reject_ai_draft(
    project_id: str,
    draft_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db)
    draft = (
        await db.execute(
            select(AITaskDraft)
            .where(
                AITaskDraft.id == draft_id,
                AITaskDraft.project_id == project_id,
            )
            .options(selectinload(AITaskDraft.assignee))
        )
    ).scalar_one_or_none()
    if not draft:
        raise HTTPException(status_code=404, detail="AI draft not found")
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="AI draft is already processed")
    draft.status = "rejected"
    draft.approved_by_id = current_user.id
    await db.commit()
    await db.refresh(draft)
    return draft


@router.post("/{project_id}/members", status_code=201)
async def add_member(
    project_id: str,
    data: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db, require_manager=True)
    requester_member = await _get_member(project_id, current_user.id, db)
    if data.role == "owner":
        raise HTTPException(status_code=400, detail="Use project owner transfer instead")
    if data.role == "manager" and current_user.role != "admin":
        if not requester_member or requester_member.role != "owner":
            raise HTTPException(status_code=403, detail="Only owner or admin can assign manager role")
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == data.user_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a member")
    member = ProjectMember(project_id=project_id, user_id=data.user_id, role=data.role)
    db.add(member)
    await db.commit()
    return {"message": "Member added"}


@router.patch("/{project_id}/members/{user_id}", status_code=200)
async def update_member_role(
    project_id: str,
    user_id: str,
    data: UpdateMemberRoleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db, require_manager=True)
    requester_member = await _get_member(project_id, current_user.id, db)
    member = await _get_member(project_id, user_id, db)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(status_code=400, detail="Owner role is managed via ownership transfer")
    if data.role not in ("member", "manager"):
        raise HTTPException(status_code=400, detail="Role must be one of: member, manager")
    if data.role == "manager" and current_user.role != "admin":
        if not requester_member or requester_member.role != "owner":
            raise HTTPException(status_code=403, detail="Only owner or admin can assign manager role")

    member.role = data.role
    await db.commit()
    return {"message": "Member role updated"}


@router.delete("/{project_id}/members/{user_id}", status_code=204)
async def remove_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project_access(project_id, current_user, db, require_manager=True)
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "owner":
        raise HTTPException(
            status_code=400,
            detail="Project owner cannot be removed. Transfer ownership first.",
        )
    await db.delete(member)
    await db.commit()
