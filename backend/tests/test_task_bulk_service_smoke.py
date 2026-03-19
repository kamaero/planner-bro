from __future__ import annotations

import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.task_bulk_service import (
    apply_bulk_fields,
    normalize_bulk_task_ids,
    parse_bulk_payload,
    validate_bulk_priority,
)


class TaskBulkServiceSmokeTest(unittest.TestCase):
    def test_normalize_bulk_task_ids(self):
        ids = normalize_bulk_task_ids([" t1 ", "t2", "t1", ""])
        self.assertEqual(ids, ["t1", "t2"])

    def test_normalize_bulk_task_ids_requires_non_empty(self):
        with self.assertRaises(HTTPException):
            normalize_bulk_task_ids(["", "   "])

    def test_parse_bulk_payload_delete_rules(self):
        with self.assertRaises(HTTPException):
            parse_bulk_payload({"task_ids": ["t1"], "delete": True, "status": "done"})

        with self.assertRaises(HTTPException):
            parse_bulk_payload({"task_ids": ["t1"]})

    def test_parse_bulk_payload_assignees(self):
        payload, delete_requested, assignee_ids = parse_bulk_payload(
            {"task_ids": ["t1"], "status": "todo", "assignee_ids": ["u1", "u2"]}
        )
        self.assertFalse(delete_requested)
        self.assertEqual(assignee_ids, ["u1", "u2"])
        self.assertEqual(payload["assigned_to_id"], "u1")
        self.assertNotIn("assignee_ids", payload)

    def test_validate_bulk_priority(self):
        validate_bulk_priority({"priority": "high"})
        with self.assertRaises(HTTPException):
            validate_bulk_priority({"priority": "space-cadet"})

    def test_apply_bulk_fields(self):
        task = SimpleNamespace(status="todo", priority="medium")
        changed = apply_bulk_fields(task, {"status": "done", "priority": "high"})
        self.assertTrue(changed)
        self.assertEqual(task.status, "done")
        self.assertEqual(task.priority, "high")

        unchanged = apply_bulk_fields(task, {"status": "done"})
        self.assertFalse(unchanged)


if __name__ == "__main__":
    unittest.main()
