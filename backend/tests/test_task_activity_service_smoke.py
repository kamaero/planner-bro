from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.services.task_activity_service import (
    apply_bulk_events_and_notifications,
    apply_update_events_and_assignee_notifications,
)


class TaskActivityServiceSmokeTest(unittest.TestCase):
    def test_apply_update_events_and_assignee_notifications(self):
        async def _run():
            task = SimpleNamespace(id="t-1", status="done")
            serialize = AsyncMock(return_value=["u-2", "u-3"])
            notify_assigned = AsyncMock()
            log_event = AsyncMock()

            await apply_update_events_and_assignee_notifications(
                SimpleNamespace(),
                task=task,
                actor_id="u-1",
                old_status="in_progress",
                old_assignee="u-2",
                serialize_assignee_ids=serialize,
                notify_task_assigned=notify_assigned,
                log_task_event=log_event,
            )
            return notify_assigned, log_event

        notify_assigned, log_event = asyncio.run(_run())
        self.assertEqual(notify_assigned.await_count, 1)
        self.assertEqual(log_event.await_count, 2)

    def test_apply_bulk_events_and_notifications(self):
        async def _run():
            task = SimpleNamespace(id="t-2", status="done", assigned_to_id="u-9")
            serialize = AsyncMock(return_value=["u-9", "u-10"])
            notify_assigned = AsyncMock()
            notify_updated = AsyncMock()
            log_event = AsyncMock()

            await apply_bulk_events_and_notifications(
                SimpleNamespace(),
                task=task,
                actor_id="u-1",
                old_status="review",
                old_assignee="u-8",
                changed_payload_keys=["status", "priority"],
                serialize_assignee_ids=serialize,
                notify_task_assigned=notify_assigned,
                notify_task_updated=notify_updated,
                log_task_event=log_event,
            )
            return notify_assigned, notify_updated, log_event

        notify_assigned, notify_updated, log_event = asyncio.run(_run())
        self.assertEqual(notify_assigned.await_count, 2)
        notify_updated.assert_awaited_once()
        self.assertEqual(log_event.await_count, 3)


if __name__ == "__main__":
    unittest.main()
