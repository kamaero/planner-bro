import unittest
from datetime import date
import sys
import types


if "fastapi" not in sys.modules:
    fake_fastapi = types.ModuleType("fastapi")

    class _HTTPException(Exception):
        def __init__(self, status_code: int, detail: str):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    fake_fastapi.HTTPException = _HTTPException  # type: ignore[attr-defined]
    sys.modules["fastapi"] = fake_fastapi

for module_name, attrs in {
    "app.models.deadline_change": {"DeadlineChange": object},
    "app.models.task": {"Task": object},
}.items():
    if module_name not in sys.modules:
        fake_module = types.ModuleType(module_name)
        for key, value in attrs.items():
            setattr(fake_module, key, value)
        sys.modules[module_name] = fake_module

from fastapi import HTTPException
from app.services.task_deadline_service import validate_deadline_reason


class TaskDeadlineReasonValidationTests(unittest.TestCase):
    def test_no_reason_required_when_end_date_not_provided(self):
        validate_deadline_reason(
            old_end_date=date(2026, 4, 30),
            new_end_date=date(2026, 4, 30),
            end_date_was_provided=False,
            projected_status="todo",
            deadline_change_reason=None,
        )

    def test_reason_required_when_end_date_changes(self):
        with self.assertRaises(HTTPException):
            validate_deadline_reason(
                old_end_date=date(2026, 4, 30),
                new_end_date=date(2026, 5, 15),
                end_date_was_provided=True,
                projected_status="todo",
                deadline_change_reason=None,
            )


if __name__ == "__main__":
    unittest.main()
