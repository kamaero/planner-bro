from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.department import Department
from app.models.project import (
    Project,
    ProjectMember,
    ProjectDepartment,
    default_completion_checklist,
)
from app.models.task import Task, TaskAssignee
from app.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectOut, ProjectMemberOut,
    AddMemberRequest, UpdateMemberRoleRequest, GanttData, ProjectFileOut, MSProjectImportResult,
    DepartmentProjectsResponse, DepartmentProjectsSection, ImportFilePrecheckOut,
)
from app.schemas.ai import (
    AIIngestionJobOut,
    AITaskDraftOut,
    AITaskDraftBulkApproveRequest,
    AITaskDraftBulkRejectRequest,
    AIProcessStartRequest,
)
from app.schemas.deadline_change import DeadlineChangeOut, DeadlineStats
from app.services.project_service import get_gantt_data
from app.services.access_scope import (
    get_user_access_scope,
)
from app.services.project_import_service import import_tasks_from_ms_project_content
from app.services.project_access_service import (
    get_project_file_or_404,
    get_member,
    list_project_deadline_history as list_project_deadline_history_query,
    list_project_files as list_project_files_query,
    list_project_members,
    require_project_access,
    sync_project_departments,
    validate_department_ids,
)
from app.services.project_member_service import (
    add_project_member,
    remove_project_member,
    update_project_member_role,
)
from app.services.project_file_service import (
    build_project_file_download_response,
    build_project_file_import_precheck,
    delete_project_file_with_audit,
    read_project_file_payload_or_http,
    start_ai_processing_job_for_file,
    upload_project_file_with_ai,
)
from app.services.project_update_service import update_project_with_rules
from app.services.project_rules_service import (
    apply_control_ski,
    normalize_checklist,
    require_delete_permission,
    require_import_permission,
)
from app.services.project_ai_draft_service import (
    approve_ai_draft_and_archive,
    approve_ai_drafts_bulk_and_archive,
    get_ai_draft_or_404,
    get_user_candidates,
    list_ai_drafts_for_project,
    list_ai_jobs_for_project,
    reject_ai_draft_and_archive,
    reject_ai_drafts_bulk_and_archive,
)
router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("/", response_model=list[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role == "admin":
        result = await db.execute(
            select(Project).options(selectinload(Project.owner), selectinload(Project.departments))
        )
        return result.scalars().all()

    scope = await get_user_access_scope(db, current_user)
    project_ids_from_members = (
        await db.execute(
            select(ProjectMember.project_id).where(ProjectMember.user_id.in_(scope.user_ids))
        )
    ).scalars().all()
    project_ids_from_departments = (
        await db.execute(
            select(ProjectDepartment.project_id).where(
                ProjectDepartment.department_id.in_(scope.department_ids or {""})
            )
        )
    ).scalars().all()
    own_task_project_ids = (
        await db.execute(
            select(Task.project_id).where(Task.assigned_to_id == current_user.id)
        )
    ).scalars().all()
    own_multi_task_project_ids = (
        await db.execute(
            select(Task.project_id)
            .join(TaskAssignee, TaskAssignee.task_id == Task.id)
            .where(TaskAssignee.user_id == current_user.id)
        )
    ).scalars().all()
    accessible_ids = (
        set(project_ids_from_members)
        | set(project_ids_from_departments)
        | set(own_task_project_ids)
        | set(own_multi_task_project_ids)
    )
    if not accessible_ids:
        return []
    result = await db.execute(
        select(Project)
        .where(Project.id.in_(accessible_ids))
        .options(selectinload(Project.owner), selectinload(Project.departments))
    )
    return result.scalars().all()


@router.post("/", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    payload = data.model_dump()
    department_ids = await validate_department_ids(db, payload.pop("department_ids", []))
    incoming_checklist = normalize_checklist(payload.get("completion_checklist"))
    payload["completion_checklist"] = incoming_checklist or default_completion_checklist()
    apply_control_ski(payload)

    if payload.get("launch_basis_file_id"):
        raise HTTPException(status_code=400, detail="launch_basis_file_id can be set only after upload")
    project = Project(**payload, owner_id=current_user.id)
    db.add(project)
    await db.flush()
    await sync_project_departments(db, project.id, department_ids)

    # Add owner as member
    member = ProjectMember(project_id=project.id, user_id=current_user.id, role="owner")
    db.add(member)
    await db.commit()
    await db.refresh(project)

    result = await db.execute(
        select(Project)
        .where(Project.id == project.id)
        .options(selectinload(Project.owner), selectinload(Project.departments))
    )
    return result.scalar_one()


@router.get("/dashboard/departments", response_model=DepartmentProjectsResponse)
async def get_department_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = None if current_user.role == "admin" else await get_user_access_scope(db, current_user)
    departments = (await db.execute(select(Department).order_by(Department.name.asc()))).scalars().all()
    users = (await db.execute(select(User.id, User.manager_id, User.department_id))).all()
    projects = (
        await db.execute(select(Project).options(selectinload(Project.owner), selectinload(Project.departments)))
    ).scalars().all()
    members_query = select(ProjectMember.project_id, ProjectMember.user_id, ProjectMember.role).where(
        ProjectMember.role != "owner"
    )
    if scope:
        members_query = members_query.where(ProjectMember.user_id.in_(scope.user_ids))
    members = (await db.execute(members_query)).all()

    manual_links_query = select(ProjectDepartment.project_id, ProjectDepartment.department_id)
    if scope:
        manual_links_query = manual_links_query.where(
            ProjectDepartment.department_id.in_(scope.department_ids or {""})
        )
    manual_links = (await db.execute(manual_links_query)).all()

    children_map: dict[str, list[str]] = {}
    user_department_map: dict[str, str | None] = {}
    for user_id, manager_id, department_id in users:
        user_department_map[user_id] = department_id
        if manager_id:
            children_map.setdefault(manager_id, []).append(user_id)

    department_children_map: dict[str, list[str]] = {}
    for dep in departments:
        if dep.parent_id:
            department_children_map.setdefault(dep.parent_id, []).append(dep.id)

    def _collect_department_tree(department_id: str) -> set[str]:
        collected: set[str] = set()
        stack = [department_id]
        while stack:
            current = stack.pop()
            if current in collected:
                continue
            collected.add(current)
            stack.extend(department_children_map.get(current, []))
        return collected

    def _collect_subordinates(head_user_id: str | None) -> set[str]:
        if not head_user_id:
            return set()
        collected: set[str] = set()
        stack = [head_user_id]
        while stack:
            cur = stack.pop()
            if cur in collected:
                continue
            collected.add(cur)
            stack.extend(children_map.get(cur, []))
        return collected

    dept_user_ids: dict[str, set[str]] = {}
    for dep in departments:
        dept_tree = _collect_department_tree(dep.id)
        users_in_tree = {
            user_id
            for user_id, user_dep_id in user_department_map.items()
            if user_dep_id in dept_tree
        }
        # Keep manager hierarchy support, but do not leak users outside department tree.
        subordinates_in_tree = {
            user_id
            for user_id in _collect_subordinates(dep.head_user_id)
            if user_department_map.get(user_id) in dept_tree
        }
        dept_user_ids[dep.id] = users_in_tree | subordinates_in_tree

    project_ids_by_dept: dict[str, set[str]] = {dep.id: set() for dep in departments}
    for project_id, user_id, _role in members:
        for dep in departments:
            if user_id in dept_user_ids.get(dep.id, set()):
                project_ids_by_dept[dep.id].add(project_id)
    for project_id, dep_id in manual_links:
        if dep_id in project_ids_by_dept:
            project_ids_by_dept[dep_id].add(project_id)

    project_map = {project.id: project for project in projects}
    sections: list[DepartmentProjectsSection] = []
    for dep in departments:
        if scope and dep.id not in scope.department_ids:
            continue
        dep_projects = [
            project_map[pid]
            for pid in sorted(project_ids_by_dept.get(dep.id, set()))
            if pid in project_map
        ]
        dep_projects.sort(
            key=lambda p: (
                1 if p.status == "completed" else 0,
                p.end_date.isoformat() if p.end_date else "9999-12-31",
                p.name.lower(),
            )
        )
        sections.append(
            DepartmentProjectsSection(
                department_id=dep.id,
                department_name=dep.name,
                projects=dep_projects,
            )
        )
    return DepartmentProjectsResponse(departments=sections)


@router.get("/analytics/deadline-stats-summary", response_model=DeadlineStats)
async def get_deadline_stats_list(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alias placed before /{project_id} to avoid route shadowing."""
    from datetime import date as date_type

    all_changes = (
        await db.execute(
            select(DeadlineChange).options(selectinload(DeadlineChange.changed_by))
        )
    ).scalars().all()

    total_shifts = len(all_changes)
    task_ids_with_shifts = {c.entity_id for c in all_changes if c.entity_type == "task"}
    project_ids_with_shifts = {c.entity_id for c in all_changes if c.entity_type == "project"}
    shift_days = [abs((c.new_date - c.old_date).days) for c in all_changes]
    avg_shift_days = round(sum(shift_days) / len(shift_days), 1) if shift_days else 0.0

    today = date_type.today()
    real_overdue_tasks = []
    if task_ids_with_shifts:
        tasks_result = await db.execute(
            select(Task).where(Task.id.in_(task_ids_with_shifts), Task.status != "done")
        )
        tasks_with_history = tasks_result.scalars().all()
        for task in tasks_with_history:
            task_changes = sorted(
                [c for c in all_changes if c.entity_type == "task" and c.entity_id == task.id],
                key=lambda c: c.created_at,
            )
            original_end = task_changes[0].old_date if task_changes else task.end_date
            if original_end and original_end < today:
                real_overdue_tasks.append({
                    "id": task.id,
                    "title": task.title,
                    "project_id": task.project_id,
                    "original_end_date": original_end.isoformat(),
                    "current_end_date": task.end_date.isoformat() if task.end_date else None,
                    "shifts": len(task_changes),
                })

    shifts_by_project_map: dict[str, int] = {}
    for c in all_changes:
        if c.entity_type == "task":
            task_res = (await db.execute(select(Task.project_id).where(Task.id == c.entity_id))).scalar_one_or_none()
            if task_res:
                shifts_by_project_map[task_res] = shifts_by_project_map.get(task_res, 0) + 1
        else:
            shifts_by_project_map[c.entity_id] = shifts_by_project_map.get(c.entity_id, 0) + 1

    project_names: dict[str, str] = {}
    if shifts_by_project_map:
        proj_result = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(list(shifts_by_project_map.keys())))
        )
        for pid, pname in proj_result.all():
            project_names[pid] = pname

    shifts_by_project = [
        {"project_id": pid, "project_name": project_names.get(pid, pid), "shifts": cnt}
        for pid, cnt in sorted(shifts_by_project_map.items(), key=lambda x: -x[1])
    ]

    return DeadlineStats(
        total_shifts=total_shifts,
        tasks_with_shifts=len(task_ids_with_shifts),
        projects_with_shifts=len(project_ids_with_shifts),
        avg_shift_days=avg_shift_days,
        real_overdue_tasks=real_overdue_tasks,
        shifts_by_project=shifts_by_project,
    )


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
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    result = await import_tasks_from_ms_project_content(
        db,
        project_id=project_id,
        filename=upload.filename,
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
    record = await get_project_file_or_404(db, project_id=project_id, file_id=file_id)
    payload = read_project_file_payload_or_http(record)
    return build_project_file_download_response(record, payload)


@router.get("/{project_id}/files/{file_id}/import-precheck", response_model=ImportFilePrecheckOut)
async def get_project_file_import_precheck(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    record = await get_project_file_or_404(db, project_id=project_id, file_id=file_id)
    return ImportFilePrecheckOut(**build_project_file_import_precheck(record))


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
    user_candidates = await get_user_candidates(db)
    draft = await get_ai_draft_or_404(db, project_id=project_id, draft_id=draft_id)
    await approve_ai_draft_and_archive(
        db,
        project_id=project_id,
        draft=draft,
        actor=current_user,
        user_candidates=user_candidates,
    )
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
    await require_project_access(project_id, current_user, db)
    user_candidates = await get_user_candidates(db)
    approved = await approve_ai_drafts_bulk_and_archive(
        db,
        project_id=project_id,
        draft_ids=data.draft_ids,
        actor=current_user,
        user_candidates=user_candidates,
    )
    await db.commit()
    return approved


@router.post("/{project_id}/ai-drafts/reject-bulk", response_model=list[AITaskDraftOut])
async def reject_ai_drafts_bulk(
    project_id: str,
    data: AITaskDraftBulkRejectRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    rejected = await reject_ai_drafts_bulk_and_archive(
        db,
        project_id=project_id,
        draft_ids=data.draft_ids,
        actor_id=current_user.id,
    )
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
    draft = await get_ai_draft_or_404(db, project_id=project_id, draft_id=draft_id)
    await reject_ai_draft_and_archive(
        db,
        project_id=project_id,
        draft=draft,
        actor_id=current_user.id,
    )
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
