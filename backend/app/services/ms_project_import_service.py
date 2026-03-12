from __future__ import annotations

from pathlib import Path
import io
import tempfile
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from math import ceil


_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


@dataclass
class ParsedMSProjectTask:
    uid: str
    outline_number: str | None
    title: str
    description: str | None
    start_date: date | None
    end_date: date | None
    progress_percent: int
    priority: str
    estimated_hours: int | None
    parent_uid: str | None
    department: str | None = None
    bureau: str | None = None
    task_kind: str | None = None
    assignee_hint: str | None = None
    assignee_hints: list[str] = field(default_factory=list)
    customer: str | None = None


@dataclass
class MSProjectParseResult:
    tasks: list[ParsedMSProjectTask]
    skipped_count: int


@dataclass
class ImportPrecheckResult:
    file_type: str
    detected_headers: list[str] = field(default_factory=list)
    recognized_columns: list[str] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    can_start_ai: bool = True


def _tag_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _find_child_text(node: ET.Element, name: str) -> str | None:
    for child in node:
        if _tag_name(child.tag) == name:
            value = (child.text or "").strip()
            return value or None
    return None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _normalize_priority(value: str | None) -> str:
    if not value:
        return "medium"
    lowered = value.strip().lower()
    if lowered in {"low", "низкий"}:
        return "low"
    if lowered in {"medium", "средний", "normal"}:
        return "medium"
    if lowered in {"high", "высокий"}:
        return "high"
    if lowered in {"critical", "критический"}:
        return "critical"
    try:
        numeric = int(value)
    except ValueError:
        return "medium"
    if numeric <= 300:
        return "low"
    if numeric <= 500:
        return "medium"
    if numeric <= 750:
        return "high"
    return "critical"


def _parse_duration_hours(value: str | None) -> int | None:
    if not value:
        return None
    match = _DURATION_RE.match(value)
    if not match:
        return None

    days = int(match.group("days") or 0)
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    seconds = int(match.group("seconds") or 0)

    total_hours = (days * 24) + hours + (minutes / 60) + (seconds / 3600)
    if total_hours <= 0:
        return None
    return ceil(total_hours)


def _clamp_progress(value: str | None) -> int:
    if not value:
        return 0
    try:
        numeric = int(float(value))
    except ValueError:
        return 0
    return max(0, min(100, numeric))


def _column_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref.upper() if "A" <= ch <= "Z")
    if not letters:
        return 0
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx


def _sheet_header_normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9а-я]+", "_", value.strip().lower()).strip("_")


