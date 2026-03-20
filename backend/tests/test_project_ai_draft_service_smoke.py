from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.project_ai_draft_service import (
    approve_ai_draft_and_archive,
    approve_ai_drafts_bulk_and_archive,
    ensure_pending_draft_or_400,
    get_ai_draft_or_404,
    get_user_candidates,
    list_ai_drafts_for_project,
    list_ai_drafts_by_ids,
    list_ai_jobs_for_project,
    reject_ai_draft_and_archive,
    reject_ai_drafts_bulk_and_archive,
    reject_pending_draft,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeDB:
    def __init__(self, values):
        self._values = list(values)

    async def execute(self, _query):
        if not self._values:
            raise AssertionError("No fake DB results left")
        return _ScalarResult(self._values.pop(0))


class ProjectAIDraftServiceSmokeTest(unittest.TestCase):
    def test_get_user_candidates_and_list_by_ids(self):
        async def _run():
            users = [SimpleNamespace(id="u-1"), SimpleNamespace(id="u-2")]
            drafts = [SimpleNamespace(id="d-1"), SimpleNamespace(id="d-2")]
            db = _FakeDB([users, drafts])
            user_rows = await get_user_candidates(db)
            draft_rows = await list_ai_drafts_by_ids(db, project_id="p-1", draft_ids=["d-1", "d-2"])
            return user_rows, draft_rows

        users, drafts = asyncio.run(_run())
        self.assertEqual([u.id for u in users], ["u-1", "u-2"])
        self.assertEqual([d.id for d in drafts], ["d-1", "d-2"])

    def test_list_ai_jobs_and_filtered_drafts(self):
        async def _run():
            jobs = [SimpleNamespace(id="j-1"), SimpleNamespace(id="j-2")]
            drafts = [SimpleNamespace(id="d-3")]
            db = _FakeDB([jobs, drafts])
            job_rows = await list_ai_jobs_for_project(db, project_id="p-1")
            draft_rows = await list_ai_drafts_for_project(
                db,
                project_id="p-1",
                file_id="f-1",
                status_filter="pending",
                limit=20,
                offset=0,
            )
            return job_rows, draft_rows

        jobs, drafts = asyncio.run(_run())
        self.assertEqual([j.id for j in jobs], ["j-1", "j-2"])
        self.assertEqual([d.id for d in drafts], ["d-3"])

    def test_get_ai_draft_or_404(self):
        async def _run():
            db = _FakeDB([SimpleNamespace(id="d-1"), None])
            draft = await get_ai_draft_or_404(db, project_id="p-1", draft_id="d-1")
            with self.assertRaises(HTTPException):
                await get_ai_draft_or_404(db, project_id="p-1", draft_id="missing")
            return draft

        draft = asyncio.run(_run())
        self.assertEqual(draft.id, "d-1")

    def test_reject_pending_draft(self):
        pending = SimpleNamespace(status="pending", approved_by_id=None)
        applied = reject_pending_draft(pending, actor_id="u-1")
        self.assertTrue(applied)
        self.assertEqual(pending.status, "rejected")
        self.assertEqual(pending.approved_by_id, "u-1")

        done = SimpleNamespace(status="approved", approved_by_id=None)
        skipped = reject_pending_draft(done, actor_id="u-1")
        self.assertFalse(skipped)

    def test_ensure_pending_draft_or_400(self):
        ensure_pending_draft_or_400(SimpleNamespace(status="pending"))
        with self.assertRaises(HTTPException):
            ensure_pending_draft_or_400(SimpleNamespace(status="approved"))

    def test_approve_and_reject_single_with_archive(self):
        async def _run():
            db = object()
            actor = SimpleNamespace(id="u-1")
            draft = SimpleNamespace(id="d-1", status="pending", project_file_id="f-1")
            with (
                patch(
                    "app.services.project_ai_draft_service.approve_single_ai_draft",
                    new=AsyncMock(),
                ) as approve_mock,
                patch(
                    "app.services.project_access_service.maybe_archive_processed_file",
                    new=AsyncMock(),
                ) as archive_mock,
            ):
                await approve_ai_draft_and_archive(
                    db,
                    project_id="p-1",
                    draft=draft,
                    actor=actor,
                    user_candidates=[],
                )
                await reject_ai_draft_and_archive(
                    db,
                    project_id="p-1",
                    draft=SimpleNamespace(id="d-2", status="pending", project_file_id="f-2"),
                    actor_id=actor.id,
                )
                return approve_mock.await_count, archive_mock.await_count

        approve_calls, archive_calls = asyncio.run(_run())
        self.assertEqual(approve_calls, 1)
        self.assertEqual(archive_calls, 2)

    def test_bulk_approve_and_reject(self):
        async def _run():
            db = object()
            actor = SimpleNamespace(id="u-7")
            drafts = [
                SimpleNamespace(id="d-1", status="pending", project_file_id="f-1"),
                SimpleNamespace(id="d-2", status="approved", project_file_id="f-1"),
                SimpleNamespace(id="d-3", status="pending", project_file_id="f-3"),
            ]
            with (
                patch(
                    "app.services.project_ai_draft_service.list_ai_drafts_by_ids",
                    new=AsyncMock(return_value=drafts),
                ),
                patch(
                    "app.services.project_ai_draft_service.approve_single_ai_draft",
                    new=AsyncMock(),
                ) as approve_mock,
                patch(
                    "app.services.project_access_service.maybe_archive_processed_file",
                    new=AsyncMock(),
                ) as archive_mock,
            ):
                approved = await approve_ai_drafts_bulk_and_archive(
                    db,
                    project_id="p-1",
                    draft_ids=["d-1", "d-2", "d-3"],
                    actor=actor,
                    user_candidates=[],
                )
                rejected = await reject_ai_drafts_bulk_and_archive(
                    db,
                    project_id="p-1",
                    draft_ids=["d-1", "d-2", "d-3"],
                    actor_id=actor.id,
                )
                return approved, rejected, approve_mock.await_count, archive_mock.await_count

        approved, rejected, approve_calls, archive_calls = asyncio.run(_run())
        self.assertEqual([d.id for d in approved], ["d-1", "d-3"])
        self.assertEqual([d.id for d in rejected], ["d-1", "d-3"])
        self.assertEqual(approve_calls, 2)
        self.assertEqual(archive_calls, 4)


if __name__ == "__main__":
    unittest.main()
