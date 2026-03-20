from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.project_import_service import import_tasks_from_ms_project_content


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _DeleteResult:
    def __init__(self, rowcount: int):
        self.rowcount = rowcount


class _FakeDB:
    def __init__(self, execute_values):
        self._execute_values = list(execute_values)
        self.added = []
        self.commit_calls = 0
        self._task_seq = 0

    def add(self, value):
        self.added.append(value)

    async def execute(self, _query):
        if not self._execute_values:
            raise AssertionError("No fake DB values left")
        value = self._execute_values.pop(0)
        if isinstance(value, _DeleteResult):
            return value
        return _ScalarResult(value)

    async def flush(self):
        for row in self.added:
            if row.__class__.__name__ == "Task" and getattr(row, "id", None) is None:
                self._task_seq += 1
                row.id = f"t-{self._task_seq}"

    async def commit(self):
        self.commit_calls += 1


class ProjectImportServiceSmokeTest(unittest.TestCase):
    def test_parse_error_maps_to_http_400(self):
        async def _run():
            db = _FakeDB([])
            with (
                patch(
                    "app.services.project_import_service.parse_ms_project_content",
                    side_effect=ValueError("bad file"),
                ),
                patch("app.services.project_import_service.log_system_activity", new=AsyncMock()),
            ):
                with self.assertRaises(HTTPException):
                    await import_tasks_from_ms_project_content(
                        db,
                        project_id="p-1",
                        filename="bad.mpp",
                        content=b"x",
                        replace_existing=False,
                        actor_id="u-1",
                    )

        asyncio.run(_run())

    def test_empty_parse_result(self):
        async def _run():
            db = _FakeDB([])
            parsed = SimpleNamespace(tasks=[], skipped_count=2)
            with patch(
                "app.services.project_import_service.parse_ms_project_content",
                return_value=parsed,
            ):
                return await import_tasks_from_ms_project_content(
                    db,
                    project_id="p-1",
                    filename="empty.mpp",
                    content=b"x",
                    replace_existing=False,
                    actor_id="u-1",
                )

        result = asyncio.run(_run())
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["skipped"], 2)

    def test_happy_path_creates_tasks(self):
        async def _run():
            user_rows = [
                SimpleNamespace(
                    id="u-a",
                    is_active=True,
                    email="a@a",
                    work_email=None,
                    name="A",
                    first_name="A",
                    last_name="B",
                    middle_name=None,
                )
            ]
            db = _FakeDB([user_rows])
            item = SimpleNamespace(
                uid="u-1",
                title="Plan",
                outline_number="1",
                progress_percent=0,
                priority="medium",
                start_date=None,
                end_date=None,
                estimated_hours=3,
                assignee_hints=[],
                assignee_hint=None,
                description=None,
                parent_uid=None,
            )
            parsed = SimpleNamespace(tasks=[item], skipped_count=0)
            with (
                patch("app.services.project_import_service.parse_ms_project_content", return_value=parsed),
                patch("app.services.project_import_service.sync_task_assignees_for_project", new=AsyncMock()),
                patch("app.services.project_import_service.upsert_temp_assignees", new=AsyncMock()),
                patch("app.services.project_import_service.log_system_activity", new=AsyncMock()),
            ):
                return await import_tasks_from_ms_project_content(
                    db,
                    project_id="p-1",
                    filename="ok.mpp",
                    content=b"x",
                    replace_existing=False,
                    actor_id="u-1",
                ), db.commit_calls

        result, commit_calls = asyncio.run(_run())
        self.assertEqual(result["created"], 1)
        self.assertEqual(result["total_in_file"], 1)
        self.assertEqual(commit_calls, 1)


if __name__ == "__main__":
    unittest.main()
