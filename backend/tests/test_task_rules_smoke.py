from __future__ import annotations

import asyncio
import unittest
from datetime import date, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.task_rules_service import (
    ensure_predecessors_done,
    validate_child_dates_within_parent,
    validate_strict_past_dates,
)


class _ScalarResult:
    def __init__(self, values: list[str]):
        self._values = values

    def all(self) -> list[str]:
        return list(self._values)


class _Result:
    def __init__(self, rows: list[tuple[str]] | None = None, scalars: list[str] | None = None):
        self._rows = rows or []
        self._scalars = scalars or []

    def all(self) -> list[tuple[str]]:
        return list(self._rows)

    def scalars(self) -> _ScalarResult:
        return _ScalarResult(self._scalars)


class _FakeDB:
    def __init__(self, results: list[_Result]):
        self._results = list(results)

    async def execute(self, _query):
        if not self._results:
            raise AssertionError("No more fake DB results queued")
        return self._results.pop(0)


class TaskRulesSmokeTest(unittest.TestCase):
    def test_strict_mode_blocks_past_start_date(self):
        project = SimpleNamespace(
            planning_mode="strict",
            strict_no_past_start_date=True,
            strict_no_past_end_date=False,
        )
        with self.assertRaises(HTTPException) as ctx:
            validate_strict_past_dates(
                project,
                start_date=date.today() - timedelta(days=1),
                end_date=None,
            )
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("дата начала", str(ctx.exception.detail).lower())

    def test_strict_mode_blocks_child_out_of_parent_dates(self):
        project = SimpleNamespace(planning_mode="strict", strict_child_within_parent_dates=True)
        parent = SimpleNamespace(
            start_date=date(2026, 3, 10),
            end_date=date(2026, 3, 20),
        )
        with self.assertRaises(HTTPException) as ctx:
            validate_child_dates_within_parent(
                project,
                parent=parent,
                start_date=date(2026, 3, 11),
                end_date=date(2026, 3, 21),
            )
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("дедлайн", str(ctx.exception.detail).lower())

    def test_dependency_blocks_in_progress_until_predecessors_done(self):
        async def _run():
            task = SimpleNamespace(id="t-successor")
            db = _FakeDB(
                [
                    _Result(rows=[("t-a",), ("t-b",)]),
                    _Result(scalars=["Task A"]),
                ]
            )
            with self.assertRaises(HTTPException) as ctx:
                await ensure_predecessors_done(task, "in_progress", db)
            return ctx.exception

        exc = asyncio.run(_run())
        self.assertEqual(exc.status_code, 409)
        self.assertIn("зависимост", str(exc.detail).lower())


if __name__ == "__main__":
    unittest.main()
