from __future__ import annotations

import asyncio
import unittest
from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.task_dependency_service import (
    dependency_short_label,
    enforce_dependency_dates_or_autoplan,
    has_dependency_path,
    normalize_dependency_type,
)


class _Result:
    def __init__(self, rows: list[tuple[str]]):
        self._rows = rows

    def all(self) -> list[tuple[str]]:
        return list(self._rows)


class _FakeDB:
    def __init__(self, results: list[_Result]):
        self._results = list(results)

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("No more fake DB results queued")
        return self._results.pop(0)


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


if __name__ == "__main__":
    unittest.main()
