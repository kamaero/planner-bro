import unittest
from dataclasses import dataclass, field
from datetime import date

from app.services.project_print_service import build_project_tasks_print_html


@dataclass
class FakeUser:
    first_name: str = ""
    middle_name: str = ""
    last_name: str = ""
    name: str = ""


@dataclass
class FakeTask:
    title: str
    status: str
    priority: str
    task_number: str | None = None
    order: float | None = None
    assignee: FakeUser | None = None
    assignees: list[FakeUser] = field(default_factory=list)


@dataclass
class FakeProject:
    name: str
    start_date: date | None = None
    end_date: date | None = None


class ProjectPrintServiceTests(unittest.TestCase):
    def test_renders_only_open_tasks_sorted_by_order_and_maps_priority(self):
        project = FakeProject(name="План ППО", start_date=date(2026, 5, 1))
        tasks = [
            FakeTask(title="Выполненная", status="done", priority="critical", order=1),
            FakeTask(
                title="Вторая по порядку",
                status="todo",
                priority="medium",
                order=20,
                assignee=FakeUser(last_name="Иванов", first_name="Пётр", middle_name="Сергеевич"),
            ),
            FakeTask(
                title="Первая по порядку",
                status="in_progress",
                priority="high",
                order=10,
                assignee=FakeUser(name="Команда ППО"),
            ),
        ]

        html = build_project_tasks_print_html(project, tasks)

        self.assertIn("на 2-й квартал 2026г.", html)
        self.assertIn("Первая по порядку", html)
        self.assertIn("Вторая по порядку", html)
        self.assertNotIn("Выполненная", html)
        self.assertLess(html.index("Первая по порядку"), html.index("Вторая по порядку"))
        self.assertIn(">1</td>", html)
        self.assertIn(">2</td>", html)
        self.assertIn("Иванов П.С.", html)
        self.assertIn("Команда ППО", html)

    def test_falls_back_to_task_number_sort_when_order_missing(self):
        project = FakeProject(name="План ППО", start_date=date(2026, 1, 1))
        tasks = [
            FakeTask(title="Задача 10", status="todo", priority="low", task_number="10"),
            FakeTask(title="Задача 2", status="todo", priority="critical", task_number="2"),
        ]

        html = build_project_tasks_print_html(project, tasks)

        self.assertLess(html.index("Задача 2"), html.index("Задача 10"))


if __name__ == "__main__":
    unittest.main()
