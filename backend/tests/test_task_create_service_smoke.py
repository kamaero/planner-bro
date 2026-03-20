from __future__ import annotations

import asyncio
import unittest

from app.services.task_create_service import (
    apply_default_escalation_assignee,
    split_create_payload,
)


class _ScalarOneOrNone:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDB:
    def __init__(self, owner_id):
        self._owner_id = owner_id

    async def execute(self, _query):
        return _ScalarOneOrNone(self._owner_id)


class TaskCreateServiceSmokeTest(unittest.TestCase):
    def test_split_create_payload_with_assignees(self):
        payload, predecessor_ids, assignee_ids = split_create_payload(
            {
                "title": "Task",
                "predecessor_task_ids": ["a"],
                "assignee_ids": ["u1", "u2"],
            },
            assignee_ids_was_provided=True,
        )
        self.assertEqual(predecessor_ids, ["a"])
        self.assertEqual(assignee_ids, ["u1", "u2"])
        self.assertEqual(payload["assigned_to_id"], "u1")

    def test_split_create_payload_without_assignee_field(self):
        payload, _, assignee_ids = split_create_payload({"title": "Task"}, assignee_ids_was_provided=False)
        self.assertIsNone(assignee_ids)
        self.assertNotIn("assigned_to_id", payload)

    def test_apply_default_escalation_assignee(self):
        async def _run():
            payload = {"is_escalation": True}
            await apply_default_escalation_assignee(
                _FakeDB(owner_id="owner-1"),
                project_id="p-1",
                payload=payload,
            )
            return payload

        payload = asyncio.run(_run())
        self.assertEqual(payload["assigned_to_id"], "owner-1")


if __name__ == "__main__":
    unittest.main()
