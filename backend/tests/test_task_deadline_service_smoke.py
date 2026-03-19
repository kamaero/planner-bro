from __future__ import annotations

import asyncio
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import HTTPException

from app.models.deadline_change import DeadlineChange
from app.services.task_deadline_service import (
    record_deadline_change_and_date_events,
    validate_deadline_reason,
)


class _FakeDB:
    def __init__(self):
        self.added = []

    def add(self, item):
        self.added.append(item)


class TaskDeadlineServiceSmokeTest(unittest.TestCase):
    def test_validate_deadline_reason_requires_reason_outside_planning(self):
        with self.assertRaises(HTTPException):
            validate_deadline_reason(
                old_end_date=date(2026, 3, 1),
                new_end_date=date(2026, 3, 2),
                projected_status="in_progress",
                deadline_change_reason=None,
            )

    def test_validate_deadline_reason_allows_planning_without_reason(self):
        validate_deadline_reason(
            old_end_date=date(2026, 3, 1),
            new_end_date=date(2026, 3, 2),
            projected_status="planning",
            deadline_change_reason=None,
        )

    def test_record_deadline_change_and_date_events(self):
        async def _run():
            db = _FakeDB()
            logger = AsyncMock()
            task = SimpleNamespace(
                id="t-1",
                start_date=date(2026, 3, 10),
                end_date=date(2026, 3, 20),
            )
            await record_deadline_change_and_date_events(
                db,
                task=task,
                actor_id="u-1",
                old_start_date=date(2026, 3, 9),
                old_end_date=date(2026, 3, 18),
                projected_status="review",
                deadline_change_reason="re-plan",
                log_task_event=logger,
            )
            return db, logger

        db, logger = asyncio.run(_run())
        self.assertEqual(len(db.added), 1)
        self.assertIsInstance(db.added[0], DeadlineChange)
        self.assertEqual(logger.await_count, 2)


if __name__ == "__main__":
    unittest.main()
