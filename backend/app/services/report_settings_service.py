from __future__ import annotations

import re
from typing import Any

from redis import asyncio as redis_async

from app.core.config import settings
from app.services.telegram_service import get_summaries_enabled, set_summaries_enabled

EMAIL_ANALYTICS_ENABLED_KEY = "analytics:email:enabled"
EMAIL_ANALYTICS_RECIPIENTS_KEY = "analytics:email:recipients"
REPORT_DIGEST_FILTERS_KEY = "analytics:digest:filters"

DEFAULT_REPORT_DIGEST_FILTERS: dict[str, Any] = {
    "deadline_window_days": 5,
    "priorities": ["high", "critical"],
    "include_control_ski": True,
    "include_escalations": True,
    "include_without_deadline": False,
    "anti_noise_enabled": True,
    "anti_noise_ttl_minutes": 360,
}


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


async def get_report_digest_filters() -> dict[str, Any]:
    redis = _redis()
    raw = await redis.hgetall(REPORT_DIGEST_FILTERS_KEY)
    if not raw:
        return dict(DEFAULT_REPORT_DIGEST_FILTERS)

    priorities_csv = (raw.get("priorities") or "").strip()
    priorities = [p.strip().lower() for p in priorities_csv.split(",") if p.strip()]
    if not priorities:
        priorities = list(DEFAULT_REPORT_DIGEST_FILTERS["priorities"])

    def _as_bool(key: str, fallback: bool) -> bool:
        val = raw.get(key)
        if val is None:
            return fallback
        return str(val).strip() in {"1", "true", "True"}

    def _as_int(key: str, fallback: int, min_value: int, max_value: int) -> int:
        val = raw.get(key)
        if val is None:
            return fallback
        try:
            return max(min_value, min(max_value, int(val)))
        except (TypeError, ValueError):
            return fallback

    return {
        "deadline_window_days": _as_int("deadline_window_days", 5, 0, 60),
        "priorities": priorities,
        "include_control_ski": _as_bool("include_control_ski", True),
        "include_escalations": _as_bool("include_escalations", True),
        "include_without_deadline": _as_bool("include_without_deadline", False),
        "anti_noise_enabled": _as_bool("anti_noise_enabled", True),
        "anti_noise_ttl_minutes": _as_int("anti_noise_ttl_minutes", 360, 15, 1440),
    }


async def set_report_digest_filters(filters: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULT_REPORT_DIGEST_FILTERS)
    merged.update(filters or {})

    priorities = [str(p).strip().lower() for p in (merged.get("priorities") or []) if str(p).strip()]
    if not priorities:
        priorities = list(DEFAULT_REPORT_DIGEST_FILTERS["priorities"])

    payload = {
        "deadline_window_days": str(max(0, min(60, int(merged.get("deadline_window_days", 5))))),
        "priorities": ",".join(priorities),
        "include_control_ski": "1" if bool(merged.get("include_control_ski", True)) else "0",
        "include_escalations": "1" if bool(merged.get("include_escalations", True)) else "0",
        "include_without_deadline": "1" if bool(merged.get("include_without_deadline", False)) else "0",
        "anti_noise_enabled": "1" if bool(merged.get("anti_noise_enabled", True)) else "0",
        "anti_noise_ttl_minutes": str(max(15, min(1440, int(merged.get("anti_noise_ttl_minutes", 360))))),
    }

    redis = _redis()
    await redis.hset(REPORT_DIGEST_FILTERS_KEY, mapping=payload)
    return await get_report_digest_filters()


def _safe_key(raw: str) -> str:
    return re.sub(r"[^a-zA-Z0-9:_\-.]", "_", raw)


async def should_send_digest(
    channel: str,
    recipient_key: str,
    digest_key: str,
    fingerprint: str,
    ttl_minutes: int,
) -> bool:
    redis = _redis()
    key = (
        "analytics:digest:last:"
        f"{_safe_key(channel)}:{_safe_key(recipient_key)}:{_safe_key(digest_key)}"
    )
    previous = await redis.get(key)
    if previous == fingerprint:
        return False
    await redis.set(key, fingerprint, ex=max(900, ttl_minutes * 60))
    return True


async def get_report_dispatch_settings() -> dict[str, Any]:
    telegram_enabled = await get_summaries_enabled()
    email_enabled = await get_email_analytics_enabled()
    email_recipients = await get_email_analytics_recipients()
    digest_filters = await get_report_digest_filters()
    return {
        "telegram_summaries_enabled": telegram_enabled,
        "email_analytics_enabled": email_enabled,
        "email_analytics_recipients": email_recipients,
        "digest_filters": digest_filters,
    }


async def update_report_dispatch_settings(
    telegram_summaries_enabled: bool,
    email_analytics_enabled: bool,
    email_analytics_recipients: str,
    digest_filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    await set_summaries_enabled(telegram_summaries_enabled)
    await set_email_analytics_enabled(email_analytics_enabled)
    await set_email_analytics_recipients(email_analytics_recipients)
    if digest_filters is not None:
        await set_report_digest_filters(digest_filters)
    return await get_report_dispatch_settings()
