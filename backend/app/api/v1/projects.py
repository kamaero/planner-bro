from fastapi import APIRouter, Depends, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectOut, ProjectMemberOut,
    AddMemberRequest, UpdateMemberRoleRequest, GanttData, ProjectFileOut, MSProjectImportResult,
    DepartmentProjectsResponse, ImportFilePrecheckOut,
)
from app.schemas.ai import (
    AIIngestionJobOut,
    AITaskDraftOut,
    AITaskDraftBulkApproveRequest,
    AITaskDraftBulkRejectRequest,
    AIProcessStartRequest,
)
from app.schemas.deadline_change import DeadlineChangeOut, DeadlineStats
from app.services.project_catalog_service import create_project_with_owner_member, list_projects_for_user
from app.services.project_service import get_gantt_data
from app.services.project_dashboard_service import build_department_dashboard_payload
from app.services.project_analytics_service import compute_deadline_stats_summary
from app.services.project_import_service import import_tasks_from_ms_project_content, read_import_upload_or_400
from app.services.project_access_service import (
    get_member,
    list_project_deadline_history as list_project_deadline_history_query,
    list_project_files as list_project_files_query,
    list_project_members,
    require_project_access,
)
from app.services.project_member_service import (
    add_project_member,
    remove_project_member,
    update_project_member_role,
)
from app.services.project_file_service import (
    delete_project_file_with_audit,
    get_project_file_download_response,
    get_project_file_import_precheck_by_id,
    start_ai_processing_job_for_file,
    upload_project_file_with_ai,
)
from app.services.project_update_service import update_project_with_rules
from app.services.project_rules_service import (
    require_delete_permission,
    require_import_permission,
)
from app.services.project_ai_draft_service import (
    list_ai_drafts_for_project,
    list_ai_jobs_for_project,
)
from app.services.project_route_ai_service import (
    approve_ai_draft_flow,
    approve_ai_drafts_bulk_flow,
    reject_ai_draft_flow,
    reject_ai_drafts_bulk_flow,
)
router = APIRouter(prefix="/projects", tags=["projects"])




