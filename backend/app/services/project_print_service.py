from __future__ import annotations

from datetime import date, timedelta
from html import escape
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.task import Task

_TASK_NUMBER_PART_RE = re.compile(r"\d+|[^\d]+")
_PRIORITY_PRINT_MAP = {
    "critical": "0",
    "high": "1",
    "medium": "2",
    "low": "3",
}


def _task_number_sort_key(task_number: str | None) -> tuple[object, ...]:
    if not task_number:
        return (float("inf"),)
    parts: list[object] = []
    for chunk in _TASK_NUMBER_PART_RE.findall(task_number):
        parts.append(int(chunk) if chunk.isdigit() else chunk.lower())
    return tuple(parts) if parts else (task_number.lower(),)


def _task_sort_key(task: Task) -> tuple[object, ...]:
    # Печатная форма всегда сортируется по номеру задачи (№ п/п в плане),
    # а не по drag-and-drop `order`, чтобы список шёл строго по возрастанию номеров.
    return (_task_number_sort_key(task.task_number), task.title.lower())


def _priority_for_print(priority: str) -> str:
    return _PRIORITY_PRINT_MAP.get(priority, "2")


def _format_one_assignee(user: object) -> str:
    last_name = (getattr(user, "last_name", "") or "").strip()
    first_name = (getattr(user, "first_name", "") or "").strip()
    middle_name = (getattr(user, "middle_name", "") or "").strip()
    if last_name or first_name or middle_name:
        initials = ""
        if first_name:
            initials += f"{first_name[0].upper()}."
        if middle_name:
            initials += f"{middle_name[0].upper()}."
        return " ".join(part for part in [last_name, initials] if part).strip()
    return (getattr(user, "name", "") or "").strip() or "-"


def _format_assignee_html(task: Task) -> str:
    """Готовый (уже экранированный) HTML для ячейки исполнителя.

    Каждое имя экранируется отдельно, между ними — настоящий тег <br>.
    Возвращать сюда сырую строку и потом ещё раз прогонять через escape()
    нельзя — иначе <br> превращается в видимый текст «&lt;br&gt;».
    """
    users = task.assignees
    if not users and task.assignee:
        users = [task.assignee]
    if not users:
        return "-"
    return "<br>".join(escape(_format_one_assignee(u)) for u in users)


def _project_anchor_date(project: Project) -> date:
    return project.start_date or project.end_date or date.today()


