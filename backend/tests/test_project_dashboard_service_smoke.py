from __future__ import annotations

import asyncio
import unittest
from datetime import date
from types import SimpleNamespace

from app.services.project_dashboard_service import build_department_dashboard_payload


class _Result:
    def __init__(self, value):
        self._value = value

    def scalars(self):
        return self

    def all(self):
        return self._value


class _FakeDB:
    def __init__(self, values):
        self._values = list(values)

    async def execute(self, _query):
        if not self._values:
            raise AssertionError("No fake DB values left")
        return _Result(self._values.pop(0))


class ProjectDashboardServiceSmokeTest(unittest.TestCase):
    def test_build_department_dashboard_payload(self):
        async def _run():
            departments = [SimpleNamespace(id="d-1", name="Dept", parent_id=None, head_user_id="u-head")]
            users = [("u-head", None, "d-1"), ("u-dev", "u-head", "d-1")]
            projects = [
                SimpleNamespace(id="p-2", name="B", status="active", end_date=date(2026, 1, 2)),
                SimpleNamespace(id="p-1", name="A", status="completed", end_date=date(2026, 1, 1)),
            ]
            members = [("p-1", "u-dev", "member"), ("p-2", "u-dev", "member")]
            manual_links = []
            db = _FakeDB([departments, users, projects, members, manual_links])
            admin = SimpleNamespace(id="u-admin", role="admin")
            return await build_department_dashboard_payload(db, current_user=admin)

        payload = asyncio.run(_run())
        self.assertEqual(len(payload["departments"]), 1)
        section = payload["departments"][0]
        self.assertEqual(section["department_id"], "d-1")
        self.assertEqual([p.id for p in section["projects"]], ["p-2", "p-1"])


if __name__ == "__main__":
    unittest.main()
