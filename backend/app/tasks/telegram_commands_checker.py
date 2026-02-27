import asyncio

from app.core.config import settings
from app.services.telegram_service import (
    escape_html,
    get_chat_admin_user_ids,
    get_updates,
    get_updates_offset,
    send_chat_message,
    set_summaries_enabled,
    set_updates_offset,
)
from app.services.system_activity_service import log_system_activity_standalone
from app.tasks.celery_app import celery_app
from app.tasks.telegram_summary_checker import send_critical_tasks_summary, send_projects_summary
from redis import asyncio as redis_async


def _is_enabled() -> bool:
    return (
        settings.TELEGRAM_BOT_ENABLED
        and bool(settings.TELEGRAM_BOT_TOKEN.strip())
        and bool(settings.TELEGRAM_CHAT_ID.strip())
    )


def _admin_user_ids() -> set[str]:
    raw = settings.TELEGRAM_ADMIN_USER_IDS.strip()
    if not raw:
        return set()
    return {item.strip() for item in raw.split(",") if item.strip()}


@celery_app.task(name="app.tasks.telegram_commands_checker.check_telegram_commands")
def check_telegram_commands():
    asyncio.run(_async_check_telegram_commands())


async def _is_authorized(user_id: str, chat_id: str, command: str) -> bool:
    explicit = _admin_user_ids()
    admins = await get_chat_admin_user_ids(chat_id)

    if command in {"/start", "/stop"}:
        if explicit:
            return user_id in explicit
        return user_id in admins

    # /stats: all chat admins (and explicit IDs as override)
    return user_id in admins or user_id in explicit


def _normalize_command(text: str) -> str:
    first = (text or "").strip().split(" ", 1)[0].lower()
    if "@" in first:
        first = first.split("@", 1)[0]
    return first


def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.CELERY_BROKER_URL, decode_responses=True)


async def _async_check_telegram_commands() -> None:
    if not _is_enabled():
        return

    chat_id = settings.TELEGRAM_CHAT_ID.strip()
    offset = await get_updates_offset()
    updates = await get_updates(offset=offset, limit=100, timeout=0)
    if not updates:
        return

    for upd in updates:
        update_id = int(upd.get("update_id", 0))
        try:
            message = upd.get("message") or upd.get("edited_message")
            if not message:
                continue
            chat = message.get("chat") or {}
            if str(chat.get("id")) != chat_id:
                continue

            text = message.get("text") or ""
            command = _normalize_command(text)
            if command not in {"/start", "/stop", "/stats"}:
                continue

            sender = message.get("from") or {}
            sender_id = str(sender.get("id", ""))
            sender_name = sender.get("first_name") or sender.get("username") or sender_id
            if not sender_id:
                continue
            if not await _is_authorized(sender_id, chat_id, command):
                await log_system_activity_standalone(
                    source="telegram_bot",
                    category="telegram",
                    level="warning",
                    message=f"Telegram command rejected: {command}",
                    details={"chat_id": chat_id, "sender_id": sender_id, "sender_name": str(sender_name)},
                )
                await send_chat_message(
                    chat_id,
                    f"⛔ Команда {escape_html(command)} отклонена. "
                    f"Пользователь {escape_html(str(sender_name))} не имеет прав для этой команды.",
                )
                continue

            if command == "/start":
                await set_summaries_enabled(True)
                await log_system_activity_standalone(
                    source="telegram_bot",
                    category="telegram",
                    level="info",
                    message="Telegram summaries enabled via /start",
                    details={"chat_id": chat_id, "sender_id": sender_id},
                )
                await send_chat_message(chat_id, "✅ Сводки PlannerBro включены.")
                continue

            if command == "/stop":
                await set_summaries_enabled(False)
                await log_system_activity_standalone(
                    source="telegram_bot",
                    category="telegram",
                    level="warning",
                    message="Telegram summaries stopped via /stop",
                    details={"chat_id": chat_id, "sender_id": sender_id},
                )
                await send_chat_message(chat_id, "⏸ Сводки PlannerBro остановлены.")
                continue

            if command == "/stats":
                redis = _redis()
                lock_key = f"telegram:stats:cooldown:{chat_id}"
                is_allowed = await redis.set(lock_key, "1", ex=60, nx=True)
                if not is_allowed:
                    await log_system_activity_standalone(
                        source="telegram_bot",
                        category="telegram",
                        level="warning",
                        message="Telegram /stats ignored due cooldown",
                        details={"chat_id": chat_id, "sender_id": sender_id},
                    )
                    continue
                await log_system_activity_standalone(
                    source="telegram_bot",
                    category="telegram",
                    level="info",
                    message="Telegram /stats accepted",
                    details={"chat_id": chat_id, "sender_id": sender_id},
                )
                await send_chat_message(chat_id, "📊 Готовлю сводку...")
                send_projects_summary.delay(compact=True, force=True)
                send_critical_tasks_summary.delay(compact=True, force=True)
        except Exception as exc:
            await log_system_activity_standalone(
                source="telegram_bot",
                category="telegram_error",
                level="error",
                message="Telegram command processing failed",
                details={"chat_id": chat_id, "error": str(exc)},
            )
            err = str(exc).lower()
            if "429" not in err and "too many requests" not in err:
                try:
                    await send_chat_message(chat_id, "⚠️ Команда не выполнена из-за временной ошибки.")
                except Exception:
                    pass
        finally:
            await set_updates_offset(update_id + 1)