def _report_quarter(today: date) -> tuple[int, int]:
    """Вернуть (номер квартала, год) для печатной формы.

    План готовят заранее, поэтому дата «смотрит вперёд» на 15 дней: за 15 дней до
    начала нового квартала форма уже печатает НОВЫЙ квартал. Переход через год
    отрабатывает автоматически (16 декабря + 15 дней → январь → Q1 следующего года).
    """
    anchor = today + timedelta(days=15)
    quarter = ((anchor.month - 1) // 3) + 1
    return quarter, anchor.year


def _quarter_label(today: date | None = None) -> str:
    quarter, year = _report_quarter(today or date.today())
    return f"на {quarter}-й квартал {year}г."


def build_project_tasks_print_html(project: Project, tasks: list[Task]) -> str:
    open_tasks = sorted((task for task in tasks if task.status != "done"), key=_task_sort_key)
    rows_html = "\n".join(
        f"""
        <tr>
          <td class="num">{index}</td>
          <td class="task">{escape(task.title)}</td>
          <td class="priority">{_priority_for_print(task.priority)}</td>
          <td class="assignee">{_format_assignee_html(task)}</td>
        </tr>
        """.strip()
        for index, task in enumerate(open_tasks, start=1)
    )
    if not rows_html:
        rows_html = """
        <tr>
          <td class="num">1</td>
          <td class="task">Открытые задачи отсутствуют</td>
          <td class="priority">-</td>
          <td class="assignee">-</td>
        </tr>
        """.strip()

    project_name = escape(project.name)
    quarter_label = escape(_quarter_label())

    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>План ППО - {project_name}</title>
  <style>
    :root {{
      color-scheme: light;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      background: #fff;
      color: #000;
      font-family: "Times New Roman", Times, serif;
      font-size: 14px;
      line-height: 1.35;
    }}
    .page {{
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 16mm 14mm 18mm;
      background: #fff;
    }}
    .company {{
      font-size: 14px;
      margin-bottom: 18px;
      text-align: center;
    }}
    .approval {{
      width: 78mm;
      margin-left: auto;
      text-align: left;
      margin-bottom: 24px;
    }}
    .approval p {{
      margin: 0 0 6px;
    }}
    .title {{
      text-align: center;
      margin-bottom: 18px;
    }}
    .title h1 {{
      margin: 0 0 6px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }}
    .title p {{
      margin: 0 0 4px;
      font-size: 15px;
    }}
    .table-wrap {{
      margin-top: 18px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }}
    th, td {{
      border: 1px solid #000;
      padding: 8px 7px;
      vertical-align: top;
      word-break: break-word;
    }}
    thead {{
      display: table-header-group;
    }}
    th.task {{
      text-align: center;
    }}
    tfoot {{
      display: table-footer-group;
    }}
    tr, td, th {{
      page-break-inside: avoid;
      break-inside: avoid;
    }}
    th {{
      font-weight: 700;
      text-align: center;
      vertical-align: middle;
    }}
    .num {{
      width: 8%;
      text-align: center;
      vertical-align: middle;
    }}
    .task {{
      width: 64%;
      text-align: left;
    }}
    .priority {{
      width: 10%;
      text-align: center;
      vertical-align: middle;
    }}
    .assignee {{
      width: 18%;
      text-align: center;
      vertical-align: middle;
    }}
    .footer {{
      margin-top: 28px;
    }}
    .sig-line {{
      display: flex;
      align-items: center;
      margin: 0 0 12px;
      font-size: 14px;
    }}
    .sig-role {{
      width: 210px;
      flex-shrink: 0;
    }}
    .sig-space {{
      flex: 1;
      text-align: center;
      letter-spacing: 3px;
      border-bottom: 1px solid #000;
      margin: 0 8px;
      min-width: 60px;
      height: 1.2em;
    }}
    .sig-name {{
      width: 125px;
      text-align: right;
      flex-shrink: 0;
    }}
    @page {{
      size: A4 portrait;
      margin: 12mm;
    }}
    @media screen {{
      body {{
        padding: 24px;
      }}
      .page {{
        box-shadow: 0 0 0 1px #d4d4d8, 0 12px 40px rgba(0, 0, 0, 0.08);
      }}
    }}
    @media print {{
      html, body {{
        background: #fff;
      }}
      body {{
        padding: 0;
      }}
      .page {{
        width: auto;
        min-height: auto;
        margin: 0;
        padding: 0;
        box-shadow: none;
      }}
      .table-wrap, table {{
        page-break-inside: auto;
      }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <div class="company">ПАО «ОДК-Уфимское моторостроительное производственное объединение»</div>

    <div class="approval">
      <p><strong>УТВЕРЖДАЮ</strong></p>
      <p>Директор по информационным технологиям</p>
      <p>К.Р.Хамитов</p>
      <p>________________ «___» _____________</p>
    </div>

    <div class="title">
      <h1>ПЛАН МЕРОПРИЯТИЙ</h1>
      <p>по доработке информационного обеспечения системы планирования</p>
      <p>{quarter_label}</p>
    </div>

    <div class="table-wrap">
      <table aria-label="План ППО">
        <thead>
          <tr>
            <th class="num">№ п/п</th>
            <th class="task">мероприятие</th>
            <th class="priority">приоритет</th>
            <th class="assignee">исполнитель</th>
          </tr>
        </thead>
        <tbody>
          {rows_html}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <div class="sig-line">
        <span class="sig-role">Руководитель ЦК ИНФОР</span>
        <span class="sig-space"></span>
        <span class="sig-name">Рахимов А.Ф.</span>
      </div>
      <div class="sig-line">
        <span class="sig-role">Начальник ППО</span>
        <span class="sig-space"></span>
        <span class="sig-name">Подоприхин В.Н.</span>
      </div>
      <div class="sig-line">
        <span class="sig-role">ВРИО начальника ОРИТ</span>
        <span class="sig-space"></span>
        <span class="sig-name">Баранова М.К.</span>
      </div>
      <div class="sig-line">
        <span class="sig-role">Начальник ОАСУП</span>
        <span class="sig-space"></span>
        <span class="sig-name">Целоусова Н.С.</span>
      </div>
    </div>
  </div>
  <script>
    window.addEventListener('load', () => {{
      window.print();
    }});
  </script>
</body>
</html>
"""
