import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from app.core.config import settings


def _max_drafts_limit() -> int:
    value = int(getattr(settings, "AI_MAX_DRAFTS", 2000) or 2000)
    return max(50, min(5000, value))


def _xml_local_name(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _extract_docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        document_xml = archive.read("word/document.xml")
    root = ET.fromstring(document_xml)
    paragraphs: list[str] = []
    for node in root.iter():
        if _xml_local_name(node.tag) != "p":
            continue
        parts: list[str] = []
        for child in node.iter():
            if _xml_local_name(child.tag) == "t" and child.text:
                parts.append(child.text)
        line = "".join(parts).strip()
        if line:
            paragraphs.append(line)
    return "\n".join(paragraphs).strip()


def _extract_pptx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        slide_names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
        lines: list[str] = []
        for name in slide_names:
            slide_xml = archive.read(name)
            root = ET.fromstring(slide_xml)
            parts: list[str] = []
            for node in root.iter():
                if _xml_local_name(node.tag) == "t" and node.text:
                    parts.append(node.text.strip())
            line = " ".join([p for p in parts if p]).strip()
            if line:
                lines.append(line)
    return "\n".join(lines).strip()


def _column_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref.upper() if "A" <= ch <= "Z")
    if not letters:
        return 0
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return value


def _extract_xlsx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for si in root.iter():
                if _xml_local_name(si.tag) != "si":
                    continue
                text_parts: list[str] = []
                for node in si.iter():
                    if _xml_local_name(node.tag) == "t" and node.text:
                        text_parts.append(node.text)
                shared_strings.append("".join(text_parts))

        sheet_names = sorted(
            name
            for name in archive.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        lines: list[str] = []
        for sheet_name in sheet_names:
            root = ET.fromstring(archive.read(sheet_name))
            for row in root.iter():
                if _xml_local_name(row.tag) != "row":
                    continue
                row_cells: dict[int, str] = {}
                for cell in row:
                    if _xml_local_name(cell.tag) != "c":
                        continue
                    ref = cell.attrib.get("r", "")
                    idx = _column_index(ref)
                    cell_type = cell.attrib.get("t")
                    value_text = ""
                    if cell_type == "inlineStr":
                        for node in cell.iter():
                            if _xml_local_name(node.tag) == "t" and node.text:
                                value_text += node.text
                    else:
                        raw = ""
                        for node in cell:
                            if _xml_local_name(node.tag) == "v" and node.text:
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
                    if idx > 0 and value_text:
                        row_cells[idx] = value_text
                if row_cells:
                    lines.append(" | ".join(row_cells[col] for col in sorted(row_cells)))
    return "\n".join(lines).strip()


def _extract_xls_text(path: Path) -> str:
    try:
        import xlrd  # type: ignore
    except Exception as exc:
        raise ValueError("Для обработки .xls установите зависимость xlrd.") from exc

    workbook = xlrd.open_workbook(str(path), on_demand=True)
    lines: list[str] = []
    for sheet_name in workbook.sheet_names():
        sheet = workbook.sheet_by_name(sheet_name)
        for row_idx in range(sheet.nrows):
            values: list[str] = []
            for col_idx in range(sheet.ncols):
                cell = sheet.cell_value(row_idx, col_idx)
                text = str(cell).strip()
                if text:
                    values.append(text)
            if values:
                lines.append(" | ".join(values))
    workbook.release_resources()
    return "\n".join(lines).strip()


def _run_text_extractor_command(command: list[str], *, timeout_sec: int = 60) -> tuple[bool, str, str]:
    try:
        proc = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_sec,
        )
    except FileNotFoundError:
        return False, "", "command_not_found"
    except subprocess.TimeoutExpired:
        return False, "", "timeout"
    output = (proc.stdout or "").strip()
    error = (proc.stderr or "").strip()
    if proc.returncode == 0 and output:
        return True, output, ""
    err_preview = error or output or f"exit_code={proc.returncode}"
    return False, "", err_preview[:300]


