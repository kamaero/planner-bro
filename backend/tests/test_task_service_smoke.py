from __future__ import annotations

import asyncio
import unittest
import warnings
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy.exc import SAWarning

warnings.filterwarnings(
    "ignore",
    message=r"relationship 'TaskAssignee\.user' will copy column users\.id",
    category=SAWarning,
)

from app.services.task_service import (
    get_task_or_404,
    get_tasks_for_user,
    get_task_with_assignees,
    get_task_with_assignees_or_404,
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

    def test_get_task_or_404_raises(self):
        async def _run():
            db = _FakeDB([_ScalarOneOrNoneResult(None)])
            with self.assertRaises(HTTPException):
                await get_task_or_404(db, "missing")

        asyncio.run(_run())

    def test_get_task_with_assignees_or_404_returns_task(self):
        async def _run():
            task = SimpleNamespace(id="task-2")
            db = _FakeDB([_ScalarOneOrNoneResult(task)])
            return await get_task_with_assignees_or_404(db, "task-2")

        result = asyncio.run(_run())
        self.assertEqual(result.id, "task-2")

    def test_list_escalations_for_assignee(self):
        async def _run():
            tasks = [SimpleNamespace(id="e1"), SimpleNamespace(id="e2")]
            db = _FakeDB([_ScalarsAllResult(tasks)])
            return await list_escalations_for_assignee(db, "u-1")

        result = asyncio.run(_run())
        self.assertEqual([task.id for task in result], ["e1", "e2"])

    def test_get_tasks_for_user(self):
        async def _run():
            tasks = [SimpleNamespace(id="t1"), SimpleNamespace(id="t2")]
            db = _FakeDB([_ScalarsAllResult(tasks)])
            return await get_tasks_for_user(db, "u-1")

        result = asyncio.run(_run())
        self.assertEqual([task.id for task in result], ["t1", "t2"])


if __name__ == "__main__":
    unittest.main()
