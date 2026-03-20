from __future__ import annotations

from datetime import date

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.ai import AIIngestionJob, AITaskDraft
from app.models.deadline_change import DeadlineChange
from app.models.task import Task, TaskAssignee, TaskComment, TaskEvent
from app.models.user import User
from app.services.project_rules_service import (
    collect_assignee_hints,
    extract_task_number,
    fio_short,
    fio_short_from_parts,
    match_assignee_ids,
    sync_task_assignees_for_project,
)
from app.services.temp_assignee_service import upsert_temp_assignees


async def get_user_candidates(db: AsyncSession) -> list[User]:
    return (await db.execute(select(User).where(User.is_active == True))).scalars().all()


async def get_ai_draft_or_404(
    db: AsyncSession,
    *,
    project_id: str,
    draft_id: str,
) -> AITaskDraft:
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
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="AI draft not found")
    return draft


async def list_ai_drafts_by_ids(
    db: AsyncSession,
    *,
    project_id: str,
    draft_ids: list[str],
) -> list[AITaskDraft]:
    result = await db.execute(
        select(AITaskDraft)
        .where(
            AITaskDraft.project_id == project_id,
            AITaskDraft.id.in_(draft_ids),
        )
        .options(selectinload(AITaskDraft.assignee))
    )
    return result.scalars().all()


