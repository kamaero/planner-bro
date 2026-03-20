from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.task_route_bulk_service import apply_bulk_task_update_flow


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeDB:
    def __init__(self, task_rows):
        self._task_rows = task_rows
        self.deleted = []
        self.commits = 0
        self.flushes = 0

    async def execute(self, _query):
        return _ScalarResult(self._task_rows)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        self.flushes += 1


class TaskRouteBulkServiceSmokeTest(unittest.TestCase):
    def test_delete_bulk_flow(self):
        async def _run():
            task = SimpleNamespace(id="t-1", parent_task_id="p-1")
            db = _FakeDB([task])
            with (
                patch("app.services.task_route_bulk_service._require_bulk_permission"),
                patch("app.services.task_route_bulk_service._require_project_exists", new=AsyncMock()),
                patch("app.services.task_route_bulk_service._require_project_manager", new=AsyncMock()),
                patch(
                    "app.services.task_route_bulk_service._normalize_bulk_task_ids",
                    return_value=["t-1"],
                ),
                patch(
                    "app.services.task_route_bulk_service._parse_bulk_payload",
                    return_value=({}, True, None),
                ),
                patch("app.services.task_route_bulk_service._require_delete_permission"),
                patch("app.services.task_route_bulk_service._rollup_parent_schedule", new=AsyncMock()),
            ):
                return await apply_bulk_task_update_flow(
                    db,
                    project_id="p-1",
                    current_user=SimpleNamespace(id="u-1"),
                    data_payload={"task_ids": ["t-1"]},
                    log_task_event=AsyncMock(),
                ), db.commits, len(db.deleted)

        result, commits, deleted = asyncio.run(_run())
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(commits, 1)
        self.assertEqual(deleted, 1)

    def test_update_bulk_flow(self):
        async def _run():
            task = SimpleNamespace(
                id="t-2",
                project_id="p-1",
                parent_task_id=None,
                status="todo",
                assigned_to_id=None,
                progress_percent=0,
                priority="medium",
                control_ski=False,
            )
            db = _FakeDB([task])
            with (
                patch("app.services.task_route_bulk_service._require_bulk_permission"),
                patch("app.services.task_route_bulk_service._require_project_exists", new=AsyncMock()),
                patch("app.services.task_route_bulk_service._require_project_manager", new=AsyncMock()),
                patch(
                    "app.services.task_route_bulk_service._normalize_bulk_task_ids",
                    return_value=["t-2"],
                ),
                patch(
                    "app.services.task_route_bulk_service._parse_bulk_payload",
                    return_value=({"status": "done"}, False, None),
                ),
                patch("app.services.task_route_bulk_service._validate_task_status"),
                patch("app.services.task_route_bulk_service._validate_bulk_priority"),
                patch("app.services.task_route_bulk_service.ensure_predecessors_done", new=AsyncMock()),
                patch("app.services.task_route_bulk_service._apply_bulk_fields", return_value=True),
                patch(
                    "app.services.task_route_bulk_service._apply_bulk_events_and_notifications",
                    new=AsyncMock(),
                ),
                patch("app.services.task_route_bulk_service._mark_escalation_response", new=AsyncMock()),
            ):
                return await apply_bulk_task_update_flow(
                    db,
                    project_id="p-1",
                    current_user=SimpleNamespace(id="u-1"),
                    data_payload={"task_ids": ["t-2"]},
                    log_task_event=AsyncMock(),
                ), db.commits, db.flushes

        result, commits, flushes = asyncio.run(_run())
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["deleted"], 0)
        self.assertEqual(commits, 1)
        self.assertEqual(flushes, 1)


if __name__ == "__main__":
    unittest.main()
