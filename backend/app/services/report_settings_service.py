from __future__ import annotations

import re
from typing import Any
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from redis import asyncio as redis_async

from app.core.config import settings
from app.services.telegram_service import get_summaries_enabled, set_summaries_enabled

EMAIL_ANALYTICS_ENABLED_KEY = "analytics:email:enabled"
EMAIL_ANALYTICS_RECIPIENTS_KEY = "analytics:email:recipients"
SMTP_ENABLED_KEY = "smtp:enabled"
EMAIL_TEST_MODE_KEY = "email:test:mode"
EMAIL_TEST_RECIPIENT_KEY = "email:test:recipient"
ADMIN_DIRECTIVE_KEY = "analytics:admin:directive"
REPORT_DIGEST_FILTERS_KEY = "analytics:digest:filters"
REPORT_DISPATCH_SCHEDULE_KEY = "analytics:digest:schedule"

DEFAULT_REPORT_DIGEST_FILTERS: dict[str, Any] = {
    "deadline_window_days": 5,
    "priorities": ["high", "critical"],
    "include_control_ski": True,
    "include_escalations": True,
    "include_without_deadline": False,
    "anti_noise_enabled": True,
    "anti_noise_ttl_minutes": 360,
}

DEFAULT_REPORT_DISPATCH_SCHEDULE: dict[str, Any] = {
    "timezone": "Asia/Yekaterinburg",
    "telegram_projects_enabled": True,
    "telegram_critical_enabled": True,
    "email_projects_enabled": True,
    "email_critical_enabled": True,
    "telegram_projects_slots": ["mon@08:00", "fri@16:00"],
    "telegram_critical_slots": ["daily@10:00"],
    "email_analytics_slots": ["mon@08:10", "fri@16:10"],
}

DEFAULT_ADMIN_DIRECTIVE_SETTINGS: dict[str, Any] = {
    "enabled": False,
    "recipient": "aerokamero@gmail.com",
    "days": ["mon", "tue", "wed", "thu", "fri"],
    "time_window": "09:00-12:00",
    "include_overdue": True,
    "include_stale": True,
    "stale_days": 7,
    "include_unassigned": True,
    "custom_text": "",
}

_ALLOWED_DAY = {"mon", "tue", "wed", "thu", "fri", "sat", "sun", "daily"}
_DAY_TO_WEEKDAY = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
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


async def get_smtp_enabled() -> bool:
    redis = _redis()
    value = await redis.get(SMTP_ENABLED_KEY)
    if value is None:
        return bool(settings.SMTP_ENABLED)
    return value == "1"


async def set_smtp_enabled(enabled: bool) -> None:
    redis = _redis()
    await redis.set(SMTP_ENABLED_KEY, "1" if enabled else "0")


async def get_email_test_mode() -> bool:
    redis = _redis()
    value = await redis.get(EMAIL_TEST_MODE_KEY)
    if value is None:
        return bool(settings.EMAIL_TEST_MODE)
    return value == "1"


async def set_email_test_mode(enabled: bool) -> None:
    redis = _redis()
    await redis.set(EMAIL_TEST_MODE_KEY, "1" if enabled else "0")


async def get_email_test_recipient() -> str:
    redis = _redis()
    value = await redis.get(EMAIL_TEST_RECIPIENT_KEY)
    if value is None:
        return (settings.EMAIL_TEST_RECIPIENT or "").strip()
    return (value or "").strip()


async def set_email_test_recipient(email: str) -> None:
    redis = _redis()
    await redis.set(EMAIL_TEST_RECIPIENT_KEY, email.strip())


