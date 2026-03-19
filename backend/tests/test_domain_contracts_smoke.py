from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.models.project import Project
from app.models.task import Task
from app.models.user import User
from app.services import events as backend_events

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_EVENTS_FILE = ROOT_DIR / "frontend" / "src" / "api" / "events.ts"
FRONTEND_DOMAIN_META_FILE = ROOT_DIR / "frontend" / "src" / "lib" / "domainMeta.ts"

EXPECTED_PROJECT_STATUSES = ["planning", "tz", "active", "testing", "on_hold", "completed"]
EXPECTED_TASK_STATUSES = ["planning", "tz", "todo", "in_progress", "testing", "review", "done"]
EXPECTED_PRIORITIES = ["low", "medium", "high", "critical"]
EXPECTED_ROLES = ["admin", "manager", "developer"]
EXPECTED_VISIBILITY_SCOPES = ["own_tasks_only", "department_scope", "full_scope"]
EXPECTED_PERMISSIONS = ["can_delete", "can_import", "can_bulk_edit", "can_manage_team"]



def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")



def _extract_object_body(text: str, const_name: str) -> str:
    marker = f"export const {const_name}"
    start = text.find(marker)
    if start == -1:
        raise AssertionError(f"Cannot find const {const_name}")

    brace_start = text.find("{", start)
    if brace_start == -1:
        raise AssertionError(f"Cannot find opening brace for {const_name}")

    depth = 0
    for idx in range(brace_start, len(text)):
        ch = text[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[brace_start + 1 : idx]

    raise AssertionError(f"Cannot find closing brace for {const_name}")



def _extract_object_keys(text: str, const_name: str) -> list[str]:
    body = _extract_object_body(text, const_name)
    return re.findall(r"^\s*([A-Za-z0-9_]+)\s*:", body, flags=re.MULTILINE)



def _extract_object_string_values(text: str, const_name: str) -> list[str]:
    body = _extract_object_body(text, const_name)
    return re.findall(r":\s*'([^']+)'", body)


class DomainContractsSmokeTest(unittest.TestCase):
    def test_project_statuses_synced_backend_and_frontend(self):
        backend_statuses = list(Project.status.property.columns[0].type.enums)
        self.assertEqual(backend_statuses, EXPECTED_PROJECT_STATUSES)

        domain_meta = _read_text(FRONTEND_DOMAIN_META_FILE)
        frontend_status_keys = _extract_object_keys(domain_meta, "PROJECT_STATUS_LABELS")
        self.assertEqual(frontend_status_keys, EXPECTED_PROJECT_STATUSES)

    def test_task_statuses_synced_backend_and_frontend(self):
        backend_statuses = list(Task.status.property.columns[0].type.enums)
        self.assertEqual(backend_statuses, EXPECTED_TASK_STATUSES)

        domain_meta = _read_text(FRONTEND_DOMAIN_META_FILE)
        frontend_label_keys = _extract_object_keys(domain_meta, "TASK_STATUS_LABELS")
        frontend_order_keys = _extract_object_keys(domain_meta, "TASK_STATUS_ORDER")
        self.assertEqual(frontend_label_keys, EXPECTED_TASK_STATUSES)
        self.assertEqual(frontend_order_keys, EXPECTED_TASK_STATUSES)

    def test_priorities_synced_backend_and_frontend(self):
        project_priorities = list(Project.priority.property.columns[0].type.enums)
        task_priorities = list(Task.priority.property.columns[0].type.enums)
        self.assertEqual(project_priorities, EXPECTED_PRIORITIES)
        self.assertEqual(task_priorities, EXPECTED_PRIORITIES)

        domain_meta = _read_text(FRONTEND_DOMAIN_META_FILE)
        frontend_label_keys = _extract_object_keys(domain_meta, "TASK_PRIORITY_LABELS")
        frontend_order_keys = _extract_object_keys(domain_meta, "TASK_PRIORITY_ORDER")
        self.assertEqual(frontend_label_keys, EXPECTED_PRIORITIES)
        self.assertEqual(sorted(frontend_order_keys), sorted(EXPECTED_PRIORITIES))

    def test_roles_visibility_and_permissions_are_canonical(self):
        role_values = list(User.role.property.columns[0].type.enums)
        visibility_values = list(User.visibility_scope.property.columns[0].type.enums)
        self.assertEqual(role_values, EXPECTED_ROLES)
        self.assertEqual(visibility_values, EXPECTED_VISIBILITY_SCOPES)

        user_columns = User.__table__.columns.keys()
        for permission in EXPECTED_PERMISSIONS:
            self.assertIn(permission, user_columns)

    def test_realtime_event_constants_synced_backend_and_frontend(self):
        backend_event_values = {
            value
            for name, value in vars(backend_events).items()
            if name.isupper() and isinstance(value, str)
        }

        frontend_events = _read_text(FRONTEND_EVENTS_FILE)
        frontend_event_values = set(_extract_object_string_values(frontend_events, "WS_EVENTS"))

        self.assertEqual(frontend_event_values, backend_event_values)


if __name__ == "__main__":
    unittest.main()
