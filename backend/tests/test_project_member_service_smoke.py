from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.project_member_service import (
    add_project_member,
    remove_project_member,
    update_project_member_role,
)


class _FakeDB:
    def __init__(self):
        self.added = []
        self.deleted = []
        self.commit_calls = 0

    def add(self, value):
        self.added.append(value)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commit_calls += 1


class ProjectMemberServiceSmokeTest(unittest.TestCase):
    def test_add_and_update_member_happy_path(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-admin", role="admin")
            project = SimpleNamespace(name="Test")
            with (
                patch(
                    "app.services.project_member_service.require_project_access",
                    new=AsyncMock(return_value=project),
                ),
                patch(
                    "app.services.project_member_service.get_member",
                    new=AsyncMock(return_value=SimpleNamespace(role="owner")),
                ),
                patch(
                    "app.services.project_member_service.get_member_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(role="member")),
                ),
                patch(
                    "app.services.project_member_service.ensure_member_absent",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.project_member_service.require_assignment_scope_user",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.project_member_service._notify_project_assigned",
                    new=AsyncMock(),
                ) as notify_mock,
            ):
                await add_project_member(
                    db,
                    project_id="p-1",
                    target_user_id="u-1",
                    role="member",
                    actor=actor,
                )
                await update_project_member_role(
                    db,
                    project_id="p-1",
                    target_user_id="u-1",
                    role="manager",
                    actor=actor,
                )
                return db.commit_calls, notify_mock.await_count

        commit_calls, notify_calls = asyncio.run(_run())
        self.assertEqual(commit_calls, 2)
        self.assertEqual(notify_calls, 2)

    def test_remove_member_guards_owner(self):
        async def _run():
            db = _FakeDB()
            actor = SimpleNamespace(id="u-manager", role="manager")
            with (
                patch(
                    "app.services.project_member_service.require_project_access",
                    new=AsyncMock(),
                ),
                patch(
                    "app.services.project_member_service.get_member_or_404",
                    new=AsyncMock(return_value=SimpleNamespace(role="owner")),
                ),
            ):
                with self.assertRaises(HTTPException):
                    await remove_project_member(
                        db,
                        project_id="p-1",
                        target_user_id="u-owner",
                        actor=actor,
                    )

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
