from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.task_route_mutation_service import (
    add_task_comment_and_refresh,
    check_in_task_and_refresh,
    delete_task_and_rollup,
    update_task_status_and_refresh,
)


class _FakeDB:
    def __init__(self):
        self.added = []
        self.deleted = []
        self.commits = 0
        self.flushed = 0
        self.refreshed = []

    def add(self, value):
        if value.__class__.__name__ == "TaskComment" and not getattr(value, "id", None):
            value.id = "c-1"
        self.added.append(value)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        self.flushed += 1

    async def refresh(self, value):
        self.refreshed.append(value)


class TaskRouteMutationServiceSmokeTest(unittest.TestCase):
    def test_delete_task_and_rollup(self):
        async def _run():
            db = _FakeDB()
            calls = []

            async def _log(*_args):
                calls.append("log")

            with patch(
                "app.services.task_route_mutation_service._rollup_parent_schedule",
                new=AsyncMock(),
            ) as rollup_mock:
                await delete_task_and_rollup(
                    db,
                    task=SimpleNamespace(id="t-1", parent_task_id="p-1"),
                    actor_id="u-1",
                    log_task_event=_log,
                )
                return calls, rollup_mock.await_count, db.commits, len(db.deleted)

        calls, rollup_count, commits, deleted = asyncio.run(_run())
        self.assertEqual(calls, ["log"])
        self.assertEqual(rollup_count, 1)
        self.assertEqual(commits, 1)
        self.assertEqual(deleted, 1)

    def test_status_checkin_and_comment_flows(self):
        async def _run():
            db = _FakeDB()
            task = SimpleNamespace(id="t-1")

            with (
                patch("app.services.task_route_mutation_service.ensure_predecessors_done", new=AsyncMock()),
                patch("app.services.task_route_mutation_service._apply_status_update", new=AsyncMock()),
                patch("app.services.task_route_mutation_service._notify_task_updated", new=AsyncMock()),
                patch(
                    "app.services.task_route_mutation_service.get_task_with_assignees_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(id="t-1")),
                ),
                patch("app.services.task_route_mutation_service._apply_task_check_in", new=AsyncMock()),
                patch("app.services.task_route_mutation_service._mark_escalation_response", new=AsyncMock()),
                patch(
                    "app.services.task_route_mutation_service._notify_check_in_help_requested",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.task_route_mutation_service._get_task_comment_with_author",
                    new=AsyncMock(return_value=SimpleNamespace(id="c-1")),
                ),
            ):
                refreshed = await update_task_status_and_refresh(
                    db,
                    task=task,
                    data=SimpleNamespace(status="done", progress_percent=100, next_step=None),
                    actor_id="u-1",
                    log_task_event=AsyncMock(),
                )
                checked = await check_in_task_and_refresh(
                    db,
                    task=task,
                    data=SimpleNamespace(
                        summary="ok",
                        blockers="none",
                        need_manager_help=False,
                        next_check_in_due_at=None,
                    ),
                    actor_id="u-1",
                    actor_name="User",
                    log_task_event=AsyncMock(),
                )
                comment = await add_task_comment_and_refresh(
                    db,
                    task=task,
                    task_id="t-1",
                    actor_id="u-1",
                    body="hello",
                    log_task_event=AsyncMock(),
                )
                return refreshed, checked, comment, db.commits

        refreshed, checked, comment, commits = asyncio.run(_run())
        self.assertEqual(refreshed.id, "t-1")
        self.assertEqual(checked.id, "t-1")
        self.assertEqual(comment.id, "c-1")
        self.assertEqual(commits, 3)


if __name__ == "__main__":
    unittest.main()
