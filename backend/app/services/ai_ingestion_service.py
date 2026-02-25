import json
import re
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
    provider, api_key, base_url, model = _resolve_ai_provider()

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
        "Включай не более 40 задач.\n"
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
    if strict_tasks:
        return strict_tasks[:40]
    return relaxed_tasks[:20]
