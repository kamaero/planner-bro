from __future__ import annotations

import re
import unittest
from pathlib import Path

from app.models.project import Project
from app.models.task import Task

ROOT_DIR = Path(__file__).resolve().parents[2]
MOBILE_DIR = ROOT_DIR / "mobile" / "lib"

TASK_CARD_FILE = MOBILE_DIR / "widgets" / "task_card_widget.dart"
PROJECT_CARD_FILE = MOBILE_DIR / "widgets" / "project_card_widget.dart"
DASHBOARD_SCREEN_FILE = MOBILE_DIR / "screens" / "dashboard_screen.dart"
PROJECT_SCREEN_FILE = MOBILE_DIR / "screens" / "project_screen.dart"
ANALYTICS_SCREEN_FILE = MOBILE_DIR / "screens" / "analytics_screen.dart"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _extract_map_keys(text: str, anchor: str) -> list[str]:
    anchor_idx = text.find(anchor)
    if anchor_idx == -1:
        raise AssertionError(f"Cannot find anchor: {anchor}")

    map_start = text.find("{", anchor_idx)
    if map_start == -1:
        raise AssertionError(f"Cannot find map start for anchor: {anchor}")

    depth = 0
    for idx in range(map_start, len(text)):
        ch = text[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                body = text[map_start + 1 : idx]
                return re.findall(r"'([^']+)'\s*:", body)

    raise AssertionError(f"Cannot find map end for anchor: {anchor}")


def _extract_map_keys_in_section(text: str, section_anchor: str, map_anchor: str) -> list[str]:
    section_idx = text.find(section_anchor)
    if section_idx == -1:
        raise AssertionError(f"Cannot find section anchor: {section_anchor}")
    return _extract_map_keys(text[section_idx:], map_anchor)


class MobileDomainDriftSmokeTest(unittest.TestCase):
    def test_task_status_maps_do_not_drift_from_backend(self):
        canonical_task_statuses = set(Task.status.property.columns[0].type.enums)

        task_card_text = _read_text(TASK_CARD_FILE)
        task_card_keys = set(
            _extract_map_keys_in_section(
                task_card_text,
                "class _StatusBadge extends StatelessWidget {",
                "final labels = <String, String>{",
            )
        )

        project_screen_text = _read_text(PROJECT_SCREEN_FILE)
        project_screen_keys = set(_extract_map_keys(project_screen_text, "static const Map<String, String> _statusLabels = {"))

        analytics_text = _read_text(ANALYTICS_SCREEN_FILE)
        analytics_keys = set(_extract_map_keys(analytics_text, "const _statusLabels = <String, String>{"))

        dashboard_text = _read_text(DASHBOARD_SCREEN_FILE)
        dashboard_keys = set(
            _extract_map_keys_in_section(
                dashboard_text,
                "String _statusLabel(String status) {",
                "const labels = {",
            )
        )

        self.assertEqual(task_card_keys, canonical_task_statuses)
        self.assertEqual(project_screen_keys, canonical_task_statuses)
        self.assertEqual(analytics_keys, canonical_task_statuses)
        self.assertEqual(dashboard_keys, canonical_task_statuses)

    def test_project_status_map_do_not_drift_from_backend(self):
        canonical_project_statuses = set(Project.status.property.columns[0].type.enums)

        project_card_text = _read_text(PROJECT_CARD_FILE)
        project_card_keys = set(
            _extract_map_keys_in_section(
                project_card_text,
                "class _StatusChip extends StatelessWidget {",
                "final labels = <String, String>{",
            )
        )

        self.assertEqual(project_card_keys, canonical_project_statuses)

    def test_priority_maps_include_all_canonical_priorities(self):
        canonical_priorities = set(Task.priority.property.columns[0].type.enums)

        task_card_text = _read_text(TASK_CARD_FILE)
        task_card_priority_keys = set(
            _extract_map_keys_in_section(
                task_card_text,
                "class _PriorityDot extends StatelessWidget {",
                "final colors = <String, Color>{",
            )
        )

        dashboard_text = _read_text(DASHBOARD_SCREEN_FILE)
        dashboard_priority_label_keys = set(
            _extract_map_keys_in_section(
                dashboard_text,
                "String _priorityLabel(String priority) {",
                "const labels = {",
            )
        )

        self.assertTrue(canonical_priorities.issubset(task_card_priority_keys))
        self.assertEqual(dashboard_priority_label_keys, canonical_priorities)


if __name__ == "__main__":
    unittest.main()
