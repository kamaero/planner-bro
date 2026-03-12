from __future__ import annotations

import io
import unittest
import zipfile

from app.services.ms_project_import_service import inspect_import_file, parse_ms_project_content


def _xlsx_with_tasks() -> bytes:
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
  </sheets>
</workbook>
"""
    sheet_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>uid</t></is></c>
      <c r="B1" t="inlineStr"><is><t>title</t></is></c>
      <c r="C1" t="inlineStr"><is><t>start_date</t></is></c>
      <c r="D1" t="inlineStr"><is><t>end_date</t></is></c>
      <c r="E1" t="inlineStr"><is><t>progress</t></is></c>
      <c r="F1" t="inlineStr"><is><t>priority</t></is></c>
      <c r="G1" t="inlineStr"><is><t>parent_uid</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>10</t></is></c>
      <c r="B2" t="inlineStr"><is><t>Root task</t></is></c>
      <c r="C2" t="inlineStr"><is><t>2026-03-10</t></is></c>
      <c r="D2" t="inlineStr"><is><t>2026-03-15</t></is></c>
      <c r="E2" t="inlineStr"><is><t>60</t></is></c>
      <c r="F2" t="inlineStr"><is><t>high</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>11</t></is></c>
      <c r="B3" t="inlineStr"><is><t>Child task</t></is></c>
      <c r="C3" t="inlineStr"><is><t>2026-03-11</t></is></c>
      <c r="D3" t="inlineStr"><is><t>2026-03-14</t></is></c>
      <c r="E3" t="inlineStr"><is><t>0</t></is></c>
      <c r="F3" t="inlineStr"><is><t>medium</t></is></c>
      <c r="G3" t="inlineStr"><is><t>10</t></is></c>
    </row>
  </sheetData>
</worksheet>
"""
    content_types_xml = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
"""
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return data.getvalue()


def _xlsx_with_department_structure() -> bytes:
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
  </sheets>
</workbook>
"""
    sheet_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Отдел</t></is></c>
      <c r="B1" t="inlineStr"><is><t>Бюро</t></is></c>
      <c r="C1" t="inlineStr"><is><t>Наименование</t></is></c>
      <c r="D1" t="inlineStr"><is><t>Вид задачи</t></is></c>
      <c r="E1" t="inlineStr"><is><t>Срок</t></is></c>
      <c r="F1" t="inlineStr"><is><t>Исполнитель</t></is></c>
      <c r="G1" t="inlineStr"><is><t>Заказчик</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>ИТ</t></is></c>
      <c r="B2" t="inlineStr"><is><t>Бюро 1</t></is></c>
      <c r="C2" t="inlineStr"><is><t>Внедрить отчётность</t></is></c>
      <c r="D2" t="inlineStr"><is><t>Проектная</t></is></c>
      <c r="E2" t="inlineStr"><is><t>2026-03-25</t></is></c>
      <c r="F2" t="inlineStr"><is><t>Иванов И.И.; Петров П.П.</t></is></c>
      <c r="G2" t="inlineStr"><is><t>Финансы</t></is></c>
    </row>
  </sheetData>
</worksheet>
"""
    content_types_xml = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>
"""
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return data.getvalue()


class MSProjectImportSmokeTest(unittest.TestCase):
    def test_parse_mspdi_xml_smoke(self):
        xml_payload = """<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Tasks>
    <Task>
      <UID>1</UID>
      <OutlineLevel>1</OutlineLevel>
      <Name>Top</Name>
      <Start>2026-03-10T09:00:00</Start>
      <Finish>2026-03-12T18:00:00</Finish>
      <PercentComplete>50</PercentComplete>
      <Priority>600</Priority>
    </Task>
    <Task>
      <UID>2</UID>
      <OutlineLevel>2</OutlineLevel>
      <Name>Child</Name>
      <Start>2026-03-11T09:00:00</Start>
      <Finish>2026-03-12T18:00:00</Finish>
      <PercentComplete>0</PercentComplete>
      <Priority>500</Priority>
    </Task>
  </Tasks>
</Project>
"""
        parsed = parse_ms_project_content(xml_payload.encode("utf-8"), filename="plan.xml")
        self.assertEqual(len(parsed.tasks), 2)
        self.assertEqual(parsed.tasks[1].parent_uid, "1")

    def test_parse_xlsx_smoke(self):
        parsed = parse_ms_project_content(_xlsx_with_tasks(), filename="plan.xlsx")
        self.assertEqual(len(parsed.tasks), 2)
        self.assertEqual(parsed.tasks[0].title, "Root task")
        self.assertEqual(parsed.tasks[1].parent_uid, "10")
        self.assertEqual(parsed.tasks[0].progress_percent, 60)

    def test_parse_xlsx_department_structure(self):
        parsed = parse_ms_project_content(_xlsx_with_department_structure(), filename="plan.xlsx")
        self.assertEqual(len(parsed.tasks), 1)
        task = parsed.tasks[0]
        self.assertEqual(task.title, "Внедрить отчётность")
        self.assertEqual(task.department, "ИТ")
        self.assertEqual(task.bureau, "Бюро 1")
        self.assertEqual(task.task_kind, "Проектная")
        self.assertEqual(task.assignee_hint, "Иванов И.И.")
        self.assertEqual(task.customer, "Финансы")
        self.assertEqual(task.end_date.isoformat(), "2026-03-25")

    def test_inspect_xlsx_precheck(self):
        precheck = inspect_import_file(_xlsx_with_department_structure(), filename="plan.xlsx")
        self.assertEqual(precheck.file_type, "xlsx")
        self.assertTrue(precheck.can_start_ai)
        self.assertIn("Наименование", precheck.recognized_columns)
        self.assertIn("Срок", precheck.recognized_columns)
        self.assertIn("Исполнитель", precheck.recognized_columns)

    def test_inspect_xlsx_precheck_accepts_english_title_alias(self):
        precheck = inspect_import_file(_xlsx_with_tasks(), filename="plan.xlsx")
        self.assertTrue(precheck.can_start_ai)
        self.assertIn("Наименование", precheck.recognized_columns)


if __name__ == "__main__":
    unittest.main()