async def get_admin_directive_settings() -> dict[str, Any]:
    redis = _redis()
    raw = await redis.hgetall(ADMIN_DIRECTIVE_KEY)
    if not raw:
        return dict(DEFAULT_ADMIN_DIRECTIVE_SETTINGS)

    recipient = (raw.get("recipient") or "").strip().lower()
    if "@" not in recipient:
        recipient = str(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["recipient"])

    # Backward compatibility: old format used "slots" like "mon@09:00".
    days_raw = raw.get("days")
    if days_raw:
        days = [d.strip().lower() for d in str(days_raw).split(",") if d.strip().lower() in _DAY_TO_WEEKDAY]
    else:
        legacy_slots = _parse_slots(raw.get("slots"), ["mon@09:00"])
        days = []
        for slot in legacy_slots:
            day, _ = slot.split("@", 1)
            if day == "daily":
                days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
                break
            if day in _DAY_TO_WEEKDAY and day not in days:
                days.append(day)
    if not days:
        days = list(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["days"])

    time_window = (raw.get("time_window") or "").strip()
    if time_window not in {"06:00-09:00", "09:00-12:00", "12:00-15:00", "15:00-18:00"}:
        time_window = str(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["time_window"])
    stale_days_raw = raw.get("stale_days")
    try:
        stale_days = int(stale_days_raw) if stale_days_raw is not None else int(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["stale_days"])
    except (TypeError, ValueError):
        stale_days = int(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["stale_days"])
    stale_days = max(1, min(90, stale_days))

    return {
        "enabled": _as_bool(raw.get("enabled"), bool(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["enabled"])),
        "recipient": recipient,
        "days": days,
        "time_window": time_window,
        "include_overdue": _as_bool(raw.get("include_overdue"), bool(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["include_overdue"])),
        "include_stale": _as_bool(raw.get("include_stale"), bool(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["include_stale"])),
        "stale_days": stale_days,
        "include_unassigned": _as_bool(
            raw.get("include_unassigned"),
            bool(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["include_unassigned"]),
        ),
        "custom_text": str(raw.get("custom_text") or "").strip(),
    }


async def set_admin_directive_settings(settings_data: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULT_ADMIN_DIRECTIVE_SETTINGS)
    merged.update(settings_data or {})
    recipient = str(merged.get("recipient") or "").strip().lower()
    if "@" not in recipient:
        recipient = str(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["recipient"])

    days = [
        str(day).strip().lower()
        for day in (merged.get("days") or [])
        if str(day).strip().lower() in _DAY_TO_WEEKDAY
    ]
    if not days:
        days = list(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["days"])
    time_window = str(merged.get("time_window") or "").strip()
    if time_window not in {"06:00-09:00", "09:00-12:00", "12:00-15:00", "15:00-18:00"}:
        time_window = str(DEFAULT_ADMIN_DIRECTIVE_SETTINGS["time_window"])
    stale_days = max(1, min(90, int(merged.get("stale_days", DEFAULT_ADMIN_DIRECTIVE_SETTINGS["stale_days"]))))
    payload = {
        "enabled": "1" if bool(merged.get("enabled", False)) else "0",
        "recipient": recipient,
        "days": ",".join(days),
        "time_window": time_window,
        "include_overdue": "1" if bool(merged.get("include_overdue", True)) else "0",
        "include_stale": "1" if bool(merged.get("include_stale", True)) else "0",
        "stale_days": str(stale_days),
        "include_unassigned": "1" if bool(merged.get("include_unassigned", True)) else "0",
        "custom_text": str(merged.get("custom_text") or "").strip(),
    }
    redis = _redis()
    await redis.hset(ADMIN_DIRECTIVE_KEY, mapping=payload)
    return await get_admin_directive_settings()


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
    return re.sub(r"[^a-zA-Z0-9:_.\-]", "_", raw)


def _normalize_slot(raw: str) -> str | None:
    token = (raw or "").strip().lower()
    if "@" not in token:
        return None
    day, tm = token.split("@", 1)
    day = day.strip()
    tm = tm.strip()
    if day not in _ALLOWED_DAY:
        return None
    parts = tm.split(":")
    if len(parts) != 2:
        return None
    try:
        hh = int(parts[0])
        mm = int(parts[1])
    except ValueError:
        return None
    if hh < 0 or hh > 23 or mm < 0 or mm > 59:
        return None
    return f"{day}@{hh:02d}:{mm:02d}"


