from __future__ import annotations

import re
from datetime import datetime
from typing import Any

_ORDER_PREFIX_RE = re.compile(r"^\s*\d+(?:\.\d+)*(?:[.)])?\s+")


def _strip_numeric_prefix(title: str) -> str:
    return _ORDER_PREFIX_RE.sub("", title).strip()


def _task_sort_key(task: Any) -> tuple[int, float, datetime, str]:
    order = getattr(task, "order", None)
    created_at = getattr(task, "created_at", None) or datetime.min
    task_id = str(getattr(task, "id", ""))
    if order is None:
        return (1, float("inf"), created_at, task_id)
    return (0, float(order), created_at, task_id)


def _build_numbering(tasks: list[Any]) -> dict[str, str]:
    ordered = sorted(tasks, key=_task_sort_key)
    visible_ids = {str(getattr(task, "id")) for task in ordered}
    children: dict[str, list[Any]] = {}
    roots: list[Any] = []

    for task in ordered:
        task_id = str(getattr(task, "id"))
        parent_id = getattr(task, "parent_task_id", None)
        parent_id = str(parent_id) if parent_id else None
        if parent_id and parent_id in visible_ids:
            children.setdefault(parent_id, []).append(task)
        else:
            roots.append(task)

    numbering: dict[str, str] = {}
    visited: set[str] = set()

    def walk(node: Any, prefix: str) -> None:
        node_id = str(getattr(node, "id"))
        if node_id in visited:
            return
        visited.add(node_id)
        numbering[node_id] = prefix
        for idx, child in enumerate(children.get(node_id, []), start=1):
            walk(child, f"{prefix}.{idx}")

    for idx, root in enumerate(roots, start=1):
        walk(root, str(idx))
    for task in ordered:
        task_id = str(getattr(task, "id"))
        if task_id not in visited:
            walk(task, str(len(numbering) + 1))

    return numbering


def renumber_task_titles_after_reorder(tasks: list[Any]) -> int:
    numbering = _build_numbering(tasks)
    changed = 0
    for task in tasks:
        title = str(getattr(task, "title", "") or "").strip()
        if not title or not _ORDER_PREFIX_RE.match(title):
            continue
        task_id = str(getattr(task, "id"))
        next_prefix = numbering.get(task_id)
        if not next_prefix:
            continue
        new_title = f"{next_prefix}. {_strip_numeric_prefix(title)}".strip()
        if new_title != title:
            setattr(task, "title", new_title[:500])
            changed += 1
    return changed
