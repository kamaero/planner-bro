from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.services.project_route_ai_service import (
    approve_ai_draft_flow,
    approve_ai_drafts_bulk_flow,
    reject_ai_draft_flow,
    reject_ai_drafts_bulk_flow,
)


class _FakeDB:
    def __init__(self):
        self.commits = 0
        self.refreshed = []

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        self.refreshed.append(value)


class ProjectRouteAIServiceSmokeTest(unittest.TestCase):
    def test_single_flows(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-1")
            draft = SimpleNamespace(id="d-1")
            with (
                patch("app.services.project_route_ai_service.get_user_candidates", new=AsyncMock(return_value=[])),
                patch("app.services.project_route_ai_service.get_ai_draft_or_404", new=AsyncMock(return_value=draft)),
                patch("app.services.project_route_ai_service.approve_ai_draft_and_archive", new=AsyncMock()),
                patch("app.services.project_route_ai_service.reject_ai_draft_and_archive", new=AsyncMock()),
            ):
                approved = await approve_ai_draft_flow(
                    db,
                    project_id="p-1",
                    draft_id="d-1",
                    actor=actor,
                )
                rejected = await reject_ai_draft_flow(
                    db,
                    project_id="p-1",
                    draft_id="d-1",
                    actor_id=actor.id,
                )
                return approved, rejected, db.commits, len(db.refreshed)

        approved, rejected, commits, refreshed = asyncio.run(_run())
        self.assertEqual(approved.id, "d-1")
        self.assertEqual(rejected.id, "d-1")
        self.assertEqual(commits, 2)
        self.assertEqual(refreshed, 2)

    def test_bulk_flows(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-1")
            with (
                patch("app.services.project_route_ai_service.get_user_candidates", new=AsyncMock(return_value=[])),
                patch(
                    "app.services.project_route_ai_service.approve_ai_drafts_bulk_and_archive",
                    new=AsyncMock(return_value=[SimpleNamespace(id="d-1")]),
                ),
                patch(
                    "app.services.project_route_ai_service.reject_ai_drafts_bulk_and_archive",
                    new=AsyncMock(return_value=[SimpleNamespace(id="d-2")]),
                ),
            ):
                approved = await approve_ai_drafts_bulk_flow(
                    db,
                    project_id="p-1",
                    draft_ids=["d-1"],
                    actor=actor,
                )
                rejected = await reject_ai_drafts_bulk_flow(
                    db,
                    project_id="p-1",
                    draft_ids=["d-2"],
                    actor_id=actor.id,
                )
                return approved, rejected, db.commits

        approved, rejected, commits = asyncio.run(_run())
        self.assertEqual([d.id for d in approved], ["d-1"])
        self.assertEqual([d.id for d in rejected], ["d-2"])
        self.assertEqual(commits, 2)


if __name__ == "__main__":
    unittest.main()
