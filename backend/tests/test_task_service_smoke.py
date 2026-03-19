from __future__ import annotations

import asyncio
import unittest
import warnings
from types import SimpleNamespace

from sqlalchemy.exc import SAWarning

warnings.filterwarnings(
    "ignore",
    message=r"relationship 'TaskAssignee\.user' will copy column users\.id",
    category=SAWarning,
)

from app.services.task_service import (
    get_task_with_assignees,
    list_escalations_for_assignee,
)


class _ScalarOneOrNoneResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _ScalarsAllResult:
    def __init__(self, values):
        self._values = values

    def scalars(self):
        return self

    def all(self):
        return self._values


class _FakeDB:
    def __init__(self, results):
        self._results = list(results)

    async def execute(self, _stmt):
        if not self._results:
            raise AssertionError("No fake DB results left")
        return self._results.pop(0)


class TaskServiceSmokeTest(unittest.TestCase):
    def test_get_task_with_assignees(self):
        async def _run():
            task = SimpleNamespace(id="task-1")
            db = _FakeDB([_ScalarOneOrNoneResult(task)])
            return await get_task_with_assignees(db, "task-1")

        result = asyncio.run(_run())
        self.assertIsNotNone(result)
        self.assertEqual(result.id, "task-1")

    def test_list_escalations_for_assignee(self):
        async def _run():
            tasks = [SimpleNamespace(id="e1"), SimpleNamespace(id="e2")]
            db = _FakeDB([_ScalarsAllResult(tasks)])
            return await list_escalations_for_assignee(db, "u-1")

        result = asyncio.run(_run())
        self.assertEqual([task.id for task in result], ["e1", "e2"])


if __name__ == "__main__":
    unittest.main()
