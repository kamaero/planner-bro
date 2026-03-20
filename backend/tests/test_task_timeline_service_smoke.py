from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace

from app.services.task_timeline_service import (
    get_task_comment_with_author,
    list_task_comments,
    list_task_deadline_history,
    list_task_events,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeDB:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _stmt):
        if not self._results:
            raise AssertionError("No fake DB results left")
        return self._results.pop(0)


class TaskTimelineServiceSmokeTest(unittest.TestCase):
    def test_list_task_comments(self):
        async def _run():
            db = _FakeDB([_ScalarResult([SimpleNamespace(id="c1")])])
            return await list_task_comments(db, "t-1")

        rows = asyncio.run(_run())
        self.assertEqual(rows[0].id, "c1")

    def test_get_task_comment_with_author(self):
        async def _run():
            db = _FakeDB([_ScalarResult(SimpleNamespace(id="c2"))])
            return await get_task_comment_with_author(db, "c2")

        row = asyncio.run(_run())
        self.assertEqual(row.id, "c2")

    def test_list_task_events_and_deadline_history(self):
        async def _run():
            db = _FakeDB(
                [
                    _ScalarResult([SimpleNamespace(id="e1")]),
                    _ScalarResult([SimpleNamespace(id="d1")]),
                ]
            )
            events = await list_task_events(db, "t-1")
            history = await list_task_deadline_history(db, "t-1")
            return events, history

        events, history = asyncio.run(_run())
        self.assertEqual(events[0].id, "e1")
        self.assertEqual(history[0].id, "d1")


if __name__ == "__main__":
    unittest.main()
