from __future__ import annotations

import asyncio
import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace

from app.services.project_analytics_service import compute_deadline_stats_summary


class _Result:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeDB:
    def __init__(self, values):
        self._values = list(values)

    async def execute(self, _query):
        if not self._values:
            raise AssertionError("No fake DB values left")
        return _Result(self._values.pop(0))


class ProjectAnalyticsServiceSmokeTest(unittest.TestCase):
    def test_compute_deadline_stats_summary(self):
        async def _run():
            today = date.today()
            changes = [
                SimpleNamespace(
                    entity_type="task",
                    entity_id="t-1",
                    old_date=today - timedelta(days=4),
                    new_date=today + timedelta(days=1),
                    created_at=datetime(2026, 1, 1),
                ),
                SimpleNamespace(
                    entity_type="project",
                    entity_id="p-1",
                    old_date=today - timedelta(days=2),
                    new_date=today + timedelta(days=2),
                    created_at=datetime(2026, 1, 2),
                ),
            ]
            tasks_with_history = [
                SimpleNamespace(id="t-1", title="Task", project_id="p-1", end_date=today + timedelta(days=1))
            ]
            task_project_rows = [("t-1", "p-1")]
            project_rows = [("p-1", "Project One")]
            db = _FakeDB([changes, tasks_with_history, task_project_rows, project_rows])
            return await compute_deadline_stats_summary(db)

        payload = asyncio.run(_run())
        self.assertEqual(payload["total_shifts"], 2)
        self.assertEqual(payload["tasks_with_shifts"], 1)
        self.assertEqual(payload["projects_with_shifts"], 1)
        self.assertEqual(payload["shifts_by_project"][0]["project_id"], "p-1")


if __name__ == "__main__":
    unittest.main()
