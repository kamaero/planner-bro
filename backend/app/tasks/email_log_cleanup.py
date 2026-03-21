import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete

from app.core.database import AsyncSessionLocal
from app.models.email_dispatch_log import EmailDispatchLog
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

RETENTION_DAYS = 30


@celery_app.task(name="app.tasks.email_log_cleanup.cleanup_email_logs")
def cleanup_email_logs():
    asyncio.run(_async_cleanup())


async def _async_cleanup():
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            delete(EmailDispatchLog).where(EmailDispatchLog.created_at < cutoff)
        )
        await db.commit()
        deleted = result.rowcount
        if deleted:
            logger.info(
                "Email log cleanup: deleted %d records older than %d days",
                deleted,
                RETENTION_DAYS,
            )
