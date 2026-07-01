import unittest
from dataclasses import dataclass, field
from datetime import date

from app.services.project_print_service import _report_quarter, build_project_tasks_print_html


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
    def test_open_tasks_sorted_by_number_with_zero_indexed_priority(self):
        project = FakeProject(name="План ППО", start_date=date(2026, 5, 1))
        tasks = [
            # done-задачи в план не попадают
            FakeTask(title="Выполненная", status="done", priority="critical", task_number="0"),
            # drag-and-drop order намеренно противоречит номеру, чтобы проверить,
            # что сортировка идёт по task_number, а не по order (пункт 6)
            FakeTask(
                title="Вторая",
                status="todo",
                priority="medium",
                task_number="2",
                order=1,
                assignee=FakeUser(last_name="Иванов", first_name="Пётр", middle_name="Сергеевич"),
            ),
            FakeTask(
                title="Первая",
                status="in_progress",
                priority="high",
                task_number="1",
                order=99,
                assignee=FakeUser(name="Команда ППО"),
            ),
            FakeTask(title="Третья", status="todo", priority="critical", task_number="3"),
        ]

        html = build_project_tasks_print_html(project, tasks)

        self.assertNotIn("Выполненная", html)
        # сортировка строго по номеру, order игнорируется
        self.assertLess(html.index("Первая"), html.index("Вторая"))
        self.assertLess(html.index("Вторая"), html.index("Третья"))
        # приоритет 0-индексный: critical=0, high=1, medium=2 (пункт 5)
        self.assertIn('<td class="priority">0</td>', html)
        self.assertIn('<td class="priority">1</td>', html)
        self.assertIn('<td class="priority">2</td>', html)
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

    def test_multiple_assignees_render_real_line_breaks(self):
        # пункт 3: несколько исполнителей разделяются настоящим <br>,
        # а не видимым текстом «&lt;br&gt;» (был баг двойного экранирования)
        project = FakeProject(name="План ППО")
        task = FakeTask(
            title="Совместная",
            status="todo",
            priority="low",
            task_number="1",
            assignees=[
                FakeUser(last_name="Иванов", first_name="Пётр"),
                FakeUser(last_name="Петров", first_name="Иван"),
            ],
        )

        html = build_project_tasks_print_html(project, [task])

        self.assertIn("Иванов П.<br>Петров И.", html)
        self.assertNotIn("&lt;br&gt;", html)


    def test_report_quarter_looks_15_days_ahead(self):
        # пункт 2: за 15 дней до старта нового квартала печатается уже новый квартал
        self.assertEqual(_report_quarter(date(2026, 9, 16)), (4, 2026))   # 16 сен + 15 → окт → Q4
        self.assertEqual(_report_quarter(date(2026, 9, 10)), (3, 2026))   # ещё Q3
        self.assertEqual(_report_quarter(date(2026, 8, 1)), (3, 2026))    # середина квартала
        self.assertEqual(_report_quarter(date(2026, 12, 20)), (1, 2027))  # перескок через год


if __name__ == "__main__":
    unittest.main()
