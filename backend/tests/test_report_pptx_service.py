import unittest
from datetime import date, datetime, timezone
from io import BytesIO
from zipfile import ZipFile

from app.schemas.report import (
    ReportActivityDay,
    ReportActivitySummary,
    ReportBucket,
    ReportDepartmentSummary,
    ReportKpi,
    ReportPeriod,
    ReportProjectSummary,
    ReportRiskItem,
    StatusSnapshotReport,
)
from app.services.report_pptx_service import build_status_report_pptx


class ReportPptxServiceTests(unittest.TestCase):
    def test_builds_presentation_from_corporate_template(self):
        report = StatusSnapshotReport(
            generated_at=datetime(2026, 6, 3, 2, 30, tzinfo=timezone.utc),
            period=ReportPeriod(from_date=date(2026, 5, 1), to_date=date(2026, 6, 3)),
            scope_label="Полный контур",
            kpis=[
                ReportKpi(id="projects_total", label="Проекты", value=4),
                ReportKpi(id="tasks_total", label="Всего задач", value=30),
                ReportKpi(id="completed_tasks", label="Выполнено задач", value=16),
                ReportKpi(id="active_projects", label="Активные", value=3),
                ReportKpi(id="completed_projects", label="Завершены", value=1),
                ReportKpi(id="avg_progress", label="Средний прогресс", value=61, unit="%"),
                ReportKpi(id="overdue_projects", label="Просрочено проектов", value=1),
                ReportKpi(id="overdue_tasks", label="Просрочено задач", value=2),
                ReportKpi(id="critical_tasks", label="Критические/СКИ", value=1),
                ReportKpi(id="unassigned_tasks", label="Без ответственного", value=0),
            ],
            status_counts=[
                ReportBucket(key="todo", label="К выполнению", count=8),
                ReportBucket(key="in_progress", label="В работе", count=6),
                ReportBucket(key="done", label="Выполнено", count=16),
            ],
            priority_counts=[
                ReportBucket(key="medium", label="Средний", count=18),
                ReportBucket(key="high", label="Высокий", count=9),
                ReportBucket(key="critical", label="Критический", count=3),
            ],
            departments=[
                ReportDepartmentSummary(
                    id="it",
                    name="ИТ",
                    projects_total=4,
                    active_projects=3,
                    completed_projects=1,
                    overdue_projects=1,
                    tasks_total=40,
                    done_tasks=24,
                    overdue_tasks=2,
                    progress_percent=60,
                )
            ],
            projects=[
                ReportProjectSummary(
                    id="p1",
                    name="Внедрение PlannerBro",
                    status="active",
                    status_label="В работе",
                    priority="high",
                    owner_name="Иванов И.И.",
                    department_names=["ИТ"],
                    total_tasks=20,
                    done_tasks=12,
                    overdue_tasks=2,
                    critical_tasks=1,
                    stale_tasks=0,
                    progress_percent=60,
                    start_date=date(2026, 1, 1),
                    end_date=date(2026, 6, 10),
                    risk_level="high",
                    risk_reasons=["просроченных задач: 2"],
                ),
                ReportProjectSummary(
                    id="p2",
                    name="ЦК 1С",
                    status="active",
                    status_label="В работе",
                    priority="medium",
                    project_kind="competence_center",
                    report_visibility="watch",
                    report_track="competence_centers",
                    owner_name="Петров П.П.",
                    department_names=["ЦК 1С"],
                    total_tasks=10,
                    done_tasks=4,
                    overdue_tasks=0,
                    critical_tasks=1,
                    stale_tasks=0,
                    progress_percent=40,
                    end_date=None,
                    risk_level="medium",
                    risk_reasons=["критических/СКИ задач: 1"],
                )
            ],
            risks=[
                ReportRiskItem(
                    kind="project",
                    id="p1",
                    title="Внедрение PlannerBro",
                    project_id="p1",
                    project_name="Внедрение PlannerBro",
                    owner_name="Иванов И.И.",
                    end_date=date(2026, 6, 10),
                    risk_level="high",
                    reason="просроченных задач: 2",
                )
            ],
            recent_tasks=[],
            my_tasks=[],
            upcoming_deadlines=[],
            control_ski_tasks=[],
            workload=[],
            escalations_count=0,
            activity=ReportActivitySummary(
                tasks_created=5,
                tasks_updated=30,
                tasks_completed=8,
                task_events=40,
                deadline_shifts=2,
                email_sent=0,
                email_failed=0,
            ),
            activity_days=[
                ReportActivityDay(date=date(2026, 5, 28), count=3),
                ReportActivityDay(date=date(2026, 5, 29), count=8),
                ReportActivityDay(date=date(2026, 6, 1), count=12),
            ],
            slides=[],
        )

        payload = build_status_report_pptx(report, "app/templates/it_template.pptx")

        with ZipFile(BytesIO(payload)) as archive:
            self.assertIsNone(archive.testzip())
            slides = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
            self.assertGreaterEqual(len(slides), 7)
            slide_text = archive.read("ppt/slides/slide1.xml").decode("utf-8")
            self.assertIn("Текущий статус ИТ проектов", slide_text)
            overview_slide_text = archive.read("ppt/slides/slide2.xml").decode("utf-8")
            self.assertIn("Обзорная инфографика", overview_slide_text)
            self.assertIn("Всего задач", overview_slide_text)
            self.assertIn("Тепловая карта активности", overview_slide_text)
            project_slide_text = archive.read("ppt/slides/slide3.xml").decode("utf-8")
            self.assertIn("Внедрение PlannerBro", project_slide_text)
            competence_slide_text = archive.read("ppt/slides/slide4.xml").decode("utf-8")
            self.assertIn("ЦК 1С", competence_slide_text)


if __name__ == "__main__":
    unittest.main()