@router.get("/", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await list_projects_for_user(db, actor=current_user)


@router.post("/", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await create_project_with_owner_member(
        db,
        payload=data.model_dump(),
        owner_id=current_user.id,
    )


@router.get("/dashboard/departments", response_model=DepartmentProjectsResponse)
async def get_department_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return DepartmentProjectsResponse(
        **(await build_department_dashboard_payload(db, current_user=current_user))
    )


@router.get("/analytics/deadline-stats-summary", response_model=DeadlineStats)
async def get_deadline_stats_list(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alias placed before /{project_id} to avoid route shadowing."""
    return DeadlineStats(**(await compute_deadline_stats_summary(db)))


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await require_project_access(project_id, current_user, db)


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = await require_project_access(project_id, current_user, db, require_manager=False)
    requester_member = await get_member(project_id, current_user.id, db)
    return await update_project_with_rules(
        db,
        project=project,
        project_id=project_id,
        payload=data.model_dump(exclude_none=True),
        actor=current_user,
        requester_member=requester_member,
    )


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_delete_permission(current_user)
    project = await require_project_access(project_id, current_user, db, require_manager=True)
    await db.delete(project)
    await db.commit()


@router.get("/{project_id}/gantt", response_model=GanttData)
async def get_gantt(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await get_gantt_data(db, project_id)


@router.get("/{project_id}/members", response_model=list[ProjectMemberOut])
async def list_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await list_project_members(db, project_id=project_id)


@router.get("/{project_id}/files", response_model=list[ProjectFileOut])
async def list_project_files(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await list_project_files_query(db, project_id=project_id)


@router.post("/{project_id}/files", response_model=ProjectFileOut, status_code=201)
async def upload_project_file(
    project_id: str,
    upload: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await upload_project_file_with_ai(
        db,
        project_id=project_id,
        upload=upload,
        actor=current_user,
    )


@router.post("/{project_id}/tasks/import/ms-project", response_model=MSProjectImportResult)
async def import_tasks_from_ms_project(
    project_id: str,
    upload: UploadFile = File(...),
    replace_existing: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_import_permission(current_user)
    await require_project_access(project_id, current_user, db)
    filename, content = await read_import_upload_or_400(upload)

    result = await import_tasks_from_ms_project_content(
        db,
        project_id=project_id,
        filename=filename,
        content=content,
        replace_existing=replace_existing,
        actor_id=current_user.id,
    )
    return MSProjectImportResult(**result)


@router.get("/{project_id}/files/{file_id}/download")
async def download_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await get_project_file_download_response(db, project_id=project_id, file_id=file_id)


@router.get("/{project_id}/files/{file_id}/import-precheck", response_model=ImportFilePrecheckOut)
async def get_project_file_import_precheck(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return ImportFilePrecheckOut(
        **(await get_project_file_import_precheck_by_id(db, project_id=project_id, file_id=file_id))
    )


@router.delete("/{project_id}/files/{file_id}", status_code=204)
async def delete_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_delete_permission(current_user)
    await require_project_access(project_id, current_user, db, require_manager=True)
    await delete_project_file_with_audit(
        db,
        project_id=project_id,
        file_id=file_id,
        actor_id=current_user.id,
    )


@router.get("/{project_id}/ai-jobs", response_model=list[AIIngestionJobOut])
async def list_ai_jobs(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await list_ai_jobs_for_project(db, project_id=project_id)


@router.post("/{project_id}/files/{file_id}/ai-process", response_model=AIIngestionJobOut, status_code=202)
async def start_ai_processing_for_file(
    project_id: str,
    file_id: str,
    data: AIProcessStartRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_import_permission(current_user)
    await require_project_access(project_id, current_user, db)
    return await start_ai_processing_job_for_file(
        db,
        project_id=project_id,
        file_id=file_id,
        actor_id=current_user.id,
        prompt_instruction=(data.prompt_instruction if data else None),
    )


@router.get("/{project_id}/ai-drafts", response_model=list[AITaskDraftOut])
async def list_ai_drafts(
    project_id: str,
    file_id: str | None = None,
    status_filter: str | None = None,
    limit: int = Query(default=2000, ge=1, le=5000),
    offset: int = Query(default=0, ge=0, le=100000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await list_ai_drafts_for_project(
        db,
        project_id=project_id,
        file_id=file_id,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )


@router.post("/{project_id}/ai-drafts/{draft_id}/approve", response_model=AITaskDraftOut)
async def approve_ai_draft(
    project_id: str,
    draft_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await approve_ai_draft_flow(
        db,
        project_id=project_id,
        draft_id=draft_id,
        actor=current_user,
    )


@router.post("/{project_id}/ai-drafts/approve-bulk", response_model=list[AITaskDraftOut])
async def approve_ai_drafts_bulk(
    project_id: str,
    data: AITaskDraftBulkApproveRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await approve_ai_drafts_bulk_flow(
        db,
        project_id=project_id,
        draft_ids=data.draft_ids,
        actor=current_user,
    )


@router.post("/{project_id}/ai-drafts/reject-bulk", response_model=list[AITaskDraftOut])
async def reject_ai_drafts_bulk(
    project_id: str,
    data: AITaskDraftBulkRejectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await reject_ai_drafts_bulk_flow(
        db,
        project_id=project_id,
        draft_ids=data.draft_ids,
        actor_id=current_user.id,
    )


@router.post("/{project_id}/ai-drafts/reject-bulk", response_model=list[AITaskDraftOut])
async def reject_ai_drafts_bulk(
    project_id: str,
    data: AITaskDraftBulkRejectRequest,
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
    rejected: list[AITaskDraft] = []
    for draft_id in data.draft_ids:
        draft = draft_map.get(draft_id)
        if not draft or draft.status != "pending":
            continue
        draft.status = "rejected"
        draft.approved_by_id = current_user.id
        rejected.append(draft)
    for file_id in {d.project_file_id for d in rejected}:
        await _maybe_archive_processed_file(project_id, file_id, current_user.id, db)
    await db.commit()
    return rejected


@router.post("/{project_id}/ai-drafts/{draft_id}/reject", response_model=AITaskDraftOut)
async def reject_ai_draft(
    project_id: str,
    draft_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await reject_ai_draft_flow(
        db,
        project_id=project_id,
        draft_id=draft_id,
        actor_id=current_user.id,
    )


@router.post("/{project_id}/members", status_code=201)
async def add_member(
    project_id: str,
    data: AddMemberRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await add_project_member(
        db,
        project_id=project_id,
        target_user_id=data.user_id,
        role=data.role,
        actor=current_user,
    )
    return {"message": "Member added"}


@router.patch("/{project_id}/members/{user_id}", status_code=200)
async def update_member_role(
    project_id: str,
    user_id: str,
    data: UpdateMemberRoleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await update_project_member_role(
        db,
        project_id=project_id,
        target_user_id=user_id,
        role=data.role,
        actor=current_user,
    )
    return {"message": "Member role updated"}


@router.delete("/{project_id}/members/{user_id}", status_code=204)
async def remove_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await remove_project_member(
        db,
        project_id=project_id,
        target_user_id=user_id,
        actor=current_user,
    )


@router.get("/{project_id}/deadline-history", response_model=list[DeadlineChangeOut])
async def list_project_deadline_history(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    return await list_project_deadline_history_query(db, project_id=project_id)