def _parse_slots(raw: str | list[str] | None, fallback: list[str]) -> list[str]:
    if isinstance(raw, list):
        items = raw
    else:
        items = (raw or "").split(",")
    slots: list[str] = []
    for item in items:
        normalized = _normalize_slot(str(item))
        if normalized and normalized not in slots:
            slots.append(normalized)
    if not slots:
        return list(fallback)
    return slots


def _as_bool(raw: Any, fallback: bool) -> bool:
    if raw is None:
        return fallback
    if isinstance(raw, bool):
        return raw
    return str(raw).strip() in {"1", "true", "True"}


def _safe_timezone_name(raw: str | None) -> str:
    candidate = (raw or "").strip() or DEFAULT_REPORT_DISPATCH_SCHEDULE["timezone"]
    try:
        ZoneInfo(candidate)
        return candidate
    except Exception:
        return DEFAULT_REPORT_DISPATCH_SCHEDULE["timezone"]


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


async def get_report_dispatch_schedule() -> dict[str, Any]:
    redis = _redis()
    raw = await redis.hgetall(REPORT_DISPATCH_SCHEDULE_KEY)
    if not raw:
        return dict(DEFAULT_REPORT_DISPATCH_SCHEDULE)

    return {
        "timezone": _safe_timezone_name(raw.get("timezone")),
        "telegram_projects_enabled": _as_bool(
            raw.get("telegram_projects_enabled"),
            bool(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_projects_enabled"]),
        ),
        "telegram_critical_enabled": _as_bool(
            raw.get("telegram_critical_enabled"),
            bool(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_critical_enabled"]),
        ),
        "email_projects_enabled": _as_bool(
            raw.get("email_projects_enabled"),
            bool(DEFAULT_REPORT_DISPATCH_SCHEDULE["email_projects_enabled"]),
        ),
        "email_critical_enabled": _as_bool(
            raw.get("email_critical_enabled"),
            bool(DEFAULT_REPORT_DISPATCH_SCHEDULE["email_critical_enabled"]),
        ),
        "telegram_projects_slots": _parse_slots(
            raw.get("telegram_projects_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_projects_slots"]),
        ),
        "telegram_critical_slots": _parse_slots(
            raw.get("telegram_critical_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_critical_slots"]),
        ),
        "email_analytics_slots": _parse_slots(
            raw.get("email_analytics_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["email_analytics_slots"]),
        ),
    }


async def set_report_dispatch_schedule(schedule: dict[str, Any]) -> dict[str, Any]:
    merged = dict(DEFAULT_REPORT_DISPATCH_SCHEDULE)
    merged.update(schedule or {})
    normalized = {
        "timezone": _safe_timezone_name(str(merged.get("timezone") or "")),
        "telegram_projects_enabled": bool(merged.get("telegram_projects_enabled", True)),
        "telegram_critical_enabled": bool(merged.get("telegram_critical_enabled", True)),
        "email_projects_enabled": bool(merged.get("email_projects_enabled", True)),
        "email_critical_enabled": bool(merged.get("email_critical_enabled", True)),
        "telegram_projects_slots": _parse_slots(
            merged.get("telegram_projects_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_projects_slots"]),
        ),
        "telegram_critical_slots": _parse_slots(
            merged.get("telegram_critical_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["telegram_critical_slots"]),
        ),
        "email_analytics_slots": _parse_slots(
            merged.get("email_analytics_slots"),
            list(DEFAULT_REPORT_DISPATCH_SCHEDULE["email_analytics_slots"]),
        ),
    }
    payload = {
        "timezone": normalized["timezone"],
        "telegram_projects_enabled": "1" if normalized["telegram_projects_enabled"] else "0",
        "telegram_critical_enabled": "1" if normalized["telegram_critical_enabled"] else "0",
        "email_projects_enabled": "1" if normalized["email_projects_enabled"] else "0",
        "email_critical_enabled": "1" if normalized["email_critical_enabled"] else "0",
        "telegram_projects_slots": ",".join(normalized["telegram_projects_slots"]),
        "telegram_critical_slots": ",".join(normalized["telegram_critical_slots"]),
        "email_analytics_slots": ",".join(normalized["email_analytics_slots"]),
    }
    redis = _redis()
    await redis.hset(REPORT_DISPATCH_SCHEDULE_KEY, mapping=payload)
    return await get_report_dispatch_schedule()


def evaluate_schedule_due(
    schedule: dict[str, Any],
    schedule_key: str,
    now_utc: datetime | None = None,
    tolerance_minutes: int = 4,
) -> tuple[bool, str | None]:
    current_utc = now_utc or datetime.now(timezone.utc)
    tz_name = _safe_timezone_name(str(schedule.get("timezone")))
    now_local = current_utc.astimezone(ZoneInfo(tz_name))
    slots_raw = schedule.get(schedule_key) or []
    slots = _parse_slots(
        slots_raw if isinstance(slots_raw, list) else str(slots_raw),
        list(DEFAULT_REPORT_DISPATCH_SCHEDULE.get(schedule_key, [])),
    )

    for slot in slots:
        day, tm = slot.split("@", 1)
        hh_str, mm_str = tm.split(":", 1)
        hh = int(hh_str)
        mm = int(mm_str)
        if day != "daily" and _DAY_TO_WEEKDAY.get(day) != now_local.weekday():
            continue
        slot_local = now_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
        delta = abs((now_local - slot_local).total_seconds())
        if delta <= max(0, tolerance_minutes) * 60:
            stamp = f"{now_local.date().isoformat()}:{slot}"
            return True, stamp
    return False, None


async def claim_schedule_slot_once(
    channel: str,
    recipient_key: str,
    digest_key: str,
    slot_stamp: str,
    ttl_seconds: int = 172800,
) -> bool:
    redis = _redis()
    key = (
        "analytics:digest:slot:"
        f"{_safe_key(channel)}:{_safe_key(recipient_key)}:{_safe_key(digest_key)}:{_safe_key(slot_stamp)}"
    )
    created = await redis.set(key, "1", nx=True, ex=max(3600, ttl_seconds))
    return bool(created)


async def get_report_dispatch_settings() -> dict[str, Any]:
    telegram_enabled = await get_summaries_enabled()
    email_enabled = await get_email_analytics_enabled()
    email_recipients = await get_email_analytics_recipients()
    smtp_enabled = await get_smtp_enabled()
    test_mode = await get_email_test_mode()
    test_recipient = await get_email_test_recipient()
    admin_directive = await get_admin_directive_settings()
    digest_filters = await get_report_digest_filters()
    digest_schedule = await get_report_dispatch_schedule()
    return {
        "smtp_enabled": smtp_enabled,
        "email_test_mode": test_mode,
        "email_test_recipient": test_recipient,
        "telegram_summaries_enabled": telegram_enabled,
        "email_analytics_enabled": email_enabled,
        "email_analytics_recipients": email_recipients,
        "admin_directive": admin_directive,
        "digest_filters": digest_filters,
        "digest_schedule": digest_schedule,
    }


async def update_report_dispatch_settings(
    smtp_enabled: bool,
    telegram_summaries_enabled: bool,
    email_analytics_enabled: bool,
    email_analytics_recipients: str,
    admin_directive: dict[str, Any] | None = None,
    digest_filters: dict[str, Any] | None = None,
    digest_schedule: dict[str, Any] | None = None,
    email_test_mode: bool | None = None,
    email_test_recipient: str | None = None,
) -> dict[str, Any]:
    await set_smtp_enabled(smtp_enabled)
    await set_summaries_enabled(telegram_summaries_enabled)
    await set_email_analytics_enabled(email_analytics_enabled)
    await set_email_analytics_recipients(email_analytics_recipients)
    if admin_directive is not None:
        await set_admin_directive_settings(admin_directive)
    if digest_filters is not None:
        await set_report_digest_filters(digest_filters)
    if digest_schedule is not None:
        await set_report_dispatch_schedule(digest_schedule)
    if email_test_mode is not None:
        await set_email_test_mode(email_test_mode)
    if email_test_recipient is not None:
        await set_email_test_recipient(email_test_recipient)
    return await get_report_dispatch_settings()
