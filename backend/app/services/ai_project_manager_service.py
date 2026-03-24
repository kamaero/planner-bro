from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.deadline_change import DeadlineChange
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.models.user import User
from app.services.ai_ingestion_service import _extract_llm_content, _resolve_ai_provider


async def collect_project_snapshot(db: AsyncSession, project_id: str) -> dict[str, Any]:
    today = date.today()
    stale_cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    project = await db.get(Project, project_id)
    if not project:
        raise ValueError(f"Project {project_id} not found")

    tasks = (
        await db.execute(
            select(Task)
            .where(Task.project_id == project_id)
            .options(selectinload(Task.assignee), selectinload(Task.assignee_links))
        )
    ).scalars().all()

    members = (
        await db.execute(
            select(User)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .where(ProjectMember.project_id == project_id, User.is_active == True)
        )
    ).scalars().all()

    by_status: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    overdue: list[dict] = []
    unassigned: list[dict] = []
    stale: list[dict] = []
    workload: dict[str, dict] = {}

    for task in tasks:
        by_status[task.status] = by_status.get(task.status, 0) + 1
        by_priority[task.priority] = by_priority.get(task.priority, 0) + 1

        if task.end_date and task.end_date < today and task.status not in ("done",):
            overdue.append({
                "title": task.title,
                "status": task.status,
                "priority": task.priority,
                "days_overdue": (today - task.end_date).days,
                "assignee": task.assignee.name if task.assignee else None,
            })

        if not task.assigned_to_id and task.status not in ("done", "planning"):
            overdue_hint = f", дедлайн {task.end_date}" if task.end_date else ""
            unassigned.append({"title": task.title, "priority": task.priority, "end_date": str(task.end_date) if task.end_date else None})

        if task.status == "in_progress":
            last_touch = task.last_check_in_at
            if last_touch is None:
                # fall back to created_at when no check-in recorded
                created = getattr(task, "created_at", None)
                if created and created < stale_cutoff:
                    days = (datetime.now(timezone.utc) - created).days
                    stale.append({"title": task.title, "days_no_update": days, "assignee": task.assignee.name if task.assignee else None})
            elif last_touch < stale_cutoff:
                days = (datetime.now(timezone.utc) - last_touch).days
                stale.append({"title": task.title, "days_no_update": days, "assignee": task.assignee.name if task.assignee else None})

        if task.assigned_to_id and task.status not in ("done",):
            if task.assigned_to_id not in workload:
                workload[task.assigned_to_id] = {
                    "name": task.assignee.name if task.assignee else task.assigned_to_id,
                    "count": 0, "high_or_critical": 0, "overdue": 0,
                }
            w = workload[task.assigned_to_id]
            w["count"] += 1
            if task.priority in ("high", "critical"):
                w["high_or_critical"] += 1
            if task.end_date and task.end_date < today:
                w["overdue"] += 1

    thirty_ago = datetime.now(timezone.utc) - timedelta(days=30)
    deadline_shifts_count = len(
        (
            await db.execute(
                select(DeadlineChange.id)
                .where(
                    DeadlineChange.entity_type == "task",
                    DeadlineChange.entity_id.in_([t.id for t in tasks]),
                    DeadlineChange.created_at >= thirty_ago,
                )
            )
        ).scalars().all()
    )

    total = len(tasks)
    return {
        "project": {
            "name": project.name,
            "status": project.status,
            "priority": project.priority,
            "start_date": str(project.start_date) if project.start_date else None,
            "end_date": str(project.end_date) if project.end_date else None,
            "days_until_end": (project.end_date - today).days if project.end_date else None,
        },
        "tasks": {
            "total": total,
            "by_status": by_status,
            "by_priority": by_priority,
            "done_percent": round(by_status.get("done", 0) / total * 100) if total else 0,
            "overdue": overdue[:20],
            "unassigned": unassigned[:20],
            "stale_in_progress": stale[:20],
        },
        "team": {
            "member_count": len(members),
            "workload": sorted(workload.values(), key=lambda w: w["count"], reverse=True),
        },
        "deadline_changes_last_30d": deadline_shifts_count,
    }


