from datetime import date
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.changelog_service import get_changelog

router = APIRouter(prefix="/changelog", tags=["changelog"])


@router.get("")
async def get_changelog_endpoint(current_user: User = Depends(get_current_user)):
    return get_changelog()


@router.post("/dismiss")
async def dismiss_changelog(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    data = get_changelog()
    sections = data["sections"]
    latest_date: date | None = None
    if sections:
        try:
            latest_date = date.fromisoformat(sections[0].date)
        except ValueError:
            pass

    current_user.last_seen_changelog_hash = data["hash"]
    current_user.last_seen_changelog_date = latest_date
    await db.commit()
    return {"ok": True}
