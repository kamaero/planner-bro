from __future__ import annotations

import unittest
from types import SimpleNamespace

from fastapi import HTTPException

from app.services.project_rules_service import (
    apply_control_ski,
    collect_assignee_hints,
    ensure_project_completion_allowed,
    extract_task_number,
    fio_short,
    fio_short_from_parts,
    match_assignee_ids,
    normalize_checklist,
)


class ProjectRulesServiceSmokeTest(unittest.TestCase):
    def test_extract_task_number(self):
        self.assertEqual(extract_task_number("12.3 Подготовить отчёт"), "12.3")
        self.assertIsNone(extract_task_number("Без номера"))

    def test_collect_assignee_hints_deduplicates_values(self):
        hints = collect_assignee_hints(
            "Иванов И.И.",
            {"assignee_hints": ["Иванов И.И.", "  ivan@example.com  ", "ivan@example.com"]},
        )
        self.assertEqual(hints, ["Иванов И.И.", "ivan@example.com"])

    def test_match_assignee_ids_matches_email_and_short_name(self):
        users = [
            SimpleNamespace(
                id="u-1",
                email="ivan@example.com",
                work_email="",
                name="Иванов Иван Иванович",
                last_name="Иванов",
                first_name="Иван",
                middle_name="Иванович",
            ),
            SimpleNamespace(
                id="u-2",
                email="petrov@example.com",
                work_email="p.petrov@work.local",
                name="Петров Пётр Петрович",
                last_name="Петров",
                first_name="Пётр",
                middle_name="Петрович",
            ),
        ]
        matched = match_assignee_ids(["ivan@example.com", "петров п.п."], users)
        self.assertEqual(matched, ["u-1", "u-2"])

    def test_short_name_helpers(self):
        self.assertEqual(fio_short("Петров Пётр Петрович"), "петров п.п.")
        self.assertEqual(fio_short_from_parts("Петров", "Пётр", "Петрович"), "петров п.п.")

    def test_normalize_checklist_filters_invalid_rows(self):
        checklist = normalize_checklist(
            [
                {"id": "done", "label": "Готово", "done": True},
                {"id": "", "label": "Пустой id"},
                {"id": "no-label", "label": ""},
            ]
        )
        self.assertEqual(checklist, [{"id": "done", "label": "Готово", "done": True}])

    def test_completion_checklist_must_be_fully_done(self):
        with self.assertRaises(HTTPException):
            ensure_project_completion_allowed([])

        with self.assertRaises(HTTPException):
            ensure_project_completion_allowed([{"id": "a", "label": "A", "done": False}])

        ensure_project_completion_allowed([{"id": "a", "label": "A", "done": True}])

    def test_apply_control_ski_promotes_priority(self):
        payload = {"priority": "low", "control_ski": True}
        apply_control_ski(payload)
        self.assertEqual(payload["priority"], "critical")
        self.assertTrue(payload["control_ski"])

        payload = {"priority": "critical", "control_ski": False}
        apply_control_ski(payload)
        self.assertEqual(payload["priority"], "medium")
        self.assertFalse(payload["control_ski"])


if __name__ == "__main__":
    unittest.main()
