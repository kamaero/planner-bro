from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.task_route_dependency_service import (
    add_dependency_for_task_editor,
    list_dependencies_for_task_editor,
    remove_dependency_for_task_editor,
)


class _FakeDB:
    def __init__(self):
        self.deleted = []
        self.commits = 0
        self.refreshed = []

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        self.refreshed.append(value)


class TaskRouteDependencyServiceSmokeTest(unittest.TestCase):
    def test_list_add_remove_flows(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-1")
            successor = SimpleNamespace(id="t-2", parent_task_id=None)
            predecessor = SimpleNamespace(id="t-1")
            dep = SimpleNamespace(id="dep-1", dependency_type="FS")
            with (
                patch(
                    "app.services.task_route_dependency_service.get_task_or_404",
                    new=AsyncMock(side_effect=[successor, successor, predecessor, successor]),
                ),
                patch("app.services.task_route_dependency_service._require_task_editor", new=AsyncMock()),
                patch(
                    "app.services.task_route_dependency_service._list_dependencies_for_successor",
                    new=AsyncMock(return_value=[dep]),
                ),
                patch(
                    "app.services.task_route_dependency_service._upsert_dependency",
                    new=AsyncMock(return_value=dep),
                ),
                patch(
                    "app.services.task_route_dependency_service._enforce_dependency_dates_or_autoplan",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.task_route_dependency_service._apply_outgoing_fs_autoplan",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.task_route_dependency_service._rollup_parent_schedule",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.task_route_dependency_service._get_dependency_or_404",
                    new=AsyncMock(return_value=dep),
                ),
            ):
                listed = await list_dependencies_for_task_editor(
                    db,
                    task_id="t-2",
                    actor=actor,
                )
                added = await add_dependency_for_task_editor(
                    db,
                    task_id="t-2",
                    predecessor_task_id="t-1",
                    dependency_type="FS",
                    lag_days=2,
                    actor=actor,
                    log_task_event=AsyncMock(),
                )
                await remove_dependency_for_task_editor(
                    db,
                    task_id="t-2",
                    predecessor_task_id="t-1",
                    actor=actor,
                    log_task_event=AsyncMock(),
                )
                return listed, added, db.commits, len(db.deleted), len(db.refreshed)

        listed, added, commits, deleted, refreshed = asyncio.run(_run())
        self.assertEqual([d.id for d in listed], ["dep-1"])
        self.assertEqual(added.id, "dep-1")
        self.assertEqual(commits, 2)
        self.assertEqual(deleted, 1)
        self.assertEqual(refreshed, 1)


if __name__ == "__main__":
    unittest.main()
