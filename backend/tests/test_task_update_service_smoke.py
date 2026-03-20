from __future__ import annotations

from datetime import datetime, timezone
import unittest
from types import SimpleNamespace

from app.services.task_update_service import (
    apply_update_status_side_effects,
    apply_escalation_projection_for_update,
    should_validate_predecessors,
    should_revalidate_dependencies,
    split_update_payload,
)


class TaskUpdateServiceSmokeTest(unittest.TestCase):
    def test_split_update_payload(self):
        payload, assignee_ids, predecessor_ids, reason = split_update_payload(
            {
                "title": "New",
                "assignee_ids": ["u-1", "u-2"],
                "predecessor_task_ids": ["t-1"],
                "deadline_change_reason": "shift",
            }
        )
        self.assertEqual(payload["title"], "New")
        self.assertEqual(payload["assigned_to_id"], "u-1")
        self.assertEqual(assignee_ids, ["u-1", "u-2"])
        self.assertEqual(predecessor_ids, ["t-1"])
        self.assertEqual(reason, "shift")

    def test_apply_escalation_projection_for_update(self):
        task = SimpleNamespace(
            is_escalation=False,
            escalation_sla_hours=24,
            escalation_due_at=None,
            escalation_first_response_at=None,
            escalation_overdue_at=None,
            created_at=None,
        )
        payload = {"is_escalation": True}

        def _prepare(projected, _created_at):
            projected["escalation_sla_hours"] = 12

        apply_escalation_projection_for_update(task, payload, prepare_escalation_fields=_prepare)
        self.assertTrue(payload["is_escalation"])
        self.assertEqual(payload["escalation_sla_hours"], 12)

    def test_should_revalidate_dependencies(self):
        self.assertTrue(should_revalidate_dependencies(["a"], {}))
        self.assertTrue(should_revalidate_dependencies(None, {"start_date": "x"}))
        self.assertFalse(should_revalidate_dependencies(None, {"title": "x"}))

    def test_should_validate_predecessors(self):
        self.assertTrue(
            should_validate_predecessors(
                payload={"status": "done"},
                predecessor_task_ids=None,
                old_status="todo",
                new_status="done",
            )
        )
        self.assertTrue(
            should_validate_predecessors(
                payload={},
                predecessor_task_ids=["x"],
                old_status="todo",
                new_status="todo",
            )
        )
        self.assertFalse(
            should_validate_predecessors(
                payload={"title": "x"},
                predecessor_task_ids=None,
                old_status="todo",
                new_status="todo",
            )
        )

    def test_apply_update_status_side_effects(self):
        task = SimpleNamespace(status="done", next_check_in_due_at=datetime.now(timezone.utc))
        apply_update_status_side_effects(
            task,
            old_status="in_progress",
            now=datetime.now(timezone.utc),
            plan_next_check_in=lambda _task, _now: None,
        )
        self.assertIsNone(task.next_check_in_due_at)

        task = SimpleNamespace(status="todo", next_check_in_due_at=None)
        apply_update_status_side_effects(
            task,
            old_status="done",
            now=datetime(2026, 3, 20, tzinfo=timezone.utc),
            plan_next_check_in=lambda _task, now: now,
        )
        self.assertEqual(task.next_check_in_due_at, datetime(2026, 3, 20, tzinfo=timezone.utc))


if __name__ == "__main__":
    unittest.main()