async def list_ai_jobs_for_project(db: AsyncSession, *, project_id: str) -> list[AIIngestionJob]:
    result = await db.execute(
        select(AIIngestionJob)
        .where(AIIngestionJob.project_id == project_id)
        .order_by(AIIngestionJob.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


async def list_ai_drafts_for_project(
    db: AsyncSession,
    *,
    project_id: str,
    file_id: str | None,
    status_filter: str | None,
    limit: int,
    offset: int,
) -> list[AITaskDraft]:
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


def reject_pending_draft(draft: AITaskDraft, *, actor_id: str) -> bool:
    if draft.status != "pending":
        return False
    draft.status = "rejected"
    draft.approved_by_id = actor_id
    return True


def ensure_pending_draft_or_400(draft: AITaskDraft) -> None:
    if draft.status != "pending":
        raise HTTPException(status_code=400, detail="AI draft is already processed")


async def approve_ai_draft_and_archive(
    db: AsyncSession,
    *,
    project_id: str,
    draft: AITaskDraft,
    actor: User,
    user_candidates: list[User],
) -> None:
    from app.services.project_access_service import maybe_archive_processed_file

    ensure_pending_draft_or_400(draft)
    await approve_single_ai_draft(project_id, draft, actor, db, user_candidates=user_candidates)
    await maybe_archive_processed_file(project_id, draft.project_file_id, actor.id, db)


async def approve_ai_drafts_bulk_and_archive(
    db: AsyncSession,
    *,
    project_id: str,
    draft_ids: list[str],
    actor: User,
    user_candidates: list[User],
) -> list[AITaskDraft]:
    from app.services.project_access_service import maybe_archive_processed_file

    drafts = await list_ai_drafts_by_ids(db, project_id=project_id, draft_ids=draft_ids)
    draft_map = {d.id: d for d in drafts}
    approved: list[AITaskDraft] = []
    for draft_id in draft_ids:
        draft = draft_map.get(draft_id)
        if not draft or draft.status != "pending":
            continue
        await approve_single_ai_draft(
            project_id,
            draft,
            actor,
            db,
            user_candidates=user_candidates,
        )
        approved.append(draft)
    for file_id in {d.project_file_id for d in approved}:
        await maybe_archive_processed_file(project_id, file_id, actor.id, db)
    return approved


async def reject_ai_draft_and_archive(
    db: AsyncSession,
    *,
    project_id: str,
    draft: AITaskDraft,
    actor_id: str,
) -> None:
    from app.services.project_access_service import maybe_archive_processed_file

    ensure_pending_draft_or_400(draft)
    reject_pending_draft(draft, actor_id=actor_id)
    await maybe_archive_processed_file(project_id, draft.project_file_id, actor_id, db)


async def reject_ai_drafts_bulk_and_archive(
    db: AsyncSession,
    *,
    project_id: str,
    draft_ids: list[str],
    actor_id: str,
) -> list[AITaskDraft]:
    from app.services.project_access_service import maybe_archive_processed_file

    drafts = await list_ai_drafts_by_ids(db, project_id=project_id, draft_ids=draft_ids)
    draft_map = {d.id: d for d in drafts}
    rejected: list[AITaskDraft] = []
    for draft_id in draft_ids:
        draft = draft_map.get(draft_id)
        if not draft or not reject_pending_draft(draft, actor_id=actor_id):
            continue
        rejected.append(draft)
    for file_id in {d.project_file_id for d in rejected}:
        await maybe_archive_processed_file(project_id, file_id, actor_id, db)
    return rejected


async def approve_single_ai_draft(
    project_id: str,
    draft: AITaskDraft,
    actor: User,
    db: AsyncSession,
    user_candidates: list[User] | None = None,
) -> Task:
    from app.services.notification_service import notify_new_task, notify_task_assigned

    raw_payload = draft.raw_payload or {}
    assignee_hints = collect_assignee_hints(draft.assignee_hint, raw_payload)
    assignee_ids: list[str] = []
    if user_candidates is None:
        user_candidates = (
            await db.execute(select(User).where(User.is_active == True))
        ).scalars().all()
    assignee_ids = match_assignee_ids(assignee_hints, user_candidates)
    if not assignee_ids and draft.assigned_to_id:
        assignee_ids = [draft.assigned_to_id]
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
            source="ai_draft_approve",
            project_id=project_id,
            created_by_id=actor.id,
        )

    draft_task_no = str(raw_payload.get("task_no") or "").strip() or extract_task_number(draft.title)
    normalized_title = (draft.title or "").strip().lower()
    existing_candidates = (
        await db.execute(
            select(Task)
            .where(
                Task.project_id == project_id,
                Task.status != "done",
            )
            .order_by(Task.updated_at.desc())
            .limit(500)
        )
    ).scalars().all()

    matched_task: Task | None = None
    for candidate in existing_candidates:
        candidate_no = extract_task_number(candidate.title)
        if draft_task_no and candidate_no == draft_task_no:
            matched_task = candidate
            break
        if normalized_title and candidate.title.strip().lower() == normalized_title:
            matched_task = candidate
            break

    is_rollover = matched_task is not None
    if is_rollover:
        task = matched_task
        old_end_date = task.end_date
        old_assignee_ids = [task.assigned_to_id] if task.assigned_to_id else []
        existing_links = (
            await db.execute(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id))
        ).scalars().all()
        if existing_links:
            old_assignee_ids = existing_links
        if draft.description:
            task.description = draft.description
        task.priority = draft.priority
        task.estimated_hours = draft.estimated_hours
        task.next_step = draft.next_step
        if draft.end_date:
            task.end_date = draft.end_date
        if task.progress_percent == 0 and draft.progress_percent:
            task.progress_percent = draft.progress_percent
        await sync_task_assignees_for_project(task, project_id, assignee_ids, db)

        if old_end_date and task.end_date and old_end_date != task.end_date:
            db.add(
                DeadlineChange(
                    entity_type="task",
                    entity_id=task.id,
                    changed_by_id=actor.id,
                    old_date=old_end_date,
                    new_date=task.end_date,
                    reason="Квартальный перенос при импорте нового плана",
                )
            )
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=actor.id,
                event_type="task_rollover_from_ai_draft",
                payload=f"draft_id={draft.id};was_overdue={bool(old_end_date and old_end_date < date.today())}",
            )
        )
        for user_id in sorted(set(assignee_ids) - set(old_assignee_ids)):
            await notify_task_assigned(
                db,
                task,
                user_id,
                actor_id=actor.id,
            )
    else:
        task = Task(
            project_id=project_id,
            title=draft.title,
            description=draft.description,
            status="todo",
            priority=draft.priority,
            end_date=draft.end_date,
            assigned_to_id=assignee_ids[0] if assignee_ids else None,
            estimated_hours=draft.estimated_hours,
            progress_percent=draft.progress_percent,
            next_step=draft.next_step,
            created_by_id=actor.id,
        )
        db.add(task)
        await db.flush()
        await sync_task_assignees_for_project(task, project_id, assignee_ids, db)
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=actor.id,
                event_type="task_created_from_ai_draft",
                payload=f"draft_id={draft.id}",
            )
        )

    draft_comment = str(raw_payload.get("comment") or "").strip()
    if draft_comment:
        db.add(
            TaskComment(
                task_id=task.id,
                author_id=actor.id,
                body=draft_comment[:4000],
            )
        )
        db.add(
            TaskEvent(
                task_id=task.id,
                actor_id=actor.id,
                event_type="comment_added_from_import",
                payload="raw_payload.comment",
            )
        )

    draft.status = "approved"
    draft.approved_by_id = actor.id
    draft.approved_task_id = task.id
    if assignee_hints:
        draft.raw_payload = {**raw_payload, "assignee_hints": assignee_hints, "matched_assignee_ids": assignee_ids}
    await db.flush()
    if assignee_ids and not is_rollover:
        for user_id in assignee_ids:
            await notify_task_assigned(
                db,
                task,
                user_id,
                actor_id=actor.id,
            )
    if not is_rollover:
        await notify_new_task(db, task)
    return task
