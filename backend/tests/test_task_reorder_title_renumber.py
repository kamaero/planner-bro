import unittest
from dataclasses import dataclass
from datetime import datetime

from app.services.task_reorder_service import renumber_task_titles_after_reorder


@dataclass
class FakeTask:
    id: str
    title: str
    order: float | None
    parent_task_id: str | None = None
    created_at: datetime = datetime(2026, 1, 1)


class TaskReorderTitleRenumberTests(unittest.TestCase):
    def test_renumbers_titles_by_order(self):
        tasks = [
            FakeTask(id="a", title="1. Первая", order=1000),
            FakeTask(id="b", title="2. Вторая", order=2000),
            FakeTask(id="c", title="56. Пятьдесят шестая", order=3000),
        ]
        tasks[2].order = 500

        changed = renumber_task_titles_after_reorder(tasks)

        self.assertGreaterEqual(changed, 2)
        by_id = {t.id: t for t in tasks}
        self.assertTrue(by_id["c"].title.startswith("1. "))
        self.assertTrue(by_id["a"].title.startswith("2. "))
        self.assertTrue(by_id["b"].title.startswith("3. "))

    def test_does_not_touch_titles_without_number_prefix(self):
        tasks = [
            FakeTask(id="x", title="Без номера", order=1000),
            FakeTask(id="y", title="2. С номером", order=2000),
        ]
        changed = renumber_task_titles_after_reorder(tasks)
        self.assertEqual(tasks[0].title, "Без номера")
        self.assertEqual(changed, 0)


if __name__ == "__main__":
    unittest.main()
