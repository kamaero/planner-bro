from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.ai_project_manager_service import analyze_project
from app.services.task_access_service import require_project_member

router = APIRouter(prefix="/projects", tags=["ai-analysis"])


@router.post("/{project_id}/ai-analysis")
async def run_project_ai_analysis(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """On-demand AI analysis of a project: risks, workload, recommendations."""
    await require_project_member(project_id, current_user, db)
    try:
        return await analyze_project(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
