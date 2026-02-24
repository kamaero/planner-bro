import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from app.core.config import settings


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


async def generate_task_drafts_from_text(
    text: str,
    project_name: str,
    member_hints: list[str],
) -> list[dict[str, Any]]:
    if not settings.OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is not configured")

    prompt = (
        "Ты помощник PM в ИТ-отделе. Извлеки только задачи, которые относятся к IT.\n"
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
        f"Проект: {project_name}\n"
        f"Участники команды (подсказки): {', '.join(member_hints) if member_hints else 'не указаны'}\n"
        "Текст документа:\n"
        f"{text[:100000]}"
    )

    headers = {
        "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": settings.OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            f"{settings.OPENROUTER_BASE_URL.rstrip('/')}/chat/completions",
            headers=headers,
            json=body,
        )
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = _safe_json_loads(content)

    tasks: list[dict[str, Any]] = []
    for item in parsed.get("tasks", []):
        title = str(item.get("title", "")).strip()
        if not title:
            continue
        tasks.append(
            {
                "title": title[:500],
                "description": (str(item.get("description")).strip()[:5000] if item.get("description") else None),
                "priority": _normalize_priority(item.get("priority")),
                "end_date": _normalize_date(item.get("end_date")),
                "estimated_hours": _normalize_int(item.get("estimated_hours"), default=0, min_value=0, max_value=200)
                or None,
                "assignee_hint": (str(item.get("assignee_hint")).strip()[:255] if item.get("assignee_hint") else None),
                "progress_percent": _normalize_int(item.get("progress_percent"), default=0, min_value=0, max_value=100),
                "next_step": (str(item.get("next_step")).strip()[:500] if item.get("next_step") else None),
                "source_quote": (str(item.get("source_quote")).strip()[:2000] if item.get("source_quote") else None),
                "confidence": _normalize_int(item.get("confidence"), default=60, min_value=0, max_value=100),
                "raw_payload": item,
            }
        )
    return tasks
