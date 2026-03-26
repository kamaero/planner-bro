from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai import AITaskDraft
from app.models.user import User
from app.services.project_ai_draft_service import (
    approve_ai_draft_and_archive,
    approve_ai_drafts_bulk_and_archive,
    get_ai_draft_or_404,
    get_user_candidates,
    reject_ai_draft_and_archive,
    reject_ai_drafts_bulk_and_archive,
)


async def approve_ai_draft_flow(
    db: AsyncSession,
    *,
    project_id: str,
    draft_id: str,
    actor: User,
) -> AITaskDraft:
    user_candidates = await get_user_candidates(db)
    draft = await get_ai_draft_or_404(db, project_id=project_id, draft_id=draft_id)
    await approve_ai_draft_and_archive(
        db,
        project_id=project_id,
        draft=draft,
        actor=actor,
        user_candidates=user_candidates,
    )
    await db.commit()
    await db.refresh(draft)
    return draft


async def approve_ai_drafts_bulk_flow(
    db: AsyncSession,
    *,
    project_id: str,
    draft_ids: list[str],
    actor: User,
    delete_existing_tasks: bool = False,
) -> list[AITaskDraft]:
    user_candidates = await get_user_candidates(db)
    approved = await approve_ai_drafts_bulk_and_archive(
        db,
        project_id=project_id,
        draft_ids=draft_ids,
        actor=actor,
        user_candidates=user_candidates,
        delete_existing_tasks=delete_existing_tasks,
    )
    await db.commit()
    return approved


async def reject_ai_drafts_bulk_flow(
    db: AsyncSession,
    *,
    project_id: str,
    draft_ids: list[str],
    actor_id: str,
) -> list[AITaskDraft]:
    rejected = await reject_ai_drafts_bulk_and_archive(
        db,
        project_id=project_id,
        draft_ids=draft_ids,
        actor_id=actor_id,
    )
    await db.commit()
    return rejected


async def reject_ai_draft_flow(
    db: AsyncSession,
    *,
    project_id: str,
    draft_id: str,
    actor_id: str,
) -> AITaskDraft:
    draft = await get_ai_draft_or_404(db, project_id=project_id, draft_id=draft_id)
    await reject_ai_draft_and_archive(
        db,
        project_id=project_id,
        draft=draft,
        actor_id=actor_id,
    )
    await db.commit()
    await db.refresh(draft)
    return draft
