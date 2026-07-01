from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
import shutil
import subprocess
import tempfile
from textwrap import wrap
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from app.schemas.report import (
    ReportBucket,
    ReportDepartmentSummary,
    ReportKpi,
    ReportProjectSummary,
    ReportRiskItem,
    ReportSlide,
    StatusSnapshotReport,
)


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"

SLIDE_REL_TYPE = f"{R_NS}/slide"
SLIDE_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"

SLIDE_W = 9_906_000
CONTENT_X = 520_000
CONTENT_Y = 900_000
CONTENT_W = 8_850_000
CONTENT_BOTTOM = 6_200_000
MAX_REPORT_PROJECTS = 15
MAIN_REPORT_TRACK = "main"
COMPETENCE_REPORT_TRACK = "competence_centers"
INITIATIVES_REPORT_TRACK = "initiatives"

ET.register_namespace("p", P_NS)
ET.register_namespace("a", A_NS)
ET.register_namespace("r", R_NS)


@dataclass
class DeckSlide:
    title: str
    bullets: list[str]
    kind: str = "bullets"
    projects: list[ReportProjectSummary] | None = None
    departments: list[ReportDepartmentSummary] | None = None
    risks: list[ReportRiskItem] | None = None
    report: StatusSnapshotReport | None = None


def build_status_report_pptx(report: StatusSnapshotReport, template_path: str | Path) -> bytes:
    template = _resolve_template_path(template_path)
    if not template.exists():
        raise FileNotFoundError(f"Report PPTX template not found: {template}")

    content_slides = _build_deck(report)
    slide_sources = ["ppt/slides/slide1.xml"] + ["ppt/slides/slide2.xml"] * len(content_slides) + ["ppt/slides/slide3.xml"]

    generated_slides: dict[str, bytes] = {}
    generated_rels: dict[str, bytes] = {}
    with ZipFile(template, "r") as zin:
        for output_index, source_name in enumerate(slide_sources, start=1):
            root = ET.fromstring(zin.read(source_name))
            if output_index == 1:
                _fill_title_slide(root, report)
            elif output_index == len(slide_sources):
                _fill_final_slide(root, output_index)
            else:
                _fill_content_slide(root, content_slides[output_index - 2], output_index)
            generated_slides[f"ppt/slides/slide{output_index}.xml"] = _xml_bytes(root)

            source_rels = source_name.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"
            rel_root = ET.fromstring(zin.read(source_rels))
            _drop_notes_relationships(rel_root)
            generated_rels[f"ppt/slides/_rels/slide{output_index}.xml.rels"] = _xml_bytes(rel_root, default_namespace=REL_NS)

        presentation = ET.fromstring(zin.read("ppt/presentation.xml"))
        presentation_rels = ET.fromstring(zin.read("ppt/_rels/presentation.xml.rels"))
        content_types = ET.fromstring(zin.read("[Content_Types].xml"))
        _rewrite_presentation_slides(presentation, presentation_rels, len(slide_sources))
        _rewrite_content_types(content_types, len(slide_sources))

        out = BytesIO()
        with ZipFile(out, "w", ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                name = item.filename
                if (
                    name in generated_slides
                    or name in generated_rels
                    or name in {"ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "[Content_Types].xml"}
                    or name.startswith("ppt/notesSlides/")
                ):
                    continue
                if name.startswith("ppt/slides/slide") and name.endswith(".xml"):
                    continue
                if name.startswith("ppt/slides/_rels/slide") and name.endswith(".xml.rels"):
                    continue
                zout.writestr(item, zin.read(name))
            zout.writestr("[Content_Types].xml", _xml_bytes(content_types, default_namespace=CT_NS))
            zout.writestr("ppt/presentation.xml", _xml_bytes(presentation))
            zout.writestr("ppt/_rels/presentation.xml.rels", _xml_bytes(presentation_rels, default_namespace=REL_NS))
            for name, payload in generated_slides.items():
                zout.writestr(name, payload)
            for name, payload in generated_rels.items():
                zout.writestr(name, payload)
        return out.getvalue()


def build_report_filename(report: StatusSnapshotReport, suffix: str = "pptx") -> str:
    return f"plannerbro-status-{report.period.from_date.isoformat()}_{report.period.to_date.isoformat()}.{suffix}"


def convert_pptx_to_pdf(pptx_payload: bytes, filename_stem: str = "plannerbro-status") -> bytes:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError("LibreOffice/soffice is not installed in the backend environment")

    with tempfile.TemporaryDirectory(prefix="plannerbro-report-") as tmp:
        tmp_path = Path(tmp)
        input_path = tmp_path / f"{filename_stem}.pptx"
        output_path = tmp_path / f"{filename_stem}.pdf"
        input_path.write_bytes(pptx_payload)
        result = subprocess.run(
            [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                "pdf",
                "--outdir",
                str(tmp_path),
                str(input_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=60,
            check=False,
        )
        if result.returncode != 0 or not output_path.exists():
            message = (result.stderr or result.stdout or "LibreOffice conversion failed").strip()
            raise RuntimeError(message)
        return output_path.read_bytes()


def _resolve_template_path(template_path: str | Path) -> Path:
    template = Path(template_path)
    if template.exists() or template.is_absolute():
        return template
    packaged_template = Path(__file__).resolve().parents[1] / "templates" / template.name
    return packaged_template if packaged_template.exists() else template


def _build_deck(report: StatusSnapshotReport) -> list[DeckSlide]:
    projects = _focus_projects(report, track=MAIN_REPORT_TRACK)
    competence_projects = _focus_projects(report, track=COMPETENCE_REPORT_TRACK, limit=6)
    initiative_projects = _focus_projects(report, track=INITIATIVES_REPORT_TRACK, limit=5)
    slides = [
        DeckSlide(
            title="Обзорная инфографика",
            bullets=[],
            kind="overview",
            report=report,
        ),
        DeckSlide(
            title="Крупные проекты",
            bullets=[],
            kind="projects",
            projects=projects[:7],
        ),
        DeckSlide(
            title="ЦК / аутсорсинг",
            bullets=[],
            kind="projects",
            projects=competence_projects,
        ),
    ]

    for idx, chunk in enumerate(_chunks(projects[7:], 5) if len(projects) > 7 else [], start=1):
        slides.append(
            DeckSlide(
                title="Крупные проекты: продолжение" if idx == 1 else f"Крупные проекты: продолжение ({idx})",
                bullets=[],
                kind="projects",
                projects=chunk,
            )
        )

    slides.extend(
        [
            DeckSlide(
                title="Риски и блокеры",
                bullets=[],
                kind="risks",
                risks=report.risks[:8],
            ),
            DeckSlide(
                title="Инициативы",
                bullets=[],
                kind="projects",
                projects=initiative_projects,
            ),
            DeckSlide(
                title="Что требует решения",
                bullets=_decision_bullets(report),
            ),
        ]
    )
    return slides


def _fill_title_slide(root: ET.Element, report: StatusSnapshotReport) -> None:
    text_shapes = _text_shapes(root)
    if len(text_shapes) >= 1:
        _set_shape_paragraphs(text_shapes[0], ["Текущий статус ИТ проектов"], font_size=2000, bold=True)
    if len(text_shapes) >= 2:
        _set_shape_paragraphs(text_shapes[1], [_format_period(report)], font_size=1400)
    if len(text_shapes) >= 3:
        _set_shape_paragraphs(text_shapes[2], [report.scope_label, f"Сформировано: {_format_datetime(report.generated_at)}"], font_size=1600)


def _fill_final_slide(root: ET.Element, page_number: int) -> None:
    _set_slide_number(root, page_number)


def _fill_content_slide(root: ET.Element, slide: DeckSlide, page_number: int) -> None:
    _set_slide_number(root, page_number)
    shapes = _text_shapes(root)
    if len(shapes) >= 2:
        _set_shape_paragraphs(shapes[1], [slide.title], font_size=1800, bold=True)
    _remove_generated_shapes(root)

    if slide.kind == "overview":
        _add_overview_infographic(root, slide.report)
    elif slide.kind == "projects":
        _add_project_rows(root, slide.projects or [])
    elif slide.kind == "departments":
        _add_department_rows(root, slide.departments or [])
    elif slide.kind == "risks":
        _add_risk_rows(root, slide.risks or [])
    else:
        _add_bullet_box(root, slide.bullets)


def _add_bullet_box(root: ET.Element, bullets: list[str]) -> None:
    paragraphs = bullets or ["Нет данных"]
    _append_text_shape(root, CONTENT_X, CONTENT_Y, CONTENT_W, 4_900_000, paragraphs, font_size=1550)


def _add_overview_infographic(root: ET.Element, report: StatusSnapshotReport | None) -> None:
    if report is None:
        _add_bullet_box(root, ["Нет данных для обзорной инфографики"])
        return

    card_w = 2_050_000
    card_h = 690_000
    card_gap = 215_000
    cards = [
        ("Проектов", _kpi_value(report, "projects_total"), "в докладовом scope", "DBEAFE"),
        ("Всего задач", _kpi_value(report, "tasks_total"), "по всем слоям scope", "E0E7FF"),
        ("Выполнено", _kpi_value(report, "completed_tasks"), "закрыто или 100%", "DCFCE7"),
        ("Просрочено", _kpi_value(report, "overdue_tasks"), "требует внимания", "FEE2E2"),
    ]
    for index, (label, value, detail, fill) in enumerate(cards):
        x = CONTENT_X + index * (card_w + card_gap)
        _append_rect(root, x, CONTENT_Y, card_w, card_h, fill=fill, line="CBD5E1")
        _append_text_shape(root, x + 110_000, CONTENT_Y + 75_000, card_w - 220_000, 145_000, [label], font_size=900, bold=True)
        _append_text_shape(root, x + 110_000, CONTENT_Y + 225_000, card_w - 220_000, 250_000, [value], font_size=2250, bold=True)
        _append_text_shape(root, x + 110_000, CONTENT_Y + 520_000, card_w - 220_000, 105_000, [detail], font_size=760)

    chart_y = CONTENT_Y + 980_000
    _add_bucket_bar_chart(
        root,
        CONTENT_X,
        chart_y,
        4_220_000,
        1_700_000,
        "Статусы задач",
        report.status_counts,
        {
            "planning": "0EA5E9",
            "tz": "06B6D4",
            "todo": "94A3B8",
            "in_progress": "6366F1",
            "testing": "8B5CF6",
            "review": "F59E0B",
            "done": "22C55E",
        },
    )
    _add_bucket_bar_chart(
        root,
        CONTENT_X + 4_640_000,
        chart_y,
        4_220_000,
        1_700_000,
        "Приоритеты задач",
        report.priority_counts,
        {
            "low": "3B82F6",
            "medium": "EAB308",
            "high": "F97316",
            "critical": "EF4444",
        },
    )

    lower_y = chart_y + 1_980_000
    _add_activity_heatmap(root, CONTENT_X, lower_y, 5_600_000, 1_260_000, report)
    _add_summary_signal_box(root, CONTENT_X + 5_920_000, lower_y, 2_930_000, 1_260_000, report)


def _add_bucket_bar_chart(
    root: ET.Element,
    x: int,
    y: int,
    w: int,
    h: int,
    title: str,
    buckets: list[ReportBucket],
    colors: dict[str, str],
) -> None:
    _append_text_shape(root, x, y, w, 180_000, [title], font_size=980, bold=True)
    if not buckets:
        _append_text_shape(root, x, y + 320_000, w, 300_000, ["Нет данных"], font_size=900)
        return
    max_count = max([item.count for item in buckets] + [1])
    bar_gap = 75_000
    label_h = 330_000
    plot_h = h - 470_000
    bar_w = max(90_000, int((w - bar_gap * (len(buckets) - 1)) / len(buckets)))
    base_y = y + 210_000 + plot_h
    for index, bucket in enumerate(buckets):
        bx = x + index * (bar_w + bar_gap)
        bar_h = max(18_000, int(plot_h * (bucket.count / max_count))) if bucket.count else 18_000
        fill = colors.get(bucket.key, "64748B")
        _append_rect(root, bx, base_y - bar_h, bar_w, bar_h, fill=fill, line=fill)
        _append_text_shape(root, bx, base_y - bar_h - 160_000, bar_w, 120_000, [str(bucket.count)], font_size=700, bold=True)
        _append_text_shape(root, bx - 20_000, base_y + 35_000, bar_w + 40_000, label_h, [_short_bucket_label(bucket.label)], font_size=570)


def _add_activity_heatmap(root: ET.Element, x: int, y: int, w: int, h: int, report: StatusSnapshotReport) -> None:
    _append_text_shape(root, x, y, w, 170_000, ["Тепловая карта активности"], font_size=980, bold=True)
    day_counts = {item.date.isoformat(): item.count for item in report.activity_days}
    dates = _date_range(report.period.from_date, report.period.to_date)[-70:]
    if not dates:
        _append_text_shape(root, x, y + 300_000, w, 250_000, ["Нет данных по активности"], font_size=900)
        return
    rows = 4
    cols = max(1, (len(dates) + rows - 1) // rows)
    gap = 28_000
    cell = min(120_000, max(45_000, int((w - (cols - 1) * gap) / cols)))
    max_count = max([day_counts.get(item.isoformat(), 0) for item in dates] + [1])
    grid_y = y + 280_000
    for index, current in enumerate(dates):
        col = index // rows
        row = index % rows
        count = day_counts.get(current.isoformat(), 0)
        _append_rect(root, x + col * (cell + gap), grid_y + row * (cell + gap), cell, cell, fill=_heat_color(count, max_count), line="FFFFFF")
    total_events = sum(day_counts.values())
    active_days = sum(1 for value in day_counts.values() if value > 0)
    _append_text_shape(
        root,
        x,
        grid_y + rows * (cell + gap) + 60_000,
        w,
        180_000,
        [f"Событий за период: {total_events}; активных дней: {active_days}"],
        font_size=760,
    )


def _add_summary_signal_box(root: ET.Element, x: int, y: int, w: int, h: int, report: StatusSnapshotReport) -> None:
    _append_rect(root, x, y, w, h, fill="F8FAFC", line="CBD5E1")
    bullets = [
        f"Средний прогресс: {_kpi_value(report, 'avg_progress')}",
        f"Критические/СКИ: {_kpi_value(report, 'critical_tasks')}",
        f"Без ответственного: {_kpi_value(report, 'unassigned_tasks')}",
        f"Создано за период: {report.activity.tasks_created}",
        f"Обновлено за период: {report.activity.tasks_updated}",
    ]
    _append_text_shape(root, x + 120_000, y + 80_000, w - 240_000, 170_000, ["Сигналы контроля"], font_size=980, bold=True)
    _append_text_shape(root, x + 120_000, y + 300_000, w - 240_000, h - 360_000, bullets, font_size=820)


def _add_department_rows(root: ET.Element, departments: list[ReportDepartmentSummary]) -> None:
    if not departments:
        _add_bullet_box(root, ["Нет данных по отделам"])
        return
    y = CONTENT_Y
    for department in departments:
        title = f"{department.name}: проектов {department.projects_total}, прогресс {department.progress_percent}%"
        detail = f"Задачи: {department.done_tasks}/{department.tasks_total}; просрочено задач: {department.overdue_tasks}; просрочено проектов: {department.overdue_projects}"
        _append_text_shape(root, CONTENT_X, y, 6_500_000, 360_000, [title, detail], font_size=1250, bold_first=True)
        _append_progress_bar(root, CONTENT_X + 6_650_000, y + 90_000, 1_950_000, 140_000, department.progress_percent)
        y += 670_000


def _add_project_rows(root: ET.Element, projects: list[ReportProjectSummary]) -> None:
    if not projects:
        _add_bullet_box(root, ["Нет проектов в фокусе"])
        return
    y = CONTENT_Y
    for project in projects:
        detail = (
            f"{project.status_label}; ответственный: {project.owner_name}; "
            f"задачи: {project.done_tasks}/{project.total_tasks}; дедлайн: {_format_date(project.end_date)}"
        )
        risk = "; ".join(project.risk_reasons) if project.risk_reasons else "рисков не выявлено"
        _append_text_shape(root, CONTENT_X, y, 6_450_000, 470_000, [project.name, detail, risk], font_size=1050, bold_first=True)
        _append_progress_bar(root, CONTENT_X + 6_650_000, y + 105_000, 1_850_000, 150_000, project.progress_percent)
        _append_text_shape(root, CONTENT_X + 8_560_000, y + 52_000, 420_000, 220_000, [f"{project.progress_percent}%"], font_size=1000, bold=True)
        y += 890_000


def _add_risk_rows(root: ET.Element, risks: list[ReportRiskItem]) -> None:
    if not risks:
        _add_bullet_box(root, ["Критических рисков не найдено"])
        return
    y = CONTENT_Y
    for risk in risks:
        owner = risk.assignee_name or risk.owner_name or "ответственный не назначен"
        deadline = f"; дедлайн: {_format_date(risk.end_date)}" if risk.end_date else ""
        lines = [risk.title, f"{risk.reason}; {owner}{deadline}"]
        _append_text_shape(root, CONTENT_X, y, CONTENT_W, 440_000, lines, font_size=1120, bold_first=True)
        y += 620_000
        if y > CONTENT_BOTTOM:
            break


def _append_progress_bar(root: ET.Element, x: int, y: int, w: int, h: int, percent: int) -> None:
    _append_rect(root, x, y, w, h, fill="D9E2F3", line="B4C6E7")
    _append_rect(root, x, y, max(1, int(w * max(0, min(percent, 100)) / 100)), h, fill="2F75B5", line="2F75B5")


def _append_text_shape(
    root: ET.Element,
    x: int,
    y: int,
    w: int,
    h: int,
    paragraphs: list[str],
    *,
    font_size: int = 1200,
    bold: bool = False,
    bold_first: bool = False,
) -> None:
    sp_tree = _sp_tree(root)
    shape_id = _next_shape_id(root)
    sp = ET.SubElement(sp_tree, f"{{{P_NS}}}sp")
    nv = ET.SubElement(sp, f"{{{P_NS}}}nvSpPr")
    ET.SubElement(nv, f"{{{P_NS}}}cNvPr", {"id": str(shape_id), "name": f"Generated Text {shape_id}"})
    ET.SubElement(nv, f"{{{P_NS}}}cNvSpPr", {"txBox": "1"})
    ET.SubElement(nv, f"{{{P_NS}}}nvPr")
    sp_pr = ET.SubElement(sp, f"{{{P_NS}}}spPr")
    xfrm = ET.SubElement(sp_pr, f"{{{A_NS}}}xfrm")
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": str(w), "cy": str(h)})
    prst = ET.SubElement(sp_pr, f"{{{A_NS}}}prstGeom", {"prst": "rect"})
    ET.SubElement(prst, f"{{{A_NS}}}avLst")
    ET.SubElement(sp_pr, f"{{{A_NS}}}noFill")
    ln = ET.SubElement(sp_pr, f"{{{A_NS}}}ln")
    ET.SubElement(ln, f"{{{A_NS}}}noFill")
    tx_body = ET.SubElement(sp, f"{{{P_NS}}}txBody")
    body_pr = ET.SubElement(tx_body, f"{{{A_NS}}}bodyPr", {"wrap": "square", "rtlCol": "0"})
    ET.SubElement(body_pr, f"{{{A_NS}}}spAutoFit")
    ET.SubElement(tx_body, f"{{{A_NS}}}lstStyle")
    for index, paragraph in enumerate(paragraphs):
        for line_index, line in enumerate(_wrap_text(paragraph, font_size)):
            _append_paragraph(tx_body, line, font_size=font_size, bold=bold or (bold_first and index == 0 and line_index == 0))


def _append_rect(root: ET.Element, x: int, y: int, w: int, h: int, *, fill: str, line: str) -> None:
    sp_tree = _sp_tree(root)
    shape_id = _next_shape_id(root)
    sp = ET.SubElement(sp_tree, f"{{{P_NS}}}sp")
    nv = ET.SubElement(sp, f"{{{P_NS}}}nvSpPr")
    ET.SubElement(nv, f"{{{P_NS}}}cNvPr", {"id": str(shape_id), "name": f"Generated Bar {shape_id}"})
    ET.SubElement(nv, f"{{{P_NS}}}cNvSpPr")
    ET.SubElement(nv, f"{{{P_NS}}}nvPr")
    sp_pr = ET.SubElement(sp, f"{{{P_NS}}}spPr")
    xfrm = ET.SubElement(sp_pr, f"{{{A_NS}}}xfrm")
    ET.SubElement(xfrm, f"{{{A_NS}}}off", {"x": str(x), "y": str(y)})
    ET.SubElement(xfrm, f"{{{A_NS}}}ext", {"cx": str(w), "cy": str(h)})
    prst = ET.SubElement(sp_pr, f"{{{A_NS}}}prstGeom", {"prst": "rect"})
    ET.SubElement(prst, f"{{{A_NS}}}avLst")
    solid_fill = ET.SubElement(sp_pr, f"{{{A_NS}}}solidFill")
    ET.SubElement(solid_fill, f"{{{A_NS}}}srgbClr", {"val": fill})
    ln = ET.SubElement(sp_pr, f"{{{A_NS}}}ln", {"w": "6350"})
    ln_fill = ET.SubElement(ln, f"{{{A_NS}}}solidFill")
    ET.SubElement(ln_fill, f"{{{A_NS}}}srgbClr", {"val": line})


def _append_paragraph(parent: ET.Element, text: str, *, font_size: int, bold: bool = False) -> None:
    p = ET.SubElement(parent, f"{{{A_NS}}}p")
    p_pr = ET.SubElement(p, f"{{{A_NS}}}pPr")
    ET.SubElement(p_pr, f"{{{A_NS}}}buNone")
    r = ET.SubElement(p, f"{{{A_NS}}}r")
    r_pr_attrs = {"lang": "ru-RU", "sz": str(font_size)}
    if bold:
        r_pr_attrs["b"] = "1"
    r_pr = ET.SubElement(r, f"{{{A_NS}}}rPr", r_pr_attrs)
    solid = ET.SubElement(r_pr, f"{{{A_NS}}}solidFill")
    ET.SubElement(solid, f"{{{A_NS}}}srgbClr", {"val": "1F2937"})
    ET.SubElement(r_pr, f"{{{A_NS}}}latin", {"typeface": "Arial"})
    ET.SubElement(r_pr, f"{{{A_NS}}}cs", {"typeface": "Arial"})
    t = ET.SubElement(r, f"{{{A_NS}}}t")
    t.text = text
    ET.SubElement(p, f"{{{A_NS}}}endParaRPr", {"lang": "ru-RU", "sz": str(font_size)})


def _set_shape_paragraphs(shape: ET.Element, paragraphs: list[str], *, font_size: int = 1400, bold: bool = False) -> None:
    tx_body = shape.find(f"{{{P_NS}}}txBody")
    if tx_body is None:
        return
    for child in list(tx_body):
        if child.tag == f"{{{A_NS}}}p":
            tx_body.remove(child)
    for paragraph in paragraphs:
        _append_paragraph(tx_body, paragraph, font_size=font_size, bold=bold)


def _set_slide_number(root: ET.Element, page_number: int) -> None:
    shapes = _text_shapes(root)
    if shapes:
        _set_shape_paragraphs(shapes[0], [str(page_number)], font_size=1000)


def _remove_generated_shapes(root: ET.Element) -> None:
    sp_tree = _sp_tree(root)
    for shape in list(sp_tree):
        c_nv_pr = shape.find(f".//{{{P_NS}}}cNvPr")
        name = c_nv_pr.attrib.get("name", "") if c_nv_pr is not None else ""
        if name.startswith("Generated "):
            sp_tree.remove(shape)


def _text_shapes(root: ET.Element) -> list[ET.Element]:
    return [shape for shape in root.findall(f".//{{{P_NS}}}sp") if shape.find(f"{{{P_NS}}}txBody") is not None]


def _sp_tree(root: ET.Element) -> ET.Element:
    sp_tree = root.find(f".//{{{P_NS}}}spTree")
    if sp_tree is None:
        raise ValueError("PPTX slide does not contain shape tree")
    return sp_tree


def _next_shape_id(root: ET.Element) -> int:
    ids = [
        int(item.attrib["id"])
        for item in root.findall(f".//{{{P_NS}}}cNvPr")
        if item.attrib.get("id", "").isdigit()
    ]
    return (max(ids) if ids else 1) + 1


def _drop_notes_relationships(root: ET.Element) -> None:
    for rel in list(root):
        if rel.attrib.get("Type", "").endswith("/notesSlide"):
            root.remove(rel)


def _rewrite_presentation_slides(presentation: ET.Element, rels: ET.Element, slide_count: int) -> None:
    sld_id_lst = presentation.find(f"{{{P_NS}}}sldIdLst")
    if sld_id_lst is None:
        sld_id_lst = ET.SubElement(presentation, f"{{{P_NS}}}sldIdLst")
    for child in list(sld_id_lst):
        sld_id_lst.remove(child)

    for rel in list(rels):
        if rel.attrib.get("Type") == SLIDE_REL_TYPE:
            rels.remove(rel)

    for index in range(1, slide_count + 1):
        rid = f"rIdReportSlide{index}"
        ET.SubElement(sld_id_lst, f"{{{P_NS}}}sldId", {"id": str(300 + index), f"{{{R_NS}}}id": rid})
        ET.SubElement(rels, f"{{{REL_NS}}}Relationship", {"Id": rid, "Type": SLIDE_REL_TYPE, "Target": f"slides/slide{index}.xml"})


def _rewrite_content_types(content_types: ET.Element, slide_count: int) -> None:
    for item in list(content_types):
        part_name = item.attrib.get("PartName", "")
        if part_name.startswith("/ppt/slides/slide") or part_name.startswith("/ppt/notesSlides/"):
            content_types.remove(item)
    for index in range(1, slide_count + 1):
        ET.SubElement(
            content_types,
            f"{{{CT_NS}}}Override",
            {"PartName": f"/ppt/slides/slide{index}.xml", "ContentType": SLIDE_CONTENT_TYPE},
        )


def _focus_projects(report: StatusSnapshotReport, *, track: str | None = None, limit: int = MAX_REPORT_PROJECTS) -> list[ReportProjectSummary]:
    weight = {"high": 0, "medium": 1, "low": 2}
    projects = [item for item in report.projects if track is None or item.report_track == track]
    return sorted(
        projects,
        key=lambda item: (
            weight.get(item.risk_level, 3),
            item.end_date or date.max,
            item.name.lower(),
        ),
    )[:limit]


def _decision_bullets(report: StatusSnapshotReport) -> list[str]:
    bullets: list[str] = []
    if _kpi_number(report, "overdue_projects") > 0:
        bullets.append("Утвердить решения по просроченным проектам: перенос срока, изменение объема или эскалация.")
    if _kpi_number(report, "overdue_tasks") > 0:
        bullets.append("Разобрать просроченные задачи с ответственными и зафиксировать новые контрольные даты.")
    if _kpi_number(report, "unassigned_tasks") > 0:
        bullets.append("Назначить владельцев на задачи без ответственного.")
    if _kpi_number(report, "critical_tasks") > 0:
        bullets.append("Проверить критические/СКИ задачи и подтвердить план закрытия.")
    return bullets or ["Подтвердить текущий план и продолжить мониторинг без управленческих решений."]


def _kpi_value(report: StatusSnapshotReport, key: str) -> str:
    item = _kpi(report, key)
    return f"{item.value}{item.unit or ''}" if item else "0"


def _kpi_number(report: StatusSnapshotReport, key: str) -> float:
    item = _kpi(report, key)
    return float(item.value) if item else 0


def _kpi(report: StatusSnapshotReport, key: str) -> ReportKpi | None:
    return next((item for item in report.kpis if item.id == key), None)


def _format_period(report: StatusSnapshotReport) -> str:
    return f"{_format_date(report.period.from_date)} - {_format_date(report.period.to_date)}"


def _format_date(value: date | None) -> str:
    return value.strftime("%d.%m.%Y") if value else "-"


def _format_datetime(value) -> str:
    return value.strftime("%d.%m.%Y %H:%M") if value else "-"


def _short_bucket_label(label: str) -> str:
    mapping = {
        "Планирование": "План",
        "ТЗ": "ТЗ",
        "К выполнению": "К вып.",
        "В работе": "В раб.",
        "Тестирование": "Тест",
        "На проверке": "Пров.",
        "Выполнено": "Готово",
        "Низкий": "Низк.",
        "Средний": "Сред.",
        "Высокий": "Выс.",
        "Критический": "Крит.",
    }
    return mapping.get(label, label[:8])


def _date_range(start: date, end: date) -> list[date]:
    if start > end:
        start, end = end, start
    return [start + timedelta(days=index) for index in range((end - start).days + 1)]


def _heat_color(count: int, max_count: int) -> str:
    if count <= 0:
        return "E5E7EB"
    ratio = count / max(1, max_count)
    if ratio <= 0.25:
        return "BBF7D0"
    if ratio <= 0.50:
        return "4ADE80"
    if ratio <= 0.75:
        return "22C55E"
    return "166534"


def _wrap_text(text: str, font_size: int) -> list[str]:
    max_chars = 76 if font_size <= 1150 else 62
    return wrap(text, width=max_chars, break_long_words=False, replace_whitespace=False) or [""]


def _chunks(items: list[ReportProjectSummary], size: int) -> list[list[ReportProjectSummary]]:
    return [items[index:index + size] for index in range(0, len(items), size)] or [[]]


def _xml_bytes(root: ET.Element, *, default_namespace: str | None = None) -> bytes:
    if default_namespace:
        ET.register_namespace("", default_namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)
