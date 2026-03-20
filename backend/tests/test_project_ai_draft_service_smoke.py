from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.project_ai_draft_service import (
    get_ai_draft_or_404,
    get_user_candidates,
    list_ai_drafts_by_ids,
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


if __name__ == "__main__":
    unittest.main()