def _build_prompt(snapshot: dict[str, Any]) -> str:
    p = snapshot["project"]
    t = snapshot["tasks"]
    team = snapshot["team"]

    lines: list[str] = [
        "Ты аналитик проектного офиса. Проанализируй данные проекта и дай конкретные рекомендации на русском языке.",
        "",
        f"## ПРОЕКТ: {p['name']}",
        f"Статус: {p['status']} | Приоритет: {p['priority']}",
    ]
    if p["start_date"] or p["end_date"]:
        suffix = f" ({p['days_until_end']} дн. до окончания)" if p["days_until_end"] is not None else ""
        lines.append(f"Сроки: {p['start_date'] or '?'} → {p['end_date'] or '?'}{suffix}")

    lines += [
        "",
        f"## ЗАДАЧИ (всего {t['total']}, выполнено {t['done_percent']}%)",
        f"По статусам: {', '.join(f'{k}={v}' for k, v in t['by_status'].items())}",
        f"По приоритетам: {', '.join(f'{k}={v}' for k, v in t['by_priority'].items())}",
    ]

    if t["overdue"]:
        lines.append(f"\n### Просроченные ({len(t['overdue'])}):")
        for o in t["overdue"][:12]:
            lines.append(f"- [{o['priority']}] {o['title']} — {o['days_overdue']} дн. просрочки, исп.: {o['assignee'] or 'не назначен'}")

    if t["stale_in_progress"]:
        lines.append(f"\n### In_progress без апдейта >7 дней ({len(t['stale_in_progress'])}):")
        for s in t["stale_in_progress"][:12]:
            lines.append(f"- {s['title']} — {s['days_no_update']} дн., исп.: {s['assignee'] or '?'}")

    if t["unassigned"]:
        lines.append(f"\n### Без исполнителя ({len(t['unassigned'])}):")
        for u in t["unassigned"][:12]:
            dl = f", дедлайн {u['end_date']}" if u["end_date"] else ""
            lines.append(f"- [{u['priority']}] {u['title']}{dl}")

    lines += ["", f"## КОМАНДА ({team['member_count']} чел.)"]
    if team["workload"]:
        for w in team["workload"][:10]:
            lines.append(
                f"- {w['name']}: {w['count']} активных, {w['high_or_critical']} высоких/крит., {w['overdue']} просрочено"
            )
    else:
        lines.append("Нет активных назначений")

    lines += [
        "",
        f"Сдвигов дедлайнов за последние 30 дней: {snapshot['deadline_changes_last_30d']}",
        "",
        "## ЗАДАНИЕ — ответь ровно в 4 блоках, кратко и по делу:",
        "1. ОБЩАЯ ОЦЕНКА — 2-3 предложения о состоянии",
        "2. ТОП РИСКОВ — до 5 конкретных рисков с именами задач/людей",
        "3. БАЛАНС НАГРУЗКИ — перегруз/недогруз по конкретным людям",
        "4. РЕКОМЕНДАЦИИ — 3-5 действий с приоритетами 🔴🟡🟢",
    ]
    return "\n".join(lines)


async def analyze_project(db: AsyncSession, project_id: str) -> dict[str, Any]:
    snapshot = await collect_project_snapshot(db, project_id)
    prompt = _build_prompt(snapshot)

    provider, api_key, base_url, model = _resolve_ai_provider()
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 1500,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raw = exc.response.text[:300] if exc.response is not None else ""
            raise ValueError(f"AI provider error {exc.response.status_code if exc.response else ''}: {raw}") from exc

    analysis_text = _extract_llm_content(resp.json(), provider=provider)
    t = snapshot["tasks"]
    return {
        "project_id": project_id,
        "project_name": snapshot["project"]["name"],
        "analysis": analysis_text,
        "stats": {
            "total_tasks": t["total"],
            "done_percent": t["done_percent"],
            "overdue_count": len(t["overdue"]),
            "stale_count": len(t["stale_in_progress"]),
            "unassigned_count": len(t["unassigned"]),
            "deadline_shifts_30d": snapshot["deadline_changes_last_30d"],
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
