from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.project_access_service import (
    ensure_add_member_role_allowed,
    ensure_manager_assignment_allowed,
    ensure_member_absent,
    ensure_update_member_role_allowed,
    list_project_deadline_history,
    list_project_files,
    list_project_members,
    get_member_or_404,
    get_project_file_or_404,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        if self._value is None:
            return []
        if isinstance(self._value, list):
            return self._value
        return [self._value]


class _FakeDB:
    def __init__(self, values):
        self._values = list(values)

    async def execute(self, _query):
        if not self._values:
            raise AssertionError("No fake DB results left")
        return _ScalarResult(self._values.pop(0))


class ProjectAccessServiceSmokeTest(unittest.TestCase):
    def test_list_helpers_return_ordered_values(self):
        async def _run():
            member_rows = [SimpleNamespace(user_id="u-1"), SimpleNamespace(user_id="u-2")]
            file_rows = [SimpleNamespace(id="f-1")]
            history_rows = [SimpleNamespace(id="h-2"), SimpleNamespace(id="h-1")]
            db = _FakeDB([member_rows, file_rows, history_rows])
            members = await list_project_members(db, project_id="p-1")
            files = await list_project_files(db, project_id="p-1")
            history = await list_project_deadline_history(db, project_id="p-1")
            return members, files, history

        members, files, history = asyncio.run(_run())
        self.assertEqual([m.user_id for m in members], ["u-1", "u-2"])
        self.assertEqual([f.id for f in files], ["f-1"])
        self.assertEqual([h.id for h in history], ["h-2", "h-1"])

    def test_get_project_file_or_404_returns_record(self):
        async def _run():
            record = SimpleNamespace(id="f-1", project_id="p-1")
            db = _FakeDB([record])
            return await get_project_file_or_404(db, project_id="p-1", file_id="f-1")

        result = asyncio.run(_run())
        self.assertEqual(result.id, "f-1")

    def test_get_project_file_or_404_raises_for_missing(self):
        async def _run():
            db = _FakeDB([None])
            with self.assertRaises(HTTPException):
                await get_project_file_or_404(db, project_id="p-1", file_id="f-404")

        asyncio.run(_run())

    def test_get_member_or_404_and_absent_guard(self):
        async def _run():
            db = _FakeDB([SimpleNamespace(user_id="u-1"), None, SimpleNamespace(user_id="u-2")])
            member = await get_member_or_404("p-1", "u-1", db)
            with self.assertRaises(HTTPException):
                await get_member_or_404("p-1", "u-x", db)
            with self.assertRaises(HTTPException):
                await ensure_member_absent("p-1", "u-2", db)
            return member

        member = asyncio.run(_run())
        self.assertEqual(member.user_id, "u-1")

    def test_member_role_guards(self):
        with self.assertRaises(HTTPException):
            ensure_add_member_role_allowed("owner")
        ensure_add_member_role_allowed("member")

        with self.assertRaises(HTTPException):
            ensure_update_member_role_allowed("owner", "member")
        with self.assertRaises(HTTPException):
            ensure_update_member_role_allowed("member", "captain")
        ensure_update_member_role_allowed("member", "manager")

        with self.assertRaises(HTTPException):
            ensure_manager_assignment_allowed(
                "manager",
                current_user_role="developer",
                requester_member=SimpleNamespace(role="member"),
            )
        ensure_manager_assignment_allowed(
            "manager",
            current_user_role="admin",
            requester_member=None,
        )


if __name__ == "__main__":
    unittest.main()
