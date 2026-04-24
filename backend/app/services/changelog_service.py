import hashlib
import os
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path


@dataclass
class ChangelogSection:
    version: str
    date: str   # ISO "YYYY-MM-DD"
    title: str
    content: str


_SECTION_RE = re.compile(
    r'^## \[([^\]]+)\]\s*[—–-]+\s*(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.+)$',
    re.MULTILINE,
)

_cache: dict = {"hash": None, "mtime": None, "sections": []}


def _changelog_path() -> Path:
    return Path(os.getenv("CHANGELOG_PATH", "/app/CHANGELOG.md"))


def get_changelog() -> dict:
    path = _changelog_path()
    try:
        mtime = path.stat().st_mtime
    except FileNotFoundError:
        return {"hash": "", "sections": []}

    if _cache["mtime"] == mtime:
        return {"hash": _cache["hash"], "sections": _cache["sections"]}

    content = path.read_text(encoding="utf-8")
    file_hash = hashlib.sha256(content.encode()).hexdigest()
    sections = _parse_sections(content)

    _cache["mtime"] = mtime
    _cache["hash"] = file_hash
    _cache["sections"] = sections

    return {"hash": file_hash, "sections": sections}


def _parse_sections(content: str) -> list[ChangelogSection]:
    matches = list(_SECTION_RE.finditer(content))
    sections = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        section_content = content[start:end].strip()
        sections.append(ChangelogSection(
            version=m.group(1).strip(),
            date=m.group(2).strip(),
            title=m.group(3).strip(),
            content=section_content,
        ))
    return sections