def _extract_doc_text_with_fallbacks(path: Path) -> str:
    errors: list[str] = []

    # 1) antiword
    ok, text, err = _run_text_extractor_command(["antiword", "-m", "UTF-8", str(path)])
    if ok:
        return text
    errors.append(f"antiword: {err}")

    # 2) catdoc
    ok, text, err = _run_text_extractor_command(["catdoc", str(path)])
    if ok:
        return text
    errors.append(f"catdoc: {err}")

    # 3) soffice --headless convert to txt
    if shutil.which("soffice"):
        with tempfile.TemporaryDirectory(prefix="plannerbro-doc-") as tmp_dir:
            ok, _, err = _run_text_extractor_command(
                [
                    "soffice",
                    "--headless",
                    "--convert-to",
                    "txt:Text",
                    "--outdir",
                    tmp_dir,
                    str(path),
                ],
                timeout_sec=120,
            )
            if ok:
                candidate = Path(tmp_dir) / f"{path.stem}.txt"
                if candidate.exists():
                    extracted = candidate.read_text(encoding="utf-8", errors="ignore").strip()
                    if extracted:
                        return extracted
                errors.append("soffice: converted file is empty or missing")
            else:
                errors.append(f"soffice: {err}")
    else:
        errors.append("soffice: command_not_found")

    joined = " | ".join(errors)
    raise ValueError(
        "Could not parse legacy .doc file. Tried antiword -> catdoc -> soffice --headless. "
        f"Details: {joined}"
    )


