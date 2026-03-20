from __future__ import annotations

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskComment, TaskEvent
from app.models.user import User
from app.services.ms_project_import_service import parse_ms_project_content
from app.services.project_rules_service import (
    fio_short,
    fio_short_from_parts,
    match_assignee_ids,
    sync_task_assignees_for_project,
)
from app.services.system_activity_service import log_system_activity
from app.services.temp_assignee_service import upsert_temp_assignees


async def read_import_upload_or_400(upload: UploadFile) -> tuple[str, bytes]:
    if not upload.filename:
        raise HTTPException(status_code=400, detail="Filename required")
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    return upload.filename, content


async def import_tasks_from_ms_project_content(
    db: AsyncSession,
    *,
    project_id: str,
    filename: str,
    content: bytes,
    replace_existing: bool,
    actor_id: str,
) -> dict:
    try:
        parsed = parse_ms_project_content(content, filename=filename)
    except ValueError as exc:
        await log_system_activity(
            db,
            source="backend",
            category="file_processing",
            level="error",
            message=f"MS Project import failed for '{filename}'",
            details={
                "project_id": project_id,
                "filename": filename,
                "uploaded_by_id": actor_id,
                "error": str(exc),
            },
            commit=True,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not parsed.tasks:
        return {
            "total_in_file": 0,
            "created": 0,
            "linked_to_parent": 0,
            "skipped": parsed.skipped_count,
            "deleted_existing": 0,
        }

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
    user_candidates = (await db.execute(select(User).where(User.is_active == True))).scalars().all()
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
            created_by_id=actor_id,
        )
        db.add(task)
        await db.flush()
        await sync_task_assignees_for_project(task, project_id, matched_assignee_ids, db)
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=actor_id,
                event_type="task_imported_from_ms_project",
                payload=f"ms_project_uid={item.uid};outline={item.outline_number or ''}",
            )
        )
        if item.description:
            db.add(
                TaskComment(
                    task_id=task.id,
                    author_id=actor_id,
                    body=f"Импортированный комментарий из MS Project:\n{item.description}",
                )
            )
            db.add(
                TaskEvent(
                    task_id=task.id,
                    actor_id=actor_id,
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
                created_by_id=actor_id,
            )
            db.add(
                TaskComment(
                    task_id=task.id,
                    author_id=actor_id,
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
        message=f"Imported {len(parsed.tasks)} tasks from '{filename}'",
        details={
            "project_id": project_id,
            "filename": filename,
            "uploaded_by_id": actor_id,
            "replace_existing": replace_existing,
            "deleted_existing": deleted_existing,
            "created": len(parsed.tasks),
            "skipped": parsed.skipped_count,
            "linked_to_parent": linked_to_parent,
        },
        commit=True,
    )
    return {
        "total_in_file": len(parsed.tasks) + parsed.skipped_count,
        "created": len(parsed.tasks),
        "linked_to_parent": linked_to_parent,
        "skipped": parsed.skipped_count,
        "deleted_existing": deleted_existing,
    }
