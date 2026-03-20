from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.project_update_service import (
    ensure_project_update_access_or_403,
    is_title_only_project_update,
    validate_project_deadline_change_or_422,
)


class ProjectUpdateServiceSmokeTest(unittest.TestCase):
    def test_is_title_only_project_update(self):
        self.assertTrue(
            is_title_only_project_update(
                {"name": "New"},
                owner_id=None,
                incoming_department_ids=None,
                checklist_payload=None,
                deadline_change_reason=None,
            )
        )
        self.assertFalse(
            is_title_only_project_update(
                {"name": "New", "status": "active"},
                owner_id=None,
                incoming_department_ids=None,
                checklist_payload=None,
                deadline_change_reason=None,
            )
        )

    def test_validate_project_deadline_change_or_422(self):
        validate_project_deadline_change_or_422(
            new_end_date="2026-01-01",
            old_end_date="2026-01-01",
            deadline_change_reason=None,
        )
        with self.assertRaises(HTTPException):
            validate_project_deadline_change_or_422(
                new_end_date="2026-01-02",
                old_end_date="2026-01-01",
                deadline_change_reason=None,
            )

    def test_ensure_project_update_access_or_403(self):
        async def _run():
            actor = SimpleNamespace(id="u-1", role="member")
            with (
                patch(
                    "app.services.project_update_service.has_department_level_access",
                    new=AsyncMock(return_value=False),
                ),
                patch(
                    "app.services.project_update_service.can_access_project",
                    new=AsyncMock(return_value=False),
                ),
            ):
                with self.assertRaises(HTTPException):
                    await ensure_project_update_access_or_403(
                        SimpleNamespace(),
                        actor=actor,
                        project_id="p-1",
                        requester_member=None,
                        title_only_update=False,
                    )

            with (
                patch(
                    "app.services.project_update_service.has_department_level_access",
                    new=AsyncMock(return_value=True),
                ),
                patch(
                    "app.services.project_update_service.can_access_project",
                    new=AsyncMock(return_value=True),
                ),
            ):
                await ensure_project_update_access_or_403(
                    SimpleNamespace(),
                    actor=actor,
                    project_id="p-1",
                    requester_member=None,
                    title_only_update=True,
                )

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
