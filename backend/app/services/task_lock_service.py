"""Distributed Redis locks for Celery task idempotency.

Prevents duplicate task executions when celery-beat restarts mid-cycle
or when multiple beat/worker instances run simultaneously.

Usage:
    if not await acquire_task_run_lock("check_deadlines", ttl_seconds=3300):
        return  # another instance already running
"""
from __future__ import annotations

import logging

from redis import asyncio as redis_async

from app.core.config import settings

logger = logging.getLogger(__name__)


def _redis() -> redis_async.Redis:
    return redis_async.from_url(settings.CELERY_BROKER_URL, decode_responses=True)


async def acquire_task_run_lock(task_name: str, ttl_seconds: int) -> bool:
    """
    Try to acquire an exclusive run lock for *task_name*.

    Returns True  → lock acquired, task should proceed.
    Returns False → lock already held by another instance, task should skip.

    The lock expires automatically after *ttl_seconds* so a crashed worker
    cannot hold it forever.
    """
    r = _redis()
    key = f"celery:task:lock:{task_name}"
    acquired = await r.set(key, "1", nx=True, ex=max(60, ttl_seconds))
    if not acquired:
        logger.debug("task_lock: skipped %s — lock already held", task_name)
    return bool(acquired)