def _parse_int(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.strip().replace(",", ".")
    if not cleaned:
        return None
    try:
        return int(float(cleaned))
    except ValueError:
        return None


def _parse_sheet_date(value: str | None) -> date | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    iso_dt = _parse_datetime(raw)
    if iso_dt:
        return iso_dt.date()
    numeric = _parse_int(raw)
    if numeric is not None and 1 <= numeric <= 100000:
        # Excel serial dates: day 1 is 1899-12-31, with 1900 leap-year bug offset.
        try:
            return date(1899, 12, 30) + timedelta(days=numeric)
        except Exception:
            return None
    return None


def _normalize_assignee_hint(value: str | None) -> str | None:
    hints = _normalize_assignee_hints(value)
    return hints[0] if hints else None


def _normalize_assignee_hints(value: str | None) -> list[str]:
    if not value:
        return []
    raw = re.sub(r"\s+", " ", value).strip(" ;,")
    if not raw:
        return []
    tokens = [part.strip() for part in re.split(r"[;,/\n]|(?:\s+и\s+)", raw) if part and part.strip()]
    normalized: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if "@" in token:
            value = token.lower()
        else:
            match = re.search(r"([А-ЯЁA-Z][а-яёa-z-]+)\s+([А-ЯЁA-Z])\.?\s*([А-ЯЁA-Z])\.?", token)
            if match:
                surname = match.group(1)
                i1 = match.group(2).upper()
                i2 = match.group(3).upper()
                value = f"{surname} {i1}.{i2}."
            else:
                value = token[:255]
        key = value.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(value)
    return normalized


_XLSX_COLUMN_ALIASES: dict[str, tuple[str, set[str]]] = {
    "uid": ("UID", {"uid", "id", "task_id", "task_uid"}),
    "title": ("Наименование", {"name", "title", "task", "task_name", "задача", "название", "наименование"}),
    "description": ("Описание", {"description", "notes", "comment", "описание", "комментарий"}),
    "start_date": ("Дата начала", {"start", "start_date", "date_start", "начало", "дата_начала"}),
    "end_date": ("Срок", {"finish", "end", "end_date", "deadline", "дедлайн", "срок", "дата_окончания"}),
    "progress": ("Прогресс", {"percent_complete", "progress", "progress_percent", "процент", "прогресс"}),
    "priority": ("Приоритет", {"priority", "priority_level", "приоритет"}),
    "estimated_hours": ("Трудоёмкость", {"estimated_hours", "duration_hours", "hours", "часы", "оценка_часы"}),
    "parent_uid": ("Родитель", {"parent_uid", "parent_id", "parent", "родитель", "родитель_uid"}),
    "outline_number": ("WBS / номер", {"outline_number", "wbs", "outline", "иерархия"}),
    "department": ("Отдел", {"department", "dept", "отдел"}),
    "bureau": ("Бюро", {"bureau", "бюро"}),
    "task_kind": ("Вид задачи", {"task_type", "type", "вид", "вид_задачи"}),
    "assignee": ("Исполнитель", {"assignee", "executor", "responsible", "исполнитель", "ответственный"}),
    "customer": ("Заказчик", {"customer", "client", "заказчик"}),
}

_XLSX_RECOMMENDED_FIELDS = ("title", "end_date", "assignee", "customer", "task_kind")


def _read_xlsx_rows(content: bytes) -> list[dict[int, str]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except Exception:
        raise ValueError("Файл .xlsx поврежден или не является валидным ZIP-архивом")

    with archive:
        names = set(archive.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("XLSX не содержит xl/workbook.xml")

        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.iter():
                if _tag_name(si.tag) != "si":
                    continue
                chunks: list[str] = []
                for node in si.iter():
                    if _tag_name(node.tag) == "t" and node.text:
                        chunks.append(node.text)
                shared_strings.append("".join(chunks))

        sheet_names = sorted(
            name
            for name in names
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        if not sheet_names:
            raise ValueError("XLSX не содержит листов с задачами")

        rows: list[dict[int, str]] = []
        for sheet_name in sheet_names:
            root = ET.fromstring(archive.read(sheet_name))
            for row in root.iter():
                if _tag_name(row.tag) != "row":
                    continue
                row_cells: dict[int, str] = {}
                for cell in row:
                    if _tag_name(cell.tag) != "c":
                        continue
                    ref = cell.attrib.get("r", "")
                    col = _column_index(ref)
                    if col <= 0:
                        continue
                    cell_type = cell.attrib.get("t")
                    value_text = ""
                    if cell_type == "inlineStr":
                        for node in cell.iter():
                            if _tag_name(node.tag) == "t" and node.text:
                                value_text += node.text
                    else:
                        raw = ""
                        for node in cell:
                            if _tag_name(node.tag) == "v" and node.text:
                                raw = node.text.strip()
                                break
                        if cell_type == "s":
                            try:
                                s_idx = int(raw)
                                value_text = shared_strings[s_idx] if 0 <= s_idx < len(shared_strings) else ""
                            except ValueError:
                                value_text = raw
                        else:
                            value_text = raw
                    value_text = value_text.strip()
                    if value_text:
                        row_cells[col] = value_text
                if row_cells:
                    rows.append(row_cells)
        if not rows:
            raise ValueError("XLSX не содержит строк с данными")
        return rows


def _build_xlsx_header_map(rows: list[dict[int, str]]) -> tuple[list[str], dict[int, str]]:
    header_row = rows[0]
    detected_headers = [value.strip() for _, value in sorted(header_row.items()) if value.strip()]
    header_map: dict[int, str] = {
        col: _sheet_header_normalize(value)
        for col, value in header_row.items()
        if value.strip()
    }
    if not header_map:
        raise ValueError("XLSX не содержит заголовков колонок")
    return detected_headers, header_map


def inspect_import_file(content: bytes, filename: str | None = None) -> ImportPrecheckResult:
    lower_name = (filename or "").strip().lower()
    is_xlsx = lower_name.endswith(".xlsx")
    if not is_xlsx and content.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                is_xlsx = "xl/workbook.xml" in archive.namelist()
        except Exception:
            is_xlsx = False

    if is_xlsx:
        try:
            rows = _read_xlsx_rows(content)
            detected_headers, header_map = _build_xlsx_header_map(rows)
        except ValueError as exc:
            return ImportPrecheckResult(
                file_type="xlsx",
                warnings=[str(exc)],
                can_start_ai=False,
            )

        normalized_headers = set(header_map.values())
        recognized_columns: list[str] = []
        missing_columns: list[str] = []
        for field_key, (label, aliases) in _XLSX_COLUMN_ALIASES.items():
            if normalized_headers & aliases:
                recognized_columns.append(label)
            elif field_key in _XLSX_RECOMMENDED_FIELDS:
                missing_columns.append(label)

        warnings: list[str] = []
        if "Наименование" not in recognized_columns:
            warnings.append("Не найдена ключевая колонка с названием задачи. Нужна, например, `Наименование` или `Название`.")
        if "Срок" not in recognized_columns:
            warnings.append("Колонка дедлайна не распознана. Лучше добавить `Срок` или `Дедлайн`.")
        if "Исполнитель" not in recognized_columns:
            warnings.append("Колонка исполнителя не распознана. Тогда ИИ не сможет аккуратно привязать людей к задачам.")
        if len(rows) <= 1:
            warnings.append("В файле есть только заголовок без строк с задачами.")

        return ImportPrecheckResult(
            file_type="xlsx",
            detected_headers=detected_headers,
            recognized_columns=recognized_columns,
            missing_columns=missing_columns,
            warnings=warnings,
            can_start_ai="Наименование" in recognized_columns and len(rows) > 1,
        )

    if lower_name.endswith(".xml"):
        return ImportPrecheckResult(
            file_type="xml",
            warnings=["XML/MSPDI выглядит подходящим для импорта структуры задач."],
            can_start_ai=True,
        )

    if lower_name.endswith(".mpp"):
        return ImportPrecheckResult(
            file_type="mpp",
            warnings=["MPP поддерживается, но при спорной структуре надёжнее выгрузить XML/MSPDI."],
            can_start_ai=True,
        )

    return ImportPrecheckResult(
        file_type="generic",
        warnings=["Для задач лучше всего работают XML/MSPDI, MPP или XLSX с явными колонками."],
        can_start_ai=True,
    )


def _find_project_root(root: ET.Element) -> ET.Element:
    if _tag_name(root.tag) == "Project":
        return root
    for node in root.iter():
        if _tag_name(node.tag) == "Project":
            return node
    raise ValueError("MS Project XML root <Project> not found")


def _to_python_date(value) -> date | None:
    if value is None:
        return None
    # java.util.Date from JPype
    try:
        millis = int(value.getTime())
        return datetime.fromtimestamp(millis / 1000, tz=timezone.utc).date()
    except Exception:
        return None


def _parse_ms_project_mpp(content: bytes) -> MSProjectParseResult:
    try:
        import jpype
        import mpxj  # type: ignore
    except Exception as exc:
        raise ValueError(
            "Прямая обработка .mpp недоступна: не установлены зависимости JPype1/mpxj."
        ) from exc

    try:
        if not jpype.isJVMStarted():
            jpype.startJVM(classpath=mpxj.getClassPath())
    except Exception as exc:
        raise ValueError(
            "Прямая обработка .mpp недоступна: JVM не запущена (установите JRE в backend-контейнер)."
        ) from exc

    try:
        reader_cls = jpype.JClass("net.sf.mpxj.reader.UniversalProjectReader")
        reader = reader_cls()
    except Exception as exc:
        raise ValueError("Не удалось инициализировать MPXJ reader для .mpp") from exc

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mpp") as temp_file:
        temp_file.write(content)
        temp_path = temp_file.name

    try:
        project = reader.read(temp_path)
        if project is None:
            raise ValueError("MPXJ не смог прочитать .mpp файл")

        parsed_tasks: list[ParsedMSProjectTask] = []
        skipped_count = 0
        for task in project.getTasks():
            if task is None:
                skipped_count += 1
                continue
            try:
                title = str(task.getName() or "").strip()
            except Exception:
                title = ""
            if not title:
                skipped_count += 1
                continue

            try:
                uid_val = task.getUniqueID()
                uid = str(uid_val) if uid_val is not None else None
            except Exception:
                uid = None
            if not uid:
                skipped_count += 1
                continue

            try:
                outline = task.getOutlineNumber()
                outline_number = str(outline) if outline is not None else None
            except Exception:
                outline_number = None

            try:
                notes_raw = task.getNotes()
                description = str(notes_raw).strip() if notes_raw else None
            except Exception:
                description = None

            start_date = _to_python_date(task.getStart())
            end_date = _to_python_date(task.getFinish())
            if start_date and end_date and end_date < start_date:
                end_date = start_date

            try:
                pct = task.getPercentageComplete()
                progress_percent = _clamp_progress(str(pct) if pct is not None else None)
            except Exception:
                progress_percent = 0

            try:
                priority = _normalize_priority(str(task.getPriority()) if task.getPriority() is not None else None)
            except Exception:
                priority = "medium"

            estimated_hours = None
            try:
                duration = task.getDuration()
                if duration is not None:
                    dur_val = duration.getDuration()
                    if dur_val is not None:
                        estimated_hours = max(1, ceil(float(dur_val)))
            except Exception:
                estimated_hours = None

            parent_uid = None
            try:
                parent = task.getParentTask()
                if parent is not None and parent.getUniqueID() is not None:
                    parent_uid = str(parent.getUniqueID())
            except Exception:
                parent_uid = None

                parsed_tasks.append(
                    ParsedMSProjectTask(
                    uid=uid,
                    outline_number=outline_number,
                    title=title,
                    description=description,
                    start_date=start_date,
                    end_date=end_date,
                    progress_percent=progress_percent,
                    priority=priority,
                    estimated_hours=estimated_hours,
                    parent_uid=parent_uid,
                    department=None,
                    bureau=None,
                        task_kind=None,
                        assignee_hint=None,
                        assignee_hints=[],
                        customer=None,
                    )
                )
        return MSProjectParseResult(tasks=parsed_tasks, skipped_count=skipped_count)
    finally:
        Path(temp_path).unlink(missing_ok=True)


def _parse_ms_project_xlsx(content: bytes) -> MSProjectParseResult:
    rows = _read_xlsx_rows(content)
    _, header_map = _build_xlsx_header_map(rows)

    def read(row: dict[int, str], aliases: set[str]) -> str | None:
        for col, normalized in header_map.items():
            if normalized in aliases:
                value = row.get(col)
                if value is not None and value.strip():
                    return value.strip()
        return None

    uid_aliases = _XLSX_COLUMN_ALIASES["uid"][1]
    title_aliases = _XLSX_COLUMN_ALIASES["title"][1]
    desc_aliases = _XLSX_COLUMN_ALIASES["description"][1]
    start_aliases = _XLSX_COLUMN_ALIASES["start_date"][1]
    end_aliases = _XLSX_COLUMN_ALIASES["end_date"][1]
    progress_aliases = _XLSX_COLUMN_ALIASES["progress"][1]
    priority_aliases = _XLSX_COLUMN_ALIASES["priority"][1]
    estimate_aliases = _XLSX_COLUMN_ALIASES["estimated_hours"][1]
    parent_aliases = _XLSX_COLUMN_ALIASES["parent_uid"][1]
    outline_aliases = _XLSX_COLUMN_ALIASES["outline_number"][1]
    department_aliases = _XLSX_COLUMN_ALIASES["department"][1]
    bureau_aliases = _XLSX_COLUMN_ALIASES["bureau"][1]
    task_kind_aliases = _XLSX_COLUMN_ALIASES["task_kind"][1]
    assignee_aliases = _XLSX_COLUMN_ALIASES["assignee"][1]
    customer_aliases = _XLSX_COLUMN_ALIASES["customer"][1]

    parsed_tasks: list[ParsedMSProjectTask] = []
    skipped_count = 0
    for idx, row in enumerate(rows[1:], start=2):
        title = read(row, title_aliases)
        if not title:
            skipped_count += 1
            continue
        uid = read(row, uid_aliases) or f"row-{idx}"
        progress = _clamp_progress(read(row, progress_aliases))
        estimated_hours = _parse_int(read(row, estimate_aliases))
        if estimated_hours is not None and estimated_hours <= 0:
            estimated_hours = None
        raw_assignee = read(row, assignee_aliases)
        assignee_hints = _normalize_assignee_hints(raw_assignee)
        parsed_tasks.append(
            ParsedMSProjectTask(
                uid=uid,
                outline_number=read(row, outline_aliases),
                title=title,
                description=read(row, desc_aliases),
                start_date=_parse_sheet_date(read(row, start_aliases)),
                end_date=_parse_sheet_date(read(row, end_aliases)),
                progress_percent=progress,
                priority=_normalize_priority(read(row, priority_aliases)),
                estimated_hours=estimated_hours,
                parent_uid=read(row, parent_aliases),
                department=read(row, department_aliases),
                bureau=read(row, bureau_aliases),
                task_kind=read(row, task_kind_aliases),
                assignee_hint=assignee_hints[0] if assignee_hints else None,
                assignee_hints=assignee_hints,
                customer=read(row, customer_aliases),
            )
        )

    return MSProjectParseResult(tasks=parsed_tasks, skipped_count=skipped_count)


def parse_ms_project_xml(content: bytes) -> MSProjectParseResult:
    stripped = content.lstrip()
    # Generic non-XML payload guard for clearer UX than raw parser error.
    if not stripped.startswith((b"<", b"\xef\xbb\xbf<", b"\xff\xfe<", b"\xfe\xff<")):
        raise ValueError(
            "Файл не похож на XML/MSPDI. Загрузите XML-экспорт MS Project, .mpp или таблицу .xlsx."
        )

    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML: {exc}") from exc

    project_root = _find_project_root(root)

    tasks_container = None
    for child in project_root:
        if _tag_name(child.tag) == "Tasks":
            tasks_container = child
            break
    if tasks_container is None:
        raise ValueError("MS Project XML does not contain <Tasks>")

    parsed_tasks: list[ParsedMSProjectTask] = []
    skipped_count = 0
    level_stack: dict[int, str] = {}

    for node in tasks_container:
        if _tag_name(node.tag) != "Task":
            continue

        uid = _find_child_text(node, "UID")
        title = _find_child_text(node, "Name")
        if not uid or not title:
            skipped_count += 1
            continue

        outline_level_raw = _find_child_text(node, "OutlineLevel")
        try:
            outline_level = int(outline_level_raw) if outline_level_raw else 1
        except ValueError:
            outline_level = 1

        parent_uid = level_stack.get(outline_level - 1) if outline_level > 1 else None

        start_dt = _parse_datetime(_find_child_text(node, "Start"))
        end_dt = _parse_datetime(_find_child_text(node, "Finish"))
        start_date = start_dt.date() if start_dt else None
        end_date = end_dt.date() if end_dt else None
        if start_date and end_date and end_date < start_date:
            end_date = start_date

        progress = _clamp_progress(_find_child_text(node, "PercentComplete"))
        parsed_tasks.append(
            ParsedMSProjectTask(
                uid=uid,
                outline_number=_find_child_text(node, "OutlineNumber"),
                title=title.strip(),
                description=_find_child_text(node, "Notes"),
                start_date=start_date,
                end_date=end_date,
                progress_percent=progress,
                priority=_normalize_priority(_find_child_text(node, "Priority")),
                estimated_hours=_parse_duration_hours(_find_child_text(node, "Duration")),
                parent_uid=parent_uid,
                department=None,
                bureau=None,
                task_kind=None,
                assignee_hint=None,
                assignee_hints=[],
                customer=None,
            )
        )

        level_stack[outline_level] = uid
        for level in list(level_stack.keys()):
            if level > outline_level:
                level_stack.pop(level, None)

    return MSProjectParseResult(tasks=parsed_tasks, skipped_count=skipped_count)


def parse_ms_project_content(content: bytes, filename: str | None = None) -> MSProjectParseResult:
    lower_name = (filename or "").lower()
    # Legacy MS Project .mpp files are OLE Compound File Binary format.
    is_mpp = lower_name.endswith(".mpp") or content.startswith(b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1")
    if is_mpp:
        return _parse_ms_project_mpp(content)
    is_xlsx = lower_name.endswith(".xlsx")
    if not is_xlsx and content.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                is_xlsx = "xl/workbook.xml" in archive.namelist()
        except Exception:
            is_xlsx = False
    if is_xlsx:
        return _parse_ms_project_xlsx(content)
    return parse_ms_project_xml(content)