def extract_text_for_ai(storage_path: str, content_type: str | None = None) -> str:
    path = Path(storage_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {storage_path}")

    lowered = path.suffix.lower()
    type_hint = (content_type or "").lower()

    if lowered == ".pdf" or "pdf" in type_hint:
        reader = PdfReader(str(path))
        parts: list[str] = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
        text = "\n".join(parts).strip()
    elif lowered == ".doc" or "msword" in type_hint:
        # Legacy Word .doc parsing with toolchain fallback for Linux/VPS runtime.
        text = _extract_doc_text_with_fallbacks(path)
    elif lowered == ".docx":
        text = _extract_docx_text(path)
    elif lowered == ".pptx":
        text = _extract_pptx_text(path)
    elif lowered == ".xlsx":
        text = _extract_xlsx_text(path)
    elif lowered == ".xls":
        text = _extract_xls_text(path)
    else:
        text = path.read_text(encoding="utf-8", errors="ignore").strip()

    if not text:
        raise ValueError("Could not extract text from file")
    return text


def extract_text_for_ai_bytes(content: bytes, filename: str, content_type: str | None = None) -> str:
    suffix = Path(filename or "upload.bin").suffix or ".bin"
    fd, tmp_path = tempfile.mkstemp(prefix="plannerbro-ai-", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as fp:
            fp.write(content)
        return extract_text_for_ai(tmp_path, content_type)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def _safe_json_loads(content: str) -> dict[str, Any]:
    payload = content.strip()
    if payload.startswith("```"):
        payload = payload.strip("`")
        if payload.lower().startswith("json"):
            payload = payload[4:].strip()
    start = payload.find("{")
    end = payload.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM did not return JSON object")
    json_str = payload[start : end + 1]
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        # LLM sometimes generates malformed JSON for large responses.
        # Try to recover by finding the last complete task entry in the tasks array.
        tasks_start = json_str.find('"tasks"')
        if tasks_start == -1:
            raise ValueError("LLM returned malformed JSON without tasks key")
        arr_start = json_str.find("[", tasks_start)
        if arr_start == -1:
            raise ValueError("LLM returned malformed JSON: tasks is not an array")
        # Walk back from the end to find the last '}' that closes a task object,
        # then close the array and outer object.
        pos = len(json_str) - 1
        while pos > arr_start:
            if json_str[pos] == "}":
                truncated = json_str[:pos + 1] + "]}"
                try:
                    return json.loads(truncated)
                except json.JSONDecodeError:
                    pass
            pos -= 1
        raise ValueError("LLM returned malformed JSON: could not recover any tasks")


def _normalize_priority(value: str | None) -> str:
    allowed = {"low", "medium", "high", "critical"}
    if not value:
        return "medium"
    val = value.strip().lower()
    return val if val in allowed else "medium"


def _normalize_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value.strip())
    except Exception:
        return None


def _normalize_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    if parsed < min_value:
        return min_value
    if parsed > max_value:
        return max_value
    return parsed


def _normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _quote_exists_in_text(quote: str, source_text: str) -> bool:
    if not quote.strip():
        return False
    normalized_quote = _normalize_spaces(quote)
    normalized_text = _normalize_spaces(source_text)
    return normalized_quote in normalized_text


def _looks_like_document_header(title: str, project_name: str) -> bool:
    t = _normalize_spaces(title)
    p = _normalize_spaces(project_name)
    if not t:
        return True
    if len(t) < 8:
        return True
    if t == p or t in p or p in t:
        return True
    bad_markers = (
        "план мероприятий",
        "план-график",
        "приказ",
        "протокол",
        "служебная записка",
        "решение",
        "приложение",
    )
    return any(marker in t for marker in bad_markers)


def _resolve_ai_provider() -> tuple[str, str, str, str]:
    if settings.DEEPSEEK_API_KEY:
        return (
            "deepseek",
            settings.DEEPSEEK_API_KEY,
            settings.DEEPSEEK_BASE_URL.rstrip("/"),
            settings.DEEPSEEK_MODEL,
        )
    if settings.OPENROUTER_API_KEY:
        return (
            "openrouter",
            settings.OPENROUTER_API_KEY,
            settings.OPENROUTER_BASE_URL.rstrip("/"),
            settings.OPENROUTER_MODEL,
        )
    raise ValueError("AI provider is not configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY)")


def _extract_tasks_from_fixed_plan_table(source_text: str) -> list[dict[str, Any]]:
    # Expected fixed yearly table format from "ПЛАН МЕРОПРИЯТИЙ" .doc documents
    lines = source_text.splitlines()
    table_lines = [line for line in lines if line.strip().startswith("|") and line.strip().endswith("|")]
    if len(table_lines) < 10:
        return []

    rows: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for line in table_lines:
        parts = [p.strip() for p in line.strip().split("|")[1:-1]]
        if len(parts) < 6:
            continue
        task_no = parts[1]
        activity = parts[2]
        priority = parts[3]
        assignee = parts[4]
        comment = parts[5]

        if "мероприятие" in _normalize_spaces(activity):
            continue

        starts_new = bool(re.fullmatch(r"\d{1,3}(?:[.)]|(?:\.\d+)+)?", task_no))
        if not starts_new and not task_no:
            # Some antiword table exports shift numbering into the activity cell.
            activity_match = re.match(r"^\s*(\d{1,3}(?:[.)]|(?:\.\d+)+))\s+(.+)$", activity)
            if activity_match:
                task_no = activity_match.group(1)
                activity = activity_match.group(2).strip()
                starts_new = True
        if starts_new:
            if current and current.get("description"):
                rows.append(current)
            current = {
                "task_no": task_no,
                "description": activity,
                "priority_raw": priority,
                "assignee_hint": assignee or None,
                "comment": comment or None,
            }
            continue

        if not current:
            continue
        if activity:
            current["description"] = f"{current['description']} {activity}".strip()
        if not current.get("priority_raw") and priority:
            current["priority_raw"] = priority
        if not current.get("assignee_hint") and assignee:
            current["assignee_hint"] = assignee
        if comment:
            current["comment"] = (f"{current.get('comment', '')} {comment}").strip()

    if current and current.get("description"):
        rows.append(current)

    tasks: list[dict[str, Any]] = []
    for row in rows:
        desc = " ".join(str(row.get("description", "")).split()).strip()
        if not desc or len(desc) < 12:
            continue
        task_no = str(row.get("task_no") or "").strip()
        title = f"{task_no} {desc}".strip()[:500] if task_no else desc[:500]

        priority_map = {"0": "low", "1": "critical", "2": "high", "3": "medium"}
        p_raw = str(row.get("priority_raw") or "").strip()
        priority = priority_map.get(p_raw, "medium")

        comment = " ".join(str(row.get("comment", "")).split()).strip()
        description = desc[:5000]
        quote = desc[:500]
        payload = dict(row)
        if comment:
            payload["comment"] = comment
        tasks.append(
            {
                "title": title,
                "description": description,
                "priority": priority,
                "end_date": None,
                "estimated_hours": None,
                "assignee_hint": row.get("assignee_hint"),
                "progress_percent": 0,
                "next_step": None,
                "source_quote": quote,
                "confidence": 95,
                "raw_payload": payload,
            }
        )

    return tasks[:_max_drafts_limit()]


def _extract_tasks_from_numbered_lines(source_text: str) -> list[dict[str, Any]]:
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    rows: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for raw_line in lines:
        line = " ".join(raw_line.strip("|").split()).strip()
        if not line:
            continue
        lowered = _normalize_spaces(line)
        if any(marker in lowered for marker in ("№", "мероприятие", "ответственный", "приоритет")):
            continue

        match = re.match(r"^(\d{1,3}(?:\.\d+)*)(?:[.])? (.+)$", line)
        if match:
            task_no = match.group(1).strip()
            # Guard against dates like 12.03.2026 being parsed as task numbers.
            if any(len(part) > 3 for part in task_no.split(".")):
                match = None
            else:
                description = match.group(2).strip()
                if current and current.get("description"):
                    rows.append(current)
                current = {
                    "task_no": task_no,
                    "description": description,
                }
                continue

        if not current:
            continue
        if len(lowered) < 3:
            continue
        if lowered.startswith(("итого", "примечание", "утверждаю")):
            continue
        current["description"] = f"{current['description']} {line}".strip()

    if current and current.get("description"):
        rows.append(current)

    tasks: list[dict[str, Any]] = []
    for row in rows:
        desc = " ".join(str(row.get("description", "")).split()).strip()
        if len(desc) < 8:
            continue
        task_no = str(row.get("task_no") or "").strip()
        title = f"{task_no} {desc}".strip()[:180]
        if len(desc) > 180:
            title = f"{title}..."
        tasks.append(
            {
                "title": title,
                "description": desc[:5000],
                "priority": "medium",
                "end_date": None,
                "estimated_hours": None,
                "assignee_hint": None,
                "progress_percent": 0,
                "next_step": None,
                "source_quote": desc[:500],
                "confidence": 90,
                "raw_payload": row,
            }
        )
    return tasks[:_max_drafts_limit()]


_PPO_SIGNATURE_RE = re.compile(
    r"план\s+мероприятий\s+по\s+доработке\s+информационного\s+обеспечения\s+системы\s+планирования\s+на\s+(?:\d+\s*[-й]*)?\s*квартал\s+20\d{2}\s*г",
    flags=re.IGNORECASE,
)
_PPO_TASK_NO_ONLY_RE = re.compile(r"^(\d{1,3})\.\s*$")
_PPO_TASK_NO_PREFIX_RE = re.compile(r"^(\d{1,3})\.\s+(.+)$")
_PPO_TASK_NO_CELL_RE = re.compile(r"^\s*(\d{1,3})\s*[.)]?\s*$")
_PPO_PRIORITY_RE = re.compile(r"^[0-3]$")
_PPO_FOOTER_MARKERS = (
    "утверждаю",
    "согласовано",
    "начальник",
    "заместитель",
    "подпись",
    "исп.",
    "тел.",
)


def _is_ppo_quarter_plan(source_text: str) -> bool:
    compact = _normalize_spaces(source_text)
    return bool(_PPO_SIGNATURE_RE.search(compact))


def _normalize_ppo_assignee_lines(lines: list[str]) -> str | None:
    merged = " ".join(line.strip().rstrip(",") for line in lines if line and line.strip())
    merged = re.sub(r"\s+", " ", merged).strip(" ,;")
    if not merged:
        return None
    parts = [re.sub(r"\s+", " ", part).strip(" ,;") for part in merged.split(",")]
    cleaned = [part for part in parts if part]
    return ", ".join(cleaned) if cleaned else None


def _extract_ppo_rows_from_table_lines(source_text: str) -> list[dict[str, Any]]:
    table_lines = [line.strip() for line in source_text.splitlines() if line.strip().startswith("|") and line.strip().endswith("|")]
    if len(table_lines) < 8:
        return []

    rows: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    assignee_lines: list[str] = []

    def _flush_current() -> None:
        nonlocal current, assignee_lines
        if not current:
            return
        description = " ".join(str(current.get("description", "")).split()).strip()
        if not description:
            current = None
            assignee_lines = []
            return
        assignee_hint = _normalize_ppo_assignee_lines(assignee_lines)
        priority_raw = str(current.get("priority_raw") or "").strip()
        if priority_raw in {"0", "1", "2", "3"}:
            rows.append(
                {
                    "task_no": current.get("task_no"),
                    "description": description,
                    "priority_raw": priority_raw,
                    "assignee_hint": assignee_hint,
                    "parser": "ppo_quarter_plan",
                }
            )
        current = None
        assignee_lines = []

    for line in table_lines:
        parts = [part.strip() for part in line.split("|")[1:-1]]
        if len(parts) < 4:
            continue

        task_cell = parts[0]
        description_cell = parts[1]
        priority_cell = parts[-2]
        assignee_cell = parts[-1]

        lowered_desc = _normalize_spaces(description_cell)
        if (
            "мероприятие" in lowered_desc
            or lowered_desc == "п/п"
            or lowered_desc in {"", "-"}
            and _normalize_spaces(task_cell) in {"№", ""}
        ):
            continue

        no_match = _PPO_TASK_NO_CELL_RE.match(task_cell)
        task_no = no_match.group(1) if no_match else None
        priority_match = re.search(r"[0-3]", priority_cell or "")
        priority_raw = priority_match.group(0) if priority_match else None

        should_start_new_unnumbered = (
            task_no is None
            and current is not None
            and not current.get("task_no")
            and bool(current.get("priority_raw"))
            and bool(description_cell)
            and priority_raw in {"0", "1", "2", "3"}
        )

        if task_no or should_start_new_unnumbered:
            _flush_current()
            current = {
                "task_no": task_no,
                "description": "",
                "priority_raw": None,
            }

        if current is None:
            if not description_cell:
                continue
            current = {"task_no": None, "description": "", "priority_raw": None}

        if description_cell:
            current["description"] = f"{current['description']} {description_cell}".strip()
        if priority_raw and not current.get("priority_raw"):
            current["priority_raw"] = priority_raw
        if assignee_cell and _normalize_spaces(assignee_cell) not in {"исполн", "итель"}:
            assignee_lines.append(assignee_cell)

    _flush_current()
    return rows


def _extract_tasks_from_ppo_quarter_plan(source_text: str) -> list[dict[str, Any]]:
    if not _is_ppo_quarter_plan(source_text):
        return []

    # Preferred path for legacy .doc extraction where rows look like:
    # |10.|Описание...|  2|ОАСУП |
    rows = _extract_ppo_rows_from_table_lines(source_text)
    if not rows:
        rows = []

    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    if not rows:
        # Fallback path for non-tabular extracted text:
        # description -> priority -> assignee lines.
        body_lines: list[str] = []
        in_body = False
        for raw_line in lines:
            line = " ".join(raw_line.strip("|").split()).strip()
            lowered = _normalize_spaces(line)
            if not in_body and "на " in lowered and "квартал" in lowered and "20" in lowered:
                in_body = True
                continue
            if in_body:
                body_lines.append(line)
        if not body_lines:
            body_lines = [" ".join(line.strip("|").split()).strip() for line in lines]

        description_lines: list[str] = []
        assignee_lines: list[str] = []
        current_task_no: str | None = None
        current_priority_raw: str | None = None
        state = "description"

        def _looks_like_assignee_line(value: str) -> bool:
            stripped = value.strip().rstrip(",")
            if not stripped:
                return False
            if any(ch.isdigit() for ch in stripped):
                return False
            letters = [ch for ch in stripped if ch.isalpha()]
            if not letters:
                return False
            lower_count = sum(1 for ch in letters if ch.islower())
            upper_count = sum(1 for ch in letters if ch.isupper())
            return upper_count >= 2 and lower_count <= 2

        def _flush_line_parsed_current() -> None:
            nonlocal description_lines, assignee_lines, current_priority_raw, current_task_no, state
            description = " ".join(description_lines).strip()
            assignee_hint = _normalize_ppo_assignee_lines(assignee_lines)
            if description and current_priority_raw is not None:
                rows.append(
                    {
                        "task_no": current_task_no,
                        "description": description,
                        "priority_raw": current_priority_raw,
                        "assignee_hint": assignee_hint,
                        "parser": "ppo_quarter_plan",
                    }
                )
            description_lines = []
            assignee_lines = []
            current_task_no = None
            current_priority_raw = None
            state = "description"

        for line in body_lines:
            if not line:
                continue
            lowered = _normalize_spaces(line)
            if any(marker in lowered for marker in _PPO_FOOTER_MARKERS):
                _flush_line_parsed_current()
                break
            if any(
                marker in lowered
                for marker in (
                    "план мероприятий",
                    "по доработке информационного обеспечения",
                    "мероприятие",
                    "приоритет",
                    "исполнитель",
                    "ответственный",
                )
            ):
                continue

            no_only = _PPO_TASK_NO_ONLY_RE.match(line)
            if no_only and state == "description":
                current_task_no = no_only.group(1)
                continue

            if _PPO_PRIORITY_RE.match(line):
                if not description_lines:
                    continue
                current_priority_raw = line
                state = "assignee"
                continue

            if state == "assignee":
                if _looks_like_assignee_line(line):
                    assignee_lines.append(line)
                    continue
                _flush_line_parsed_current()

            no_only = _PPO_TASK_NO_ONLY_RE.match(line)
            if no_only and state == "description":
                current_task_no = no_only.group(1)
                continue

            no_prefix = _PPO_TASK_NO_PREFIX_RE.match(line)
            if no_prefix:
                current_task_no = no_prefix.group(1)
                line = no_prefix.group(2).strip()
            description_lines.append(line)

        _flush_line_parsed_current()

    tasks: list[dict[str, Any]] = []
    priority_map = {"0": "low", "1": "critical", "2": "high", "3": "medium"}
    for row in rows:
        desc = " ".join(str(row.get("description", "")).split()).strip()
        if len(desc) < 12:
            continue
        task_no = str(row.get("task_no") or "").strip()
        title = f"{task_no} {desc}".strip()[:500] if task_no else desc[:500]
        priority_raw = str(row.get("priority_raw") or "").strip()
        priority = priority_map.get(priority_raw, "medium")
        tasks.append(
            {
                "title": title,
                "description": desc[:5000],
                "priority": priority,
                "end_date": None,
                "estimated_hours": None,
                "assignee_hint": row.get("assignee_hint"),
                "progress_percent": 0,
                "next_step": None,
                "source_quote": desc[:500],
                "confidence": 88,
                "raw_payload": {
                    "task_no": task_no or None,
                    "priority_raw": priority_raw or None,
                    "assignee_hint": row.get("assignee_hint"),
                    "parser": "ppo_quarter_plan",
                },
            }
        )
    return tasks[:_max_drafts_limit()]


def _extract_llm_content(data: dict[str, Any], provider: str) -> str:
    err = data.get("error")
    if isinstance(err, dict):
        message = str(err.get("message") or err.get("code") or f"Unknown {provider} error")
        raise ValueError(f"{provider} error: {message}")

    choices = data.get("choices")
    if not isinstance(choices, list) or len(choices) == 0:
        preview = json.dumps(data, ensure_ascii=False)[:400]
        raise ValueError(f"{provider} returned no choices. Response: {preview}")

    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content")

    # Some providers can return content as an array of blocks.
    if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                text_parts.append(block["text"])
        content = "\n".join(text_parts).strip()

    if not isinstance(content, str) or not content.strip():
        preview = json.dumps(choices[0], ensure_ascii=False)[:400]
        raise ValueError(f"{provider} returned empty message content. Choice: {preview}")

    return content


async def generate_task_drafts_from_text(
    text: str,
    project_name: str,
    member_hints: list[str],
    prompt_instruction: str | None = None,
) -> list[dict[str, Any]]:
    max_drafts = _max_drafts_limit()
    ppo_tasks = _extract_tasks_from_ppo_quarter_plan(text)
    if ppo_tasks:
        return ppo_tasks[:max_drafts]

    fixed_tasks = _extract_tasks_from_fixed_plan_table(text)
    numbered_tasks = _extract_tasks_from_numbered_lines(text)
    preparsed_tasks = fixed_tasks if len(fixed_tasks) >= len(numbered_tasks) else numbered_tasks
    # If deterministic parsing already found enough tasks, prefer it over LLM.
    if len(preparsed_tasks) >= 30:
        return preparsed_tasks[:max_drafts]

    try:
        provider, api_key, base_url, model = _resolve_ai_provider()
    except ValueError:
        if preparsed_tasks:
            return preparsed_tasks[:max_drafts]
        raise

    extra_instruction = (prompt_instruction or "").strip()
    if _is_ppo_quarter_plan(text):
        ppo_instruction = (
            "Это типовой квартальный план ППО. Нужно извлечь полный перечень мероприятий из документа, "
            "включая переходящие задачи. Не останавливайся на 1-2 задачах, верни все найденные пункты плана."
        )
        extra_instruction = f"{extra_instruction} | {ppo_instruction}" if extra_instruction else ppo_instruction
    prompt = (
        "Ты помощник PM в ИТ-отделе. Извлеки только реальные ИТ-задачи из документа.\n"
        "КРИТИЧНО: нельзя придумывать задачи. Бери только то, что явно написано в тексте.\n"
        "Это может быть квартальный план (Q1/Q2/квартал). Для таких документов верни ВСЕ задачи из перечня, а не выборку.\n"
        "Если задача помечена как переходящая из прошлого квартала, ее нужно включать как обычную задачу.\n"
        "Если в строке есть срок/дата или новый дедлайн после переноса, заполни end_date этой датой.\n"
        "Нельзя возвращать заголовки документа, названия разделов, общие фразы без действия.\n"
        "Задача должна быть формулировкой действия (что сделать), а не темой документа.\n"
        "Если в задаче указан ответственный отдел/подразделение, запиши его в assignee_hint.\n"
        "source_quote обязана быть дословной короткой цитатой из текста, подтверждающей задачу.\n"
        "Если нет цитаты — такую задачу не возвращай.\n"
        "Верни только JSON без комментариев в формате:\n"
        "{\n"
        '  "tasks": [\n'
        "    {\n"
        '      "title": "string",\n'
        '      "description": "string or null",\n'
        '      "priority": "low|medium|high|critical",\n'
        '      "end_date": "YYYY-MM-DD or null",\n'
        '      "estimated_hours": "int 1..200 or null",\n'
        '      "assignee_hint": "name/email from team or null",\n'
        '      "progress_percent": "int 0..100",\n'
        '      "next_step": "string or null",\n'
        '      "source_quote": "short quote from source",\n'
        '      "confidence": "int 0..100"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        f"Включай не более {max_drafts} задач.\n"
        f"Проект: {project_name}\n"
        f"Участники команды (подсказки): {', '.join(member_hints) if member_hints else 'не указаны'}\n"
        f"{'Доп. указания пользователя: ' + extra_instruction + chr(10) if extra_instruction else ''}"
        "Текст документа:\n"
        f"{text[:100000]}"
    )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=body,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raw = exc.response.text[:400] if exc.response is not None else ""
            raise ValueError(
                f"{provider} HTTP {exc.response.status_code if exc.response else 'error'}: {raw}"
            ) from exc

    data = response.json()
    content = _extract_llm_content(data, provider=provider)
    parsed = _safe_json_loads(content)

    strict_tasks: list[dict[str, Any]] = []
    relaxed_tasks: list[dict[str, Any]] = []
    seen_titles: set[str] = set()

    def _build_task(item: dict[str, Any], source_quote: str | None, confidence_cap: int | None = None) -> dict[str, Any]:
        confidence = _normalize_int(item.get("confidence"), default=60, min_value=0, max_value=100)
        if confidence_cap is not None:
            confidence = min(confidence, confidence_cap)
        return {
            "title": str(item.get("title", "")).strip()[:500],
            "description": (str(item.get("description")).strip()[:5000] if item.get("description") else None),
            "priority": _normalize_priority(item.get("priority")),
            "end_date": _normalize_date(item.get("end_date")),
            "estimated_hours": _normalize_int(item.get("estimated_hours"), default=0, min_value=0, max_value=200)
            or None,
            "assignee_hint": (str(item.get("assignee_hint")).strip()[:255] if item.get("assignee_hint") else None),
            "progress_percent": _normalize_int(item.get("progress_percent"), default=0, min_value=0, max_value=100),
            "next_step": (str(item.get("next_step")).strip()[:500] if item.get("next_step") else None),
            "source_quote": source_quote,
            "confidence": confidence,
            "raw_payload": item,
        }

    for item in parsed.get("tasks", []):
        title = str(item.get("title", "")).strip()
        if not title:
            continue
        if _looks_like_document_header(title, project_name):
            continue
        if len(title) > 500:
            title = title[:500]
        source_quote = (str(item.get("source_quote")).strip()[:2000] if item.get("source_quote") else None)
        title_key = _normalize_spaces(title)
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        if source_quote and _quote_exists_in_text(source_quote, text):
            strict_tasks.append(_build_task(item, source_quote=source_quote))
        elif source_quote:
            relaxed_tasks.append(_build_task(item, source_quote=source_quote, confidence_cap=55))
        else:
            relaxed_tasks.append(_build_task(item, source_quote=None, confidence_cap=45))

    # Prefer strict tasks, but avoid pathological low-yield cases:
    # if strict validation kept only a handful while relaxed found many more,
    # use relaxed to prevent returning 1-2 drafts from large quarterly plans.
    if strict_tasks:
        if len(strict_tasks) < 8 and len(relaxed_tasks) >= max(12, len(strict_tasks) * 2):
            llm_tasks = relaxed_tasks[:max_drafts]
        else:
            llm_tasks = strict_tasks[:max_drafts]
    else:
        llm_tasks = relaxed_tasks[:max_drafts]
    if preparsed_tasks and len(preparsed_tasks) >= max(len(llm_tasks), 12):
        return preparsed_tasks[:max_drafts]
    return llm_tasks
