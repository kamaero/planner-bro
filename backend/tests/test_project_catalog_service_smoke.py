from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.services.project_catalog_service import (
    create_project_with_owner_member,
    list_projects_for_user,
)


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def all(self):
        return self._value

    def scalar_one(self):
        return self._value


class _FakeDB:
    def __init__(self, values):
        self._values = list(values)
        self.added = []
        self.flushed = 0
        self.committed = 0
        self.refreshed = 0

    async def execute(self, _query):
        if not self._values:
            raise AssertionError("No fake DB values left")
        return _ScalarResult(self._values.pop(0))

    def add(self, value):
        if value.__class__.__name__ == "Project" and not getattr(value, "id", None):
            value.id = "p-new"
        self.added.append(value)

    async def flush(self):
        self.flushed += 1

    async def commit(self):
        self.committed += 1

    async def refresh(self, _value):
        self.refreshed += 1


class ProjectCatalogServiceSmokeTest(unittest.TestCase):
    def test_list_projects_for_admin(self):
        async def _run():
            rows = [SimpleNamespace(id="p-1"), SimpleNamespace(id="p-2")]
            db = _FakeDB([rows])
            actor = SimpleNamespace(id="u-1", role="admin")
            return await list_projects_for_user(db, actor=actor)

        projects = asyncio.run(_run())
        self.assertEqual([p.id for p in projects], ["p-1", "p-2"])

    def test_list_projects_for_scoped_user(self):
        async def _run():
            db = _FakeDB([["p-1"], [], ["p-2"], [], [SimpleNamespace(id="p-1"), SimpleNamespace(id="p-2")]])
            actor = SimpleNamespace(id="u-2", role="member")
            scope = SimpleNamespace(user_ids={"u-2"}, department_ids={"d-1"})
            with patch(
                "app.services.project_catalog_service.get_user_access_scope",
                new=AsyncMock(return_value=scope),
            ):
                return await list_projects_for_user(db, actor=actor)

        projects = asyncio.run(_run())
        self.assertEqual([p.id for p in projects], ["p-1", "p-2"])

    def test_create_project_with_owner_member(self):
        async def _run():
            db = _FakeDB([SimpleNamespace(id="p-new")])
            with (
                patch(
                    "app.services.project_catalog_service.validate_department_ids",
                    new=AsyncMock(return_value=["d-1"]),
                ),
                patch(
                    "app.services.project_catalog_service.sync_project_departments",
                    new=AsyncMock(),
                ),
            ):
                return await create_project_with_owner_member(
                    db,
                    payload={"name": "N", "department_ids": ["d-1"]},
                    owner_id="u-1",
                ), db.flushed, db.committed, db.refreshed

        project, flushed, committed, refreshed = asyncio.run(_run())
        self.assertEqual(project.id, "p-new")
        self.assertEqual(flushed, 1)
        self.assertEqual(committed, 1)
        self.assertEqual(refreshed, 1)

    def test_create_project_launch_basis_guard(self):
        async def _run():
            db = _FakeDB([])
            with patch(
                "app.services.project_catalog_service.validate_department_ids",
                new=AsyncMock(return_value=[]),
            ):
                with self.assertRaises(HTTPException):
                    await create_project_with_owner_member(
                        db,
                        payload={"name": "N", "launch_basis_file_id": "f-1"},
                        owner_id="u-1",
                    )

        asyncio.run(_run())


if __name__ == "__main__":
    unittest.main()
