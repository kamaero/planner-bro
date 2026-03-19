from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.task_lifecycle_service import (
    mark_escalation_response,
    normalize_priority_for_control_ski,
    plan_next_check_in,
    prepare_escalation_fields,
    rollup_parent_schedule,
    validate_parent_task,
)


class _ResultOne:
    def __init__(self, value):
        self._value = value

    def one(self):
        return self._value


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, one_values=None, scalar_values=None):
        self._one_values = list(one_values or [])
        self._scalar_values = list(scalar_values or [])

    async def execute(self, _query):
        if self._one_values:
            return _ResultOne(self._one_values.pop(0))
        if self._scalar_values:
            return _ScalarResult(self._scalar_values.pop(0))
        raise AssertionError("No fake DB results left")


class TaskLifecycleServiceSmokeTest(unittest.TestCase):
    def test_priority_normalization(self):
        self.assertEqual(normalize_priority_for_control_ski("low", True), "critical")
        self.assertEqual(normalize_priority_for_control_ski("critical", False), "medium")
        self.assertEqual(normalize_priority_for_control_ski("high", False), "high")

    def test_prepare_escalation_fields(self):
        payload = {"is_escalation": False, "escalation_sla_hours": 12}
        prepare_escalation_fields(payload)
        self.assertEqual(payload["escalation_sla_hours"], 12)
        self.assertIsNone(payload["escalation_due_at"])

        payload = {"is_escalation": True, "escalation_sla_hours": 0}
        base = datetime(2026, 3, 1, tzinfo=timezone.utc)
        prepare_escalation_fields(payload, base)
        self.assertEqual(payload["escalation_sla_hours"], 24)
        self.assertEqual(payload["escalation_due_at"], datetime(2026, 3, 2, 0, tzinfo=timezone.utc))

    def test_plan_next_check_in_done_returns_none(self):
        task = SimpleNamespace(status="done")
        self.assertIsNone(plan_next_check_in(task, datetime.now(timezone.utc)))

    def test_mark_escalation_response_logs_event(self):
        async def _run():
            task = SimpleNamespace(
                id="t-1",
                is_escalation=True,
                assigned_to_id="u-1",
                escalation_first_response_at=None,
            )
            logger = AsyncMock()
            await mark_escalation_response(task, "u-1", SimpleNamespace(), logger)
            return task, logger

        task, logger = asyncio.run(_run())
        self.assertIsNotNone(task.escalation_first_response_at)
        logger.assert_awaited_once()

    def test_validate_parent_task_rejects_self_parent(self):
        async def _run():
            with self.assertRaises(HTTPException):
                await validate_parent_task(
                    _FakeDB(),
                    project_id="p-1",
                    task_id="t-1",
                    parent_task_id="t-1",
                )

        asyncio.run(_run())

    def test_validate_parent_task_rejects_cycle(self):
        async def _run():
            db = _FakeDB(scalar_values=["t-1"])
            parent = SimpleNamespace(id="parent", project_id="p-1")
            with patch("app.services.task_lifecycle_service.get_task_by_id", new=AsyncMock(return_value=parent)):
                with self.assertRaises(HTTPException):
                    await validate_parent_task(
                        db,
                        project_id="p-1",
                        task_id="t-1",
                        parent_task_id="parent",
                    )

        asyncio.run(_run())

    def test_rollup_parent_schedule_updates_parent_window(self):
        async def _run():
            parent = SimpleNamespace(
                id="parent",
                start_date=None,
                end_date=None,
                parent_task_id=None,
            )
            db = _FakeDB(one_values=[(datetime(2026, 3, 1).date(), datetime(2026, 3, 5).date())])
            with patch("app.services.task_lifecycle_service.get_task_by_id", new=AsyncMock(side_effect=[parent, None])):
                await rollup_parent_schedule(db, "parent")
            return parent

        parent = asyncio.run(_run())
        self.assertEqual(str(parent.start_date), "2026-03-01")
        self.assertEqual(str(parent.end_date), "2026-03-05")


if __name__ == "__main__":
    unittest.main()
