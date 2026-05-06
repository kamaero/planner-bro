import unittest
from dataclasses import dataclass
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

if "sqlalchemy" not in sys.modules:
    fake_sqlalchemy = types.ModuleType("sqlalchemy")
    fake_sqlalchemy.select = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    sys.modules["sqlalchemy"] = fake_sqlalchemy

if "sqlalchemy.ext.asyncio" not in sys.modules:
    fake_asyncio = types.ModuleType("sqlalchemy.ext.asyncio")
    fake_asyncio.AsyncSession = object  # type: ignore[attr-defined]
    sys.modules["sqlalchemy.ext.asyncio"] = fake_asyncio

if "sqlalchemy.orm" not in sys.modules:
    fake_orm = types.ModuleType("sqlalchemy.orm")
    fake_orm.selectinload = lambda *args, **kwargs: None  # type: ignore[attr-defined]
    sys.modules["sqlalchemy.orm"] = fake_orm

for module_name, attrs in {
    "app.models.ai": {"AIIngestionJob": object, "AITaskDraft": object},
    "app.models.deadline_change": {"DeadlineChange": object},
    "app.models.task": {"Task": object, "TaskAssignee": object, "TaskComment": object, "TaskEvent": object},
    "app.models.user": {"User": object},
    "app.models.project": {"ProjectMember": object},
    "app.services.temp_assignee_service": {"upsert_temp_assignees": lambda *args, **kwargs: None},
}.items():
    if module_name not in sys.modules:
        fake_module = types.ModuleType(module_name)
        for key, value in attrs.items():
            setattr(fake_module, key, value)
        sys.modules[module_name] = fake_module

from app.services.project_ai_draft_service import _find_rollover_candidate


@dataclass
class FakeTask:
    title: str
    description: str | None = None


class RolloverMatchingTests(unittest.TestCase):
    def test_rollover_matches_by_description_when_task_no_missing(self):
        existing = [
            FakeTask(
                title="8. Разработать функционал авансирования",
                description='Разработать "функционал" авансирования по заявкам ППО.',
            ),
            FakeTask(
                title="9. Другая задача",
                description="Совсем другой текст задачи",
            ),
        ]

        matched = _find_rollover_candidate(
            draft_task_no=None,
            draft_title="Разработать функционал авансирования",
            draft_description="Разработать функционал авансирования по заявкам ППО",
            candidates=existing,  # type: ignore[arg-type]
        )

        self.assertIsNotNone(matched)
        self.assertEqual(matched.title, existing[0].title)

    def test_rollover_prefers_task_number(self):
        existing = [
            FakeTask(title="12. Старое название", description="Старое описание"),
            FakeTask(title="13. Почти похожая задача", description="Похожее описание"),
        ]
        matched = _find_rollover_candidate(
            draft_task_no="12",
            draft_title="12. Новое название после квартального переноса",
            draft_description="Совсем другое описание",
            candidates=existing,  # type: ignore[arg-type]
        )
        self.assertIsNotNone(matched)
        self.assertEqual(matched.title, "12. Старое название")


if __name__ == "__main__":
    unittest.main()
