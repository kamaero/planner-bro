from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Date as SADate

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.project import Project, ProjectMember
from app.models.task import Task, TaskEvent
from app.models.user import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/activity-heatmap")
async def activity_heatmap(
    days: int = Query(default=365, ge=30, le=730),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return daily event counts for the activity heatmap (GitHub-style calendar)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Accessible project IDs
    if current_user.role == "admin":
        project_ids = (await db.execute(select(Project.id))).scalars().all()
    else:
        project_ids = (
            await db.execute(
                select(ProjectMember.project_id).where(
                    ProjectMember.user_id == current_user.id
                )
            )
        ).scalars().all()

    if not project_ids:
        return {"days": {}, "total_events": 0}

    # Task IDs within accessible projects
    task_ids = (
        await db.execute(select(Task.id).where(Task.project_id.in_(project_ids)))
    ).scalars().all()

    if not task_ids:
        return {"days": {}, "total_events": 0}

    # Aggregate task_events by calendar date
    event_date_col = cast(TaskEvent.created_at, SADate)
    rows = (
        await db.execute(
            select(
                event_date_col.label("event_date"),
                func.count(TaskEvent.id).label("cnt"),
            )
            .where(
                TaskEvent.task_id.in_(task_ids),
                TaskEvent.created_at >= cutoff,
            )
            .group_by(event_date_col)
            .order_by(event_date_col)
        )
    ).all()

    days_data = {str(row.event_date): row.cnt for row in rows}
    total = sum(days_data.values())
    return {"days": days_data, "total_events": total}
