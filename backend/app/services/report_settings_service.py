from __future__ import annotations

from redis import asyncio as redis_async

from app.core.config import settings
from app.services.telegram_service import get_summaries_enabled, set_summaries_enabled

EMAIL_ANALYTICS_ENABLED_KEY = "analytics:email:enabled"
EMAIL_ANALYTICS_RECIPIENTS_KEY = "analytics:email:recipients"


def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.CELERY_BROKER_URL, decode_responses=True)


async def get_email_analytics_enabled() -> bool:
    redis = _redis()
    value = await redis.get(EMAIL_ANALYTICS_ENABLED_KEY)
    if value is None:
        return bool(settings.EMAIL_ANALYTICS_ENABLED)
    return value == "1"


async def set_email_analytics_enabled(enabled: bool) -> None:
    redis = _redis()
    await redis.set(EMAIL_ANALYTICS_ENABLED_KEY, "1" if enabled else "0")


async def get_email_analytics_recipients() -> str:
    redis = _redis()
    value = await redis.get(EMAIL_ANALYTICS_RECIPIENTS_KEY)
    if value is None:
        return (settings.EMAIL_ANALYTICS_RECIPIENTS or "").strip()
    return (value or "").strip()


async def set_email_analytics_recipients(recipients_csv: str) -> None:
    redis = _redis()
    await redis.set(EMAIL_ANALYTICS_RECIPIENTS_KEY, recipients_csv.strip())


async def get_report_dispatch_settings() -> dict[str, str | bool]:
    telegram_enabled = await get_summaries_enabled()
    email_enabled = await get_email_analytics_enabled()
    email_recipients = await get_email_analytics_recipients()
    return {
        "telegram_summaries_enabled": telegram_enabled,
        "email_analytics_enabled": email_enabled,
        "email_analytics_recipients": email_recipients,
    }


async def update_report_dispatch_settings(
    telegram_summaries_enabled: bool,
    email_analytics_enabled: bool,
    email_analytics_recipients: str,
) -> dict[str, str | bool]:
    await set_summaries_enabled(telegram_summaries_enabled)
    await set_email_analytics_enabled(email_analytics_enabled)
    await set_email_analytics_recipients(email_analytics_recipients)
    return await get_report_dispatch_settings()
