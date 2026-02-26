from datetime import datetime, timezone

import redis.asyncio as redis

from app.core.config import settings

_redis_client: redis.Redis | None = None


def get_redis_client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


def _ttl_from_exp(exp: int) -> int:
    now_ts = int(datetime.now(timezone.utc).timestamp())
    return max(exp - now_ts, 1)


async def is_refresh_token_revoked(jti: str) -> bool:
    key = f"refresh_revoked:{jti}"
    value = await get_redis_client().get(key)
    return value is not None


async def revoke_refresh_token(jti: str, exp: int) -> None:
    key = f"refresh_revoked:{jti}"
    ttl = _ttl_from_exp(exp)
    await get_redis_client().set(key, "1", ex=ttl)
