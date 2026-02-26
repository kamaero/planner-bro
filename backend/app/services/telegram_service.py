import asyncio
import html

import httpx
from redis import asyncio as redis_async

from app.core.config import settings

TELEGRAM_SUMMARIES_ENABLED_KEY = "telegram:summaries:enabled"
TELEGRAM_UPDATES_OFFSET_KEY = "telegram:updates:offset"


def _enabled() -> bool:
    return (
        settings.TELEGRAM_BOT_ENABLED
        and bool(settings.TELEGRAM_BOT_TOKEN.strip())
        and bool(settings.TELEGRAM_CHAT_ID.strip())
    )


def escape_html(text: str) -> str:
    return html.escape(text, quote=False)


def _api_url(method: str) -> str:
    token = settings.TELEGRAM_BOT_TOKEN.strip()
    return f"https://api.telegram.org/bot{token}/{method}"


async def _request(method: str, payload: dict) -> dict:
    if not _enabled():
        return {}
    async with httpx.AsyncClient(timeout=20.0) as client:
        for attempt in range(2):
            response = await client.post(_api_url(method), json=payload)
            if response.status_code != 429:
                response.raise_for_status()
                return response.json()
            if attempt == 1:
                response.raise_for_status()
            retry_after = 1
            try:
                body = response.json()
                retry_after = int(body.get("parameters", {}).get("retry_after", 1))
            except Exception:
                retry_after = 1
            await asyncio.sleep(max(1, min(retry_after, 30)))
    return {}


async def send_telegram_message(text: str) -> None:
    if not _enabled():
        return
    await _request(
        "sendMessage",
        {
            "chat_id": settings.TELEGRAM_CHAT_ID.strip(),
            "text": text[:4096],
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
    )


async def send_chat_message(chat_id: str, text: str) -> None:
    if not _enabled():
        return
    await _request(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": text[:4096],
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        },
    )


async def get_updates(offset: int = 0, limit: int = 100, timeout: int = 0) -> list[dict]:
    if not _enabled():
        return []
    result = await _request(
        "getUpdates",
        {"offset": offset, "limit": limit, "timeout": timeout},
    )
    return result.get("result", [])


async def get_chat_admin_user_ids(chat_id: str) -> set[str]:
    if not _enabled():
        return set()
    result = await _request("getChatAdministrators", {"chat_id": chat_id})
    admins: set[str] = set()
    for row in result.get("result", []):
        user = row.get("user") or {}
        user_id = user.get("id")
        if user_id is not None:
            admins.add(str(user_id))
    return admins


def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.CELERY_BROKER_URL, decode_responses=True)


async def get_summaries_enabled() -> bool:
    if not _enabled():
        return False
    redis = _redis()
    value = await redis.get(TELEGRAM_SUMMARIES_ENABLED_KEY)
    if value is None:
        return True
    return value == "1"


async def set_summaries_enabled(enabled: bool) -> None:
    if not _enabled():
        return
    redis = _redis()
    await redis.set(TELEGRAM_SUMMARIES_ENABLED_KEY, "1" if enabled else "0")


async def get_updates_offset() -> int:
    if not _enabled():
        return 0
    redis = _redis()
    value = await redis.get(TELEGRAM_UPDATES_OFFSET_KEY)
    if not value:
        return 0
    try:
        return int(value)
    except ValueError:
        return 0


async def set_updates_offset(offset: int) -> None:
    if not _enabled():
        return
    redis = _redis()
    await redis.set(TELEGRAM_UPDATES_OFFSET_KEY, str(offset))
