from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from math import ceil


_DURATION_RE = re.compile(
    r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
)


@dataclass
class ParsedMSProjectTask:
    uid: str
    title: str
    description: str | None
    start_date: date | None
    end_date: date | None
    progress_percent: int
    priority: str
    estimated_hours: int | None
    parent_uid: str | None


@dataclass
class MSProjectParseResult:
    tasks: list[ParsedMSProjectTask]
    skipped_count: int


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


def _find_project_root(root: ET.Element) -> ET.Element:
    if _tag_name(root.tag) == "Project":
        return root
    for node in root.iter():
        if _tag_name(node.tag) == "Project":
            return node
    raise ValueError("MS Project XML root <Project> not found")


def parse_ms_project_xml(content: bytes) -> MSProjectParseResult:
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

        if _find_child_text(node, "Active") == "0":
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
                title=title.strip(),
                description=_find_child_text(node, "Notes"),
                start_date=start_date,
                end_date=end_date,
                progress_percent=progress,
                priority=_normalize_priority(_find_child_text(node, "Priority")),
                estimated_hours=_parse_duration_hours(_find_child_text(node, "Duration")),
                parent_uid=parent_uid,
            )
        )

        level_stack[outline_level] = uid
        for level in list(level_stack.keys()):
            if level > outline_level:
                level_stack.pop(level, None)

    return MSProjectParseResult(tasks=parsed_tasks, skipped_count=skipped_count)
