from __future__ import annotations

import asyncio
import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.task_mutation_service import (
    apply_status_update,
    apply_task_check_in,
    validate_task_status,
)


class _FakeDB:
    def __init__(self):
        self.added = []
        self.flush_count = 0

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        self.flush_count += 1


class TaskMutationServiceSmokeTest(unittest.TestCase):
    def test_validate_task_status_rejects_unknown(self):
        with self.assertRaises(HTTPException):
            validate_task_status("wizard_mode")

    def test_apply_status_update_sets_core_fields_and_logs(self):
        async def _run():
            db = _FakeDB()
            task = SimpleNamespace(
                id="t-1",
                project_id="p-1",
                parent_task_id=None,
                title="Task",
                description=None,
                status="todo",
                priority="medium",
                control_ski=False,
                progress_percent=10,
                next_step=None,
                start_date=None,
                end_date=None,
                assigned_to_id="u-1",
                is_escalation=False,
                escalation_for=None,
                repeat_every_days=None,
                estimated_hours=None,
            )
            logger = AsyncMock()
            now = datetime(2026, 3, 20, 10, tzinfo=timezone.utc)

            await apply_status_update(
                db,
                task=task,
                actor_id="u-2",
                status="done",
                progress_percent=None,
                next_step="  ship it  ",
                now=now,
                plan_next_check_in=lambda current, current_now: None if current.status == "done" else current_now,
                log_task_event=logger,
            )
            return task, logger

        task, logger = asyncio.run(_run())
        self.assertEqual(task.status, "done")
        self.assertEqual(task.progress_percent, 100)
        self.assertEqual(task.next_step, "ship it")
        self.assertIsNotNone(task.last_check_in_at)
        self.assertEqual(task.last_check_in_note, "Статус обновлен")
        self.assertIsNone(task.next_check_in_due_at)
        self.assertGreaterEqual(logger.await_count, 2)

    def test_apply_status_update_creates_recurrence_task(self):
        async def _run():
            class FakeTask:
                def __init__(self, **kwargs):
                    self.__dict__.update(kwargs)
                    self.id = kwargs.get("id", "generated-task")

            db = _FakeDB()
            task = SimpleNamespace(
                id="t-2",
                project_id="p-1",
                parent_task_id="parent-1",
                title="Recurring",
                description="desc",
                status="in_progress",
                priority="high",
                control_ski=True,
                progress_percent=50,
                next_step=None,
                start_date=date(2026, 3, 1),
                end_date=date(2026, 3, 2),
                assigned_to_id="u-1",
                is_escalation=True,
                escalation_for="x",
                repeat_every_days=7,
                estimated_hours=3,
            )
            logger = AsyncMock()
            now = datetime(2026, 3, 20, 11, tzinfo=timezone.utc)
            with patch("app.services.task_mutation_service.Task", FakeTask):
                await apply_status_update(
                    db,
                    task=task,
                    actor_id="u-2",
                    status="done",
                    progress_percent=100,
                    next_step=None,
                    now=now,
                    plan_next_check_in=lambda _task, _now: None,
                    log_task_event=logger,
                )
            return db, FakeTask

        db, fake_task_cls = asyncio.run(_run())
        recurrence_tasks = [item for item in db.added if isinstance(item, fake_task_cls)]
        self.assertEqual(len(recurrence_tasks), 1)
        self.assertEqual(recurrence_tasks[0].start_date, date(2026, 3, 8))
        self.assertEqual(recurrence_tasks[0].end_date, date(2026, 3, 9))
        self.assertGreaterEqual(db.flush_count, 1)

    def test_apply_task_check_in_creates_comment_and_sets_due(self):
        async def _run():
            class FakeTaskComment:
                def __init__(self, **kwargs):
                    self.__dict__.update(kwargs)

            db = _FakeDB()
            task = SimpleNamespace(
                id="t-3",
                status="in_progress",
                next_check_in_due_at=None,
            )
            logger = AsyncMock()
            now = datetime(2026, 3, 20, 12, tzinfo=timezone.utc)
            with patch("app.services.task_mutation_service.TaskComment", FakeTaskComment):
                await apply_task_check_in(
                    db,
                    task=task,
                    actor_id="u-3",
                    summary="Finished API slice",
                    blockers="Need QA",
                    need_manager_help=True,
                    next_check_in_due_at=None,
                    now=now,
                    plan_next_check_in=lambda _task, base: base + timedelta(hours=4),
                    log_task_event=logger,
                )
            return task, db, logger, FakeTaskComment

        task, db, logger, fake_comment_cls = asyncio.run(_run())
        self.assertEqual(task.last_check_in_note, "Finished API slice")
        self.assertEqual(task.next_check_in_due_at, datetime(2026, 3, 20, 16, tzinfo=timezone.utc))
        comments = [item for item in db.added if isinstance(item, fake_comment_cls)]
        self.assertEqual(len(comments), 1)
        self.assertIn("Manager help requested: yes", comments[0].body)
        logger.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
