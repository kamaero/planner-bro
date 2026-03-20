from __future__ import annotations

import asyncio
import unittest
from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.task_dependency_service import (
    dependency_short_label,
    enforce_dependency_dates_or_autoplan,
    get_dependency_or_404,
    has_dependency_path,
    list_dependencies_for_successor,
    normalize_dependency_type,
    upsert_dependency,
)


class _Result:
    def __init__(self, rows: list[tuple[str]]):
        self._rows = rows

    def all(self) -> list[tuple[str]]:
        return list(self._rows)


class _ScalarResult:
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
    def __init__(self, results: list[_Result]):
        self._results = list(results)
        self.added = []

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("No more fake DB results queued")
        return self._results.pop(0)

    def add(self, value):
        self.added.append(value)


class TaskDependencyServiceSmokeTest(unittest.TestCase):
    def test_dependency_aliases_normalized_and_labeled(self):
        self.assertEqual(normalize_dependency_type("FS"), "finish_to_start")
        self.assertEqual(normalize_dependency_type("ss"), "start_to_start")
        self.assertEqual(dependency_short_label("finish_to_finish"), "FF")

    def test_invalid_dependency_type_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            normalize_dependency_type("banana")
        self.assertEqual(ctx.exception.status_code, 422)

    def test_fs_autoplan_shifts_successor_dates(self):
        predecessor = SimpleNamespace(end_date=date(2026, 3, 20))
        successor = SimpleNamespace(start_date=date(2026, 3, 18), end_date=date(2026, 3, 22))

        asyncio.run(
            enforce_dependency_dates_or_autoplan(
                predecessor,
                successor,
                "finish_to_start",
                2,
                auto_shift_fs=True,
            )
        )

        self.assertEqual(successor.start_date, date(2026, 3, 22))
        self.assertEqual(successor.end_date, date(2026, 3, 26))

    def test_dependency_path_detects_cycle_candidate(self):
        async def _run():
            db = _FakeDB(
                [
                    _Result(rows=[("mid",)]),
                    _Result(rows=[("target",)]),
                ]
            )
            return await has_dependency_path(db, "start", "target")

        self.assertTrue(asyncio.run(_run()))

    def test_upsert_dependency_creates_new_link(self):
        async def _run():
            db = _FakeDB([_Result(rows=[]), _ScalarResult(None)])
            successor = SimpleNamespace(id="s1", project_id="p1")
            predecessor = SimpleNamespace(id="p1", project_id="p1")
            dep = await upsert_dependency(
                db,
                successor=successor,
                predecessor=predecessor,
                actor_id="u1",
                dependency_type="fs",
                lag_days=2,
            )
            return dep, db

        dep, db = asyncio.run(_run())
        self.assertEqual(dep.dependency_type, "finish_to_start")
        self.assertEqual(dep.lag_days, 2)
        self.assertEqual(len(db.added), 1)

    def test_get_dependency_or_404_raises(self):
        async def _run():
            db = _FakeDB([_ScalarResult(None)])
            with self.assertRaises(HTTPException):
                await get_dependency_or_404(
                    db,
                    successor_task_id="s1",
                    predecessor_task_id="p1",
                )

        asyncio.run(_run())

    def test_list_dependencies_for_successor(self):
        async def _run():
            deps = [SimpleNamespace(id="d1"), SimpleNamespace(id="d2")]
            db = _FakeDB([_ScalarsAllResult(deps)])
            return await list_dependencies_for_successor(db, "task-1")

        result = asyncio.run(_run())
        self.assertEqual([dep.id for dep in result], ["d1", "d2"])


if __name__ == "__main__":
    unittest.main()
