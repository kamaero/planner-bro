import uuid
import io
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from fastapi.responses import StreamingResponse
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
from app.models.task import Task, TaskAssignee, TaskEvent, TaskComment
from app.models.ai import AIIngestionJob, AITaskDraft
from app.models.deadline_change import DeadlineChange
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
    can_access_project,
    get_user_access_scope,
    get_task_assignment_scope_user_ids,
    has_department_level_access,
)
from app.services.notification_service import (
    notify_project_updated,
    notify_new_task,
    notify_task_assigned,
    notify_project_assigned,
)
from app.services.system_activity_service import log_system_activity
from app.services.ms_project_import_service import parse_ms_project_content, inspect_import_file
from app.services.project_access_service import (
    get_member,
    maybe_archive_processed_file,
    require_assignment_scope_user,
    require_project_access,
    sync_project_departments,
    validate_department_ids,
)
from app.services.project_rules_service import (
    apply_control_ski,
    collect_assignee_hints,
    ensure_project_completion_allowed,
    extract_task_number,
    fio_short,
    fio_short_from_parts,
    match_assignee_ids,
    normalize_checklist,
    require_delete_permission,
    require_import_permission,
    sync_task_assignees_for_project,
)
from app.services.temp_assignee_service import upsert_temp_assignees
from app.services.project_file_storage import (
    read_project_file_bytes,
    delete_project_file_blob,
)
from app.services.project_ai_draft_service import approve_single_ai_draft
from app.tasks.ai_ingestion import process_file_for_ai

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
    payload = data.model_dump(exclude_none=True)
    owner_id = payload.pop("owner_id", None)
    incoming_department_ids = payload.pop("department_ids", None)
    checklist_payload = payload.pop("completion_checklist", None)
    deadline_change_reason = payload.pop("deadline_change_reason", None)

    # Department-level actors can rename projects even without explicit project-manager membership.
    # Any other project edits still require owner/manager membership (or admin).
    title_only_update = (
        set(payload.keys()) <= {"name"}
        and owner_id is None
        and incoming_department_ids is None
        and checklist_payload is None
        and deadline_change_reason is None
    )
    has_manager_membership = requester_member and requester_member.role in ("owner", "manager")
    if current_user.role != "admin" and not has_manager_membership:
        can_rename_with_scope = (
            title_only_update
            and await has_department_level_access(db, current_user)
            and await can_access_project(db, current_user, project_id)
        )
        if not can_rename_with_scope:
            raise HTTPException(status_code=403, detail="Manager access required")

    if checklist_payload is not None:
        project.completion_checklist = normalize_checklist(checklist_payload)
    target_status = payload.get("status", project.status)
    if target_status == "completed":
        ensure_project_completion_allowed(project.completion_checklist)

    # Validate deadline change requires a reason
    new_end_date = payload.get("end_date")
    old_end_date = project.end_date
    if new_end_date is not None and new_end_date != old_end_date:
        if not deadline_change_reason:
            raise HTTPException(status_code=422, detail="Укажите причину изменения дедлайна")

    launch_basis_file_id = payload.get("launch_basis_file_id")
    if launch_basis_file_id:
        file_result = await db.execute(
            select(ProjectFile.id).where(
                ProjectFile.id == launch_basis_file_id,
                ProjectFile.project_id == project_id,
            )
        )
        if not file_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Launch basis file not found")

    apply_control_ski(payload, existing_priority=project.priority, existing_control_ski=project.control_ski)
    for field, value in payload.items():
        setattr(project, field, value)
    if incoming_department_ids is not None:
        normalized_department_ids = await validate_department_ids(db, incoming_department_ids)
        await sync_project_departments(db, project_id, normalized_department_ids)

    # Record deadline change if end_date actually changed
    if new_end_date is not None and new_end_date != old_end_date and deadline_change_reason:
        db.add(DeadlineChange(
            entity_type="project",
            entity_id=project_id,
            changed_by_id=current_user.id,
            old_date=old_end_date,
            new_date=new_end_date,
            reason=deadline_change_reason,
        ))

    if owner_id and owner_id != project.owner_id:
        if current_user.role != "admin" and (not requester_member or requester_member.role != "owner"):
            raise HTTPException(status_code=403, detail="Only owner or admin can transfer ownership")
        await require_assignment_scope_user(db, current_user, owner_id)
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
        await notify_project_assigned(
            db,
            project_id=project_id,
            project_name=project.name,
            user_id=owner_id,
            assigned_role="owner",
        )
    await db.commit()
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.owner), selectinload(Project.departments))
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
    await require_project_access(project_id, current_user, db)
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
    await require_project_access(project_id, current_user, db)
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    file_id = str(uuid.uuid4())
    storage_path, nonce, encrypted_size = store_project_file_encrypted(file_id, content)
    size = len(content)
    record = ProjectFile(
        id=file_id,
        project_id=project_id,
        filename=upload.filename,
        content_type=upload.content_type,
        size=size,
        encrypted_size=encrypted_size,
        is_encrypted=True,
        nonce=nonce,
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
            "uploaded_by_id": current_user.id,
            "ai_job_id": job.id,
        },
        commit=True,
    )
    return file_out


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

    try:
        parsed = parse_ms_project_content(content, filename=upload.filename)
    except ValueError as exc:
        await log_system_activity(
            db,
            source="backend",
            category="file_processing",
            level="error",
            message=f"MS Project import failed for '{upload.filename}'",
            details={
                "project_id": project_id,
                "filename": upload.filename,
                "uploaded_by_id": current_user.id,
                "error": str(exc),
            },
            commit=True,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not parsed.tasks:
        return MSProjectImportResult(
            total_in_file=0,
            created=0,
            linked_to_parent=0,
            skipped=parsed.skipped_count,
            deleted_existing=0,
        )

    deleted_existing = 0
    if replace_existing:
        imported_task_ids_subquery = (
            select(TaskEvent.task_id)
            .join(Task, Task.id == TaskEvent.task_id)
            .where(
                Task.project_id == project_id,
                TaskEvent.event_type == "task_imported_from_ms_project",
            )
            .distinct()
        )
        delete_result = await db.execute(
            delete(Task).where(
                Task.project_id == project_id,
                Task.id.in_(imported_task_ids_subquery),
            )
        )
        deleted_existing = delete_result.rowcount or 0

    created_by_uid: dict[str, Task] = {}
    parent_links: list[tuple[Task, str]] = []
    user_candidates = (
        await db.execute(select(User).where(User.is_active == True))
    ).scalars().all()
    known_emails = {
        value
        for u in user_candidates
        for value in ((u.email or "").strip().lower(), (u.work_email or "").strip().lower())
        if value
    }
    known_names = {u.name.strip().lower() for u in user_candidates if u.name}
    known_short_names = {
        short
        for u in user_candidates
        for short in (
            fio_short(u.name),
            fio_short_from_parts(u.last_name, u.first_name, getattr(u, "middle_name", "")),
        )
        if short
    }
    for item in parsed.tasks:
        status = "done" if item.progress_percent >= 100 else ("in_progress" if item.progress_percent > 0 else "todo")
        title = item.title
        if item.outline_number and not title.startswith(f"{item.outline_number} "):
            title = f"{item.outline_number} {title}"
        assignee_hints = item.assignee_hints or ([item.assignee_hint] if item.assignee_hint else [])
        matched_assignee_ids = match_assignee_ids(assignee_hints, user_candidates)
        task = Task(
            project_id=project_id,
            title=title,
            description=None,
            status=status,
            priority=item.priority,
            progress_percent=item.progress_percent,
            start_date=item.start_date,
            end_date=item.end_date,
            assigned_to_id=matched_assignee_ids[0] if matched_assignee_ids else None,
            estimated_hours=item.estimated_hours,
            created_by_id=current_user.id,
        )
        db.add(task)
        await db.flush()
        await sync_task_assignees_for_project(task, project_id, matched_assignee_ids, db)
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=current_user.id,
                event_type="task_imported_from_ms_project",
                payload=f"ms_project_uid={item.uid};outline={item.outline_number or ''}",
            )
        )
        if item.description:
            db.add(
                TaskComment(
                    task_id=task.id,
                    author_id=current_user.id,
                    body=f"Импортированный комментарий из MS Project:\n{item.description}",
                )
            )
            db.add(
                TaskEvent(
                    task_id=task.id,
                    actor_id=current_user.id,
                    event_type="comment_added",
                    payload="source=ms_project_notes",
                )
            )
        unresolved_hints = [
            hint
            for hint in assignee_hints
            if hint
            and hint.lower() not in known_emails
            and hint.lower() not in known_names
            and fio_short(hint) not in known_short_names
        ]
        if unresolved_hints:
            await upsert_temp_assignees(
                db,
                names=unresolved_hints,
                source="ms_project_import",
                project_id=project_id,
                created_by_id=current_user.id,
            )
            db.add(
                TaskComment(
                    task_id=task.id,
                    author_id=current_user.id,
                    body=f"Исполнители из файла не найдены в системе: {', '.join(unresolved_hints[:10])}",
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
    await log_system_activity(
        db,
        source="backend",
        category="file_processing",
        level="info",
        message=f"Imported {len(parsed.tasks)} tasks from '{upload.filename}'",
        details={
            "project_id": project_id,
            "filename": upload.filename,
            "uploaded_by_id": current_user.id,
            "replace_existing": replace_existing,
            "deleted_existing": deleted_existing,
            "created": len(parsed.tasks),
            "skipped": parsed.skipped_count,
            "linked_to_parent": linked_to_parent,
        },
        commit=True,
    )
    return MSProjectImportResult(
        total_in_file=len(parsed.tasks) + parsed.skipped_count,
        created=len(parsed.tasks),
        linked_to_parent=linked_to_parent,
        skipped=parsed.skipped_count,
        deleted_existing=deleted_existing,
    )


@router.get("/{project_id}/files/{file_id}/download")
async def download_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        payload = read_project_file_bytes(record)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File missing on disk")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not decrypt file: {exc}")

    headers = {
        "Content-Disposition": f'attachment; filename="{record.filename}"',
    }
    return StreamingResponse(
        io.BytesIO(payload),
        media_type=record.content_type or "application/octet-stream",
        headers=headers,
    )


@router.get("/{project_id}/files/{file_id}/import-precheck", response_model=ImportFilePrecheckOut)
async def get_project_file_import_precheck(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        payload = read_project_file_bytes(record)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File missing on disk")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not decrypt file: {exc}")

    return ImportFilePrecheckOut(**inspect_import_file(payload, filename=record.filename).__dict__)


@router.delete("/{project_id}/files/{file_id}", status_code=204)
async def delete_project_file(
    project_id: str,
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    require_delete_permission(current_user)
    await require_project_access(project_id, current_user, db, require_manager=True)
    result = await db.execute(
        select(ProjectFile).where(
            ProjectFile.id == file_id,
            ProjectFile.project_id == project_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="File not found")
    delete_project_file_blob(record)
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
            "deleted_by_id": current_user.id,
        },
        commit=False,
    )
    await db.delete(record)
    await db.commit()


@router.get("/{project_id}/ai-jobs", response_model=list[AIIngestionJobOut])
async def list_ai_jobs(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(AIIngestionJob)
        .where(AIIngestionJob.project_id == project_id)
        .order_by(AIIngestionJob.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


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

    file_record = (
        await db.execute(
            select(ProjectFile).where(
                ProjectFile.id == file_id,
                ProjectFile.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if not file_record:
        raise HTTPException(status_code=404, detail="File not found")

    job = AIIngestionJob(
        project_id=project_id,
        project_file_id=file_id,
        created_by_id=current_user.id,
        status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    prompt_instruction = (data.prompt_instruction or "").strip() if data else ""
    process_file_for_ai.delay(job.id, prompt_instruction or None)
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
            "requested_by_id": current_user.id,
            "prompt_instruction_set": bool(prompt_instruction),
        },
        commit=True,
    )
    return job


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
    result = await db.execute(stmt.offset(offset).limit(limit))
    return result.scalars().all()


@router.post("/{project_id}/ai-drafts/{draft_id}/approve", response_model=AITaskDraftOut)
async def approve_ai_draft(
    project_id: str,
    draft_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    user_candidates = (
        await db.execute(select(User).where(User.is_active == True))
    ).scalars().all()
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

    await approve_single_ai_draft(project_id, draft, current_user, db, user_candidates=user_candidates)
    await maybe_archive_processed_file(project_id, draft.project_file_id, current_user.id, db)
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
    user_candidates = (
        await db.execute(select(User).where(User.is_active == True))
    ).scalars().all()
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
        await approve_single_ai_draft(
            project_id,
            draft,
            current_user,
            db,
            user_candidates=user_candidates,
        )
        approved.append(draft)
    for file_id in {d.project_file_id for d in approved}:
        await maybe_archive_processed_file(project_id, file_id, current_user.id, db)
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
        await maybe_archive_processed_file(project_id, file_id, current_user.id, db)
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
    await maybe_archive_processed_file(project_id, draft.project_file_id, current_user.id, db)
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
    project = await require_project_access(project_id, current_user, db, require_manager=True)
    requester_member = await get_member(project_id, current_user.id, db)
    if data.role == "owner":
        raise HTTPException(status_code=400, detail="Use project owner transfer instead")
    if data.role == "manager" and current_user.role != "admin":
        if not requester_member or requester_member.role != "owner":
            raise HTTPException(status_code=403, detail="Only owner or admin can assign manager role")
    await require_assignment_scope_user(db, current_user, data.user_id)
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
    await notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project.name,
        user_id=data.user_id,
        assigned_role=data.role,
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
    project = await require_project_access(project_id, current_user, db, require_manager=True)
    requester_member = await get_member(project_id, current_user.id, db)
    member = await get_member(project_id, user_id, db)
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
    await notify_project_assigned(
        db,
        project_id=project_id,
        project_name=project.name,
        user_id=user_id,
        assigned_role=data.role,
    )
    return {"message": "Member role updated"}


@router.delete("/{project_id}/members/{user_id}", status_code=204)
async def remove_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db, require_manager=True)
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


@router.get("/{project_id}/deadline-history", response_model=list[DeadlineChangeOut])
async def list_project_deadline_history(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await require_project_access(project_id, current_user, db)
    result = await db.execute(
        select(DeadlineChange)
        .where(DeadlineChange.entity_type == "project", DeadlineChange.entity_id == project_id)
        .options(selectinload(DeadlineChange.changed_by))
        .order_by(DeadlineChange.created_at.desc())
    )
    return result.scalars().all()
