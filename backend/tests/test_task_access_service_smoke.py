from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.task_access_service import (
    is_own_tasks_only,
    is_task_assignee,
    is_title_only_update,
    require_bulk_permission,
    require_delete_permission,
    require_task_update_access,
    require_task_visibility,
)


class TaskAccessServiceSmokeTest(unittest.TestCase):
    def test_own_tasks_scope_detected_for_non_admin(self):
        user = SimpleNamespace(
            role="developer",
            visibility_scope="own_tasks_only",
            own_tasks_visibility_enabled=True,
        )
        self.assertTrue(is_own_tasks_only(user))

    def test_task_assignee_detects_primary_and_linked_assignees(self):
        task = SimpleNamespace(
            assigned_to_id="u-primary",
            assignee_links=[SimpleNamespace(user_id="u-linked")],
        )
        self.assertTrue(is_task_assignee(task, "u-primary"))
        self.assertTrue(is_task_assignee(task, "u-linked"))
        self.assertFalse(is_task_assignee(task, "u-other"))

    def test_task_visibility_blocks_foreign_task_in_own_tasks_mode(self):
        task = SimpleNamespace(
            assigned_to_id="u-primary",
            assignee_links=[],
        )
        user = SimpleNamespace(
            id="u-other",
            role="developer",
            visibility_scope="own_tasks_only",
            own_tasks_visibility_enabled=True,
        )
        with self.assertRaises(HTTPException) as ctx:
            require_task_visibility(task, user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_bulk_permission_and_delete_permission_guarded(self):
        user = SimpleNamespace(role="developer", can_bulk_edit=False, can_delete=False)
        with self.assertRaises(HTTPException):
            require_bulk_permission(user)
        with self.assertRaises(HTTPException):
            require_delete_permission(user)

    def test_is_title_only_update(self):
        self.assertTrue(is_title_only_update({"title": "x"}, assignee_ids=None, deadline_change_reason=None))
        self.assertFalse(is_title_only_update({"title": "x", "status": "done"}, assignee_ids=None, deadline_change_reason=None))

    def test_require_task_update_access_allows_scope_rename_fallback(self):
        async def _run():
            task = SimpleNamespace(project_id="p1")
            user = SimpleNamespace(id="u1")
            db = SimpleNamespace()
            with patch(
                "app.services.task_access_service.require_task_editor",
                new=AsyncMock(side_effect=HTTPException(status_code=403, detail="Edit access denied")),
            ):
                with patch(
                    "app.services.task_access_service.has_department_level_access",
                    new=AsyncMock(return_value=True),
                ):
                    with patch(
                        "app.services.task_access_service.can_access_project",
                        new=AsyncMock(return_value=True),
                    ):
                        await require_task_update_access(
                            task,
                            user,
                            db,
                            title_only_update=True,
                        )

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
