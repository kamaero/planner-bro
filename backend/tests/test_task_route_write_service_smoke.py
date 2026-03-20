from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.task_route_write_service import (
    create_task_from_payload,
    update_task_from_payload,
)


class _FakeDB:
    def __init__(self):
        self.added = []
        self.flushes = 0
        self.commits = 0
        self.refreshed = 0

    def add(self, value):
        if value.__class__.__name__ == "Task" and not getattr(value, "id", None):
            value.id = "t-1"
        self.added.append(value)

    async def flush(self):
        self.flushes += 1

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        self.refreshed += 1


class TaskRouteWriteServiceSmokeTest(unittest.TestCase):
    def test_create_task_from_payload(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-1")
            with (
                patch("app.services.task_route_write_service._require_project_member", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service._split_create_payload",
                    return_value=({"title": "T", "status": "todo"}, [], None),
                ),
                patch("app.services.task_route_write_service._apply_default_escalation_assignee", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service._get_project_settings",
                    new=AsyncMock(return_value=SimpleNamespace()),
                ),
                patch("app.services.task_route_write_service._validate_parent_task", new=AsyncMock()),
                patch("app.services.task_route_write_service.validate_strict_past_dates"),
                patch("app.services.task_route_write_service.validate_child_dates_within_parent"),
                patch("app.services.task_route_write_service._sync_task_predecessors", new=AsyncMock()),
                patch("app.services.task_route_write_service._validate_incoming_dependency_rules", new=AsyncMock()),
                patch("app.services.task_route_write_service.ensure_predecessors_done", new=AsyncMock()),
                patch("app.services.task_route_write_service._rollup_parent_schedule", new=AsyncMock()),
                patch("app.services.task_route_write_service._apply_outgoing_fs_autoplan", new=AsyncMock()),
                patch("app.services.task_route_write_service._notify_task_created", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service.get_task_with_assignees_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(id="t-1")),
                ),
            ):
                return await create_task_from_payload(
                    db,
                    project_id="p-1",
                    payload={"title": "T"},
                    assignee_ids_was_provided=False,
                    actor=actor,
                    log_task_event=AsyncMock(),
                ), db.commits

        result, commits = asyncio.run(_run())
        self.assertEqual(result.id, "t-1")
        self.assertEqual(commits, 1)

    def test_update_task_from_payload(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-1")
            task = SimpleNamespace(
                id="t-2",
                project_id="p-1",
                assigned_to_id=None,
                status="todo",
                start_date=None,
                end_date=None,
                parent_task_id=None,
                priority="medium",
                control_ski=False,
            )
            with (
                patch("app.services.task_route_write_service.get_task_or_404", new=AsyncMock(return_value=task)),
                patch(
                    "app.services.task_route_write_service._split_update_payload",
                    return_value=({}, None, None, None),
                ),
                patch("app.services.task_route_write_service._require_task_update_access", new=AsyncMock()),
                patch("app.services.task_route_write_service._validate_parent_task", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service._get_project_settings",
                    new=AsyncMock(return_value=SimpleNamespace()),
                ),
                patch("app.services.task_route_write_service._sync_task_predecessors", new=AsyncMock()),
                patch("app.services.task_route_write_service._record_deadline_change_and_date_events", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service._apply_update_events_and_assignee_notifications",
                    new=AsyncMock(),
                ),
                patch("app.services.task_route_write_service._mark_escalation_response", new=AsyncMock()),
                patch("app.services.task_route_write_service._notify_task_updated", new=AsyncMock()),
                patch(
                    "app.services.task_route_write_service.get_task_with_assignees_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(id="t-2")),
                ),
            ):
                return await update_task_from_payload(
                    db,
                    task_id="t-2",
                    payload={},
                    actor=actor,
                    log_task_event=AsyncMock(),
                ), db.commits

        result, commits = asyncio.run(_run())
        self.assertEqual(result.id, "t-2")
        self.assertEqual(commits, 1)


if __name__ == "__main__":
    unittest.main()
