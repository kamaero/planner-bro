"""Project retrospective generator.

Collects full project lifecycle data and calls the AI to produce a structured
retrospective report. Result is persisted in project_retrospectives (one per
project, upserted on each regeneration).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deadline_change import DeadlineChange
from app.models.project import Project, ProjectMember
from app.models.project_retrospective import ProjectRetrospective
from app.models.task import Task
from app.models.user import User
from app.services.ai_ingestion_service import _extract_llm_content, _resolve_ai_provider


async def _collect_retro_snapshot(db: AsyncSession, project_id: str) -> dict[str, Any]:
    today = date.today()

    project = await db.get(Project, project_id)
    if not project:
        raise ValueError(f"Project {project_id} not found")

    tasks = (await db.execute(select(Task).where(Task.project_id == project_id))).scalars().all()

    members = (
        await db.execute(
            select(User)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .where(ProjectMember.project_id == project_id, User.is_active == True)
        )
    ).scalars().all()

    # Load assignee names
    assignee_ids = {t.assigned_to_id for t in tasks if t.assigned_to_id}
    assignees: dict[str, str] = {}
    if assignee_ids:
        rows = (await db.execute(select(User).where(User.id.in_(assignee_ids)))).scalars().all()
        assignees = {u.id: u.name for u in rows}

    total = len(tasks)
    done_tasks   = [t for t in tasks if t.status == "done"]
    active_tasks = [t for t in tasks if t.status != "done"]
    overdue      = [t for t in active_tasks if t.end_date and t.end_date < today]

    # Time tracking totals
    total_planned  = sum(t.estimated_hours or 0 for t in tasks)
    total_actual   = sum(float(t.actual_hours or 0) for t in tasks)
    tasks_with_est = sum(1 for t in tasks if t.estimated_hours)
    tasks_with_act = sum(1 for t in tasks if t.actual_hours)

    # Per-person contribution
    contrib: dict[str, dict] = {}
    for t in tasks:
        aid = t.assigned_to_id
        if not aid:
            continue
        if aid not in contrib:
            contrib[aid] = {
                "name": assignees.get(aid, aid),
                "total": 0, "done": 0, "overdue": 0,
                "planned_h": 0.0, "actual_h": 0.0,
            }
        contrib[aid]["total"] += 1
        if t.status == "done":
            contrib[aid]["done"] += 1
        if t.end_date and t.end_date < today and t.status != "done":
            contrib[aid]["overdue"] += 1
        contrib[aid]["planned_h"] += t.estimated_hours or 0
        contrib[aid]["actual_h"] += float(t.actual_hours or 0)

    # All deadline changes for this project's tasks
    all_deadline_shifts = (
        await db.execute(
            select(DeadlineChange)
            .where(
                DeadlineChange.entity_type == "task",
                DeadlineChange.entity_id.in_([t.id for t in tasks]),
            )
        )
    ).scalars().all()

    total_shift_days = sum(
        abs((dc.new_date - dc.old_date).days) for dc in all_deadline_shifts
        if dc.new_date and dc.old_date
    )

    # Project date variance
    project_date_info: dict[str, Any] = {
        "planned_start":  str(project.start_date) if project.start_date else None,
        "planned_end":    str(project.end_date)   if project.end_date   else None,
        "actual_end":     str(today)               if project.status == "completed" else None,
        "days_overrun":   (today - project.end_date).days if project.end_date and today > project.end_date else 0,
    }

    return {
        "project": {
            "name":   project.name,
            "status": project.status,
            **project_date_info,
        },
        "tasks": {
            "total":       total,
            "done":        len(done_tasks),
            "done_pct":    round(len(done_tasks) / total * 100) if total else 0,
            "active":      len(active_tasks),
            "overdue":     len(overdue),
            "overdue_list": [
                {"title": t.title, "days": (today - t.end_date).days, "assignee": assignees.get(t.assigned_to_id or "")}
                for t in overdue[:10]
            ],
        },
        "time": {
            "total_planned": total_planned,
            "total_actual":  round(total_actual, 1),
            "tasks_with_estimate": tasks_with_est,
            "tasks_with_actual":   tasks_with_act,
            "overrun_h": round(total_actual - total_planned, 1) if total_planned else None,
        },
        "team": {
            "member_count": len(members),
            "contributions": sorted(contrib.values(), key=lambda x: -x["total"]),
        },
        "deadline_shifts": {
            "count": len(all_deadline_shifts),
            "total_days_shifted": total_shift_days,
        },
    }


def _build_retro_prompt(snap: dict[str, Any]) -> str:
    p    = snap["project"]
    t    = snap["tasks"]
    tm   = snap["time"]
    team = snap["team"]
    ds   = snap["deadline_shifts"]

    lines: list[str] = [
        "Ты аналитик проектного офиса. Напиши ретроспективу завершённого проекта на русском языке.",
        "Будь конкретным, опирайся на данные, избегай общих фраз.",
        "",
        f"## Проект: {p['name']}",
        f"Статус: {p['status']}",
    ]
    if p.get("planned_start"):
        lines.append(f"Плановые даты: {p['planned_start']} — {p['planned_end'] or '?'}")
    if p.get("days_overrun") and p["days_overrun"] > 0:
        lines.append(f"Просрочка проекта: {p['days_overrun']} дней")

    lines += [
        "",
        f"## Задачи (всего {t['total']})",
        f"Выполнено: {t['done']} ({t['done_pct']}%)",
        f"Активных/незакрытых: {t['active']}",
        f"Просрочено на дату ретроспективы: {t['overdue']}",
    ]
    if t["overdue_list"]:
        lines.append("Просроченные задачи:")
        for o in t["overdue_list"]:
            lines.append(f"  - «{o['title']}» — {o['days']} дн., исполнитель: {o['assignee'] or 'не назначен'}")

    lines += ["", "## Учёт времени"]
    if tm["tasks_with_estimate"] > 0:
        lines.append(f"Плановые часы: {tm['total_planned']} (по {tm['tasks_with_estimate']} задачам)")
    if tm["tasks_with_actual"] > 0:
        lines.append(f"Фактические часы: {tm['total_actual']} (по {tm['tasks_with_actual']} задачам)")
    if tm["overrun_h"] is not None:
        sign = "+" if tm["overrun_h"] >= 0 else ""
        lines.append(f"Отклонение: {sign}{tm['overrun_h']} ч")
    if tm["tasks_with_estimate"] == 0:
        lines.append("Плановые часы не заполнялись в системе.")

    lines += ["", f"## Команда ({team['member_count']} участников)"]
    for c in team["contributions"][:10]:
        line = f"  - {c['name']}: {c['total']} задач ({c['done']} выполнено, {c['overdue']} просрочено)"
        if c["planned_h"] or c["actual_h"]:
            line += f", {c['actual_h']:.0f}/{c['planned_h']:.0f}ч"
        lines.append(line)

    lines += [
        "",
        f"## Изменения дедлайнов",
        f"Всего сдвигов: {ds['count']}, суммарно {ds['total_days_shifted']} дн.",
        "",
        "## ЗАДАНИЕ — структурируй ответ ровно в 5 разделов:",
        "1. ИТОГ — 2-3 предложения: проект выполнен или нет, ключевой результат",
        "2. ЧТО ПОЛУЧИЛОСЬ — до 4 пунктов с конкретными фактами из данных",
        "3. ЧТО ПОШЛО НЕ ТАК — до 4 пунктов, конкретные проблемы из данных",
        "4. НАГРУЗКА КОМАНДЫ — по каждому участнику кратко, перегруз/недогруз",
        "5. УРОКИ ДЛЯ СЛЕДУЮЩЕГО ПРОЕКТА — 3-5 конкретных рекомендаций",
    ]
    return "\n".join(lines)


async def generate_retrospective(
    db: AsyncSession,
    project_id: str,
    generated_by_id: str | None = None,
) -> dict[str, Any]:
    snap = await _collect_retro_snapshot(db, project_id)
    prompt = _build_retro_prompt(snap)

    provider, api_key, base_url, model = _resolve_ai_provider()
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 2000,
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        try:
            resp = await client.post(f"{base_url}/chat/completions", headers=headers, json=body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raw = exc.response.text[:300] if exc.response is not None else ""
            raise ValueError(f"AI provider error {exc.response.status_code if exc.response else ''}: {raw}") from exc

    content = _extract_llm_content(resp.json(), provider=provider)
    stats = {
        "total_tasks":         snap["tasks"]["total"],
        "done_pct":            snap["tasks"]["done_pct"],
        "overdue_count":       snap["tasks"]["overdue"],
        "total_planned_h":     snap["time"]["total_planned"],
        "total_actual_h":      snap["time"]["total_actual"],
        "deadline_shift_count": snap["deadline_shifts"]["count"],
        "total_shift_days":    snap["deadline_shifts"]["total_days_shifted"],
    }
    now = datetime.now(timezone.utc)

    # Upsert — one retrospective per project
    existing = (
        await db.execute(
            select(ProjectRetrospective).where(ProjectRetrospective.project_id == project_id)
        )
    ).scalar_one_or_none()

    if existing:
        existing.content = content
        existing.stats = stats
        existing.generated_at = now
        existing.generated_by_id = generated_by_id
        retro = existing
    else:
        retro = ProjectRetrospective(
            project_id=project_id,
            generated_by_id=generated_by_id,
            content=content,
            stats=stats,
            generated_at=now,
        )
        db.add(retro)

    await db.commit()

    return {
        "project_id":  project_id,
        "project_name": snap["project"]["name"],
        "content":     content,
        "stats":       stats,
        "generated_at": now.isoformat(),
    }


async def get_retrospective(db: AsyncSession, project_id: str) -> dict[str, Any] | None:
    retro = (
        await db.execute(
            select(ProjectRetrospective).where(ProjectRetrospective.project_id == project_id)
        )
    ).scalar_one_or_none()

    if not retro:
        return None

    project = await db.get(Project, project_id)
    return {
        "project_id":   retro.project_id,
        "project_name": project.name if project else "",
        "content":      retro.content,
        "stats":        retro.stats,
        "generated_at": retro.generated_at.isoformat(),
    }
