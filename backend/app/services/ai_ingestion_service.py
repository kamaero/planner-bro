import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from app.core.config import settings


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
        # Legacy Word .doc parsing via antiword with UTF-8 map
        proc = subprocess.run(
            ["antiword", "-m", "UTF-8", str(path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise ValueError(f"Could not parse .doc via antiword: {err[:300]}")
        text = proc.stdout.strip()
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
    return json.loads(payload[start : end + 1])


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

        priority_map = {"1": "critical", "2": "high", "3": "medium"}
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

    return tasks[:120]


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

        match = re.match(r"^(\d{1,3}(?:\.\d+)*)(?:[.)])?\s+(.+)$", line)
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
    return tasks[:120]


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
) -> list[dict[str, Any]]:
    fixed_tasks = _extract_tasks_from_fixed_plan_table(text)
    numbered_tasks = _extract_tasks_from_numbered_lines(text)
    preparsed_tasks = fixed_tasks if len(fixed_tasks) >= len(numbered_tasks) else numbered_tasks
    # If deterministic parsing already found enough tasks, prefer it over LLM.
    if len(preparsed_tasks) >= 30:
        return preparsed_tasks[:120]

    try:
        provider, api_key, base_url, model = _resolve_ai_provider()
    except ValueError:
        if preparsed_tasks:
            return preparsed_tasks[:120]
        raise

    prompt = (
        "Ты помощник PM в ИТ-отделе. Извлеки только реальные ИТ-задачи из документа.\n"
        "КРИТИЧНО: нельзя придумывать задачи. Бери только то, что явно написано в тексте.\n"
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
        "Включай не более 120 задач.\n"
        f"Проект: {project_name}\n"
        f"Участники команды (подсказки): {', '.join(member_hints) if member_hints else 'не указаны'}\n"
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

    # Strict mode first; if all tasks were filtered out, fallback to relaxed mode to avoid empty result.
    llm_tasks = strict_tasks[:120] if strict_tasks else relaxed_tasks[:120]
    if preparsed_tasks and len(preparsed_tasks) >= max(len(llm_tasks), 12):
        return preparsed_tasks[:120]
    return llm_tasks
