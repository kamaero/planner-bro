import asyncio
from datetime import datetime, timezone, timedelta
import logging
import html
from email.mime.multipart import MIMEMultipart
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.notification import Notification
from app.models.email_dispatch_log import EmailDispatchLog
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.core.firebase import send_push_to_multiple
from app.services.websocket_manager import ws_manager
from app.services import events as ev
from app.services.system_activity_service import log_system_activity
from app.services.report_settings_service import get_smtp_enabled
import aiosmtplib
from email.mime.text import MIMEText
from app.core.config import settings
from app.core.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _build_task_link(project_id: str, task_id: str) -> str:
    return f"{settings.APP_WEB_URL.rstrip('/')}/projects/{project_id}?task={task_id}"


def _build_project_link(project_id: str) -> str:
    return f"{settings.APP_WEB_URL.rstrip('/')}/projects/{project_id}"


def _default_html_email_template(subject: str, body: str) -> str:
    safe_subject = html.escape(subject or "PlannerBro уведомление")
    # Preserve line breaks from plain text body.
    safe_body = html.escape(body or "").replace("\n", "<br>")
    return (
        "<!doctype html>"
        "<html><head><meta charset=\"utf-8\"></head>"
        "<body style=\"margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;\">"
        "<table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" "
        "style=\"padding:24px 12px;background:#f3f4f6;\">"
        "<tr><td align=\"center\">"
        "<table role=\"presentation\" width=\"640\" cellspacing=\"0\" cellpadding=\"0\" "
        "style=\"max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;\">"
        "<tr><td style=\"padding:16px 20px;background:#111827;color:#ffffff;font-size:18px;font-weight:700;\">PlannerBro</td></tr>"
        f"<tr><td style=\"padding:18px 20px 6px 20px;font-size:16px;font-weight:600;\">{safe_subject}</td></tr>"
        f"<tr><td style=\"padding:0 20px 18px 20px;font-size:14px;line-height:1.55;color:#374151;\">{safe_body}</td></tr>"
        "<tr><td style=\"padding:12px 20px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;\">"
        "Это служебное сообщение PlannerBro."
        "</td></tr>"
        "</table>"
        "</td></tr></table>"
        "</body></html>"
    )


async def _create_notification(
    db: AsyncSession,
    user_id: str,
    type_: str,
    title: str,
    body: str,
    data: dict = None,
) -> Notification:
    notif = Notification(
        user_id=user_id, type=type_, title=title, body=body, data=data or {}
    )
    db.add(notif)
    await db.flush()
    return notif


def _is_weekend_utc(now: datetime) -> bool:
    return now.weekday() >= 5


def _preferred_email(user: User, now: datetime) -> str | None:
    if _is_weekend_utc(now):
        return user.email
    return user.work_email or user.email


async def _record_email_dispatch(
    db: AsyncSession,
    recipient: str,
    subject: str,
    status: str,
    source: str,
    error_text: str | None = None,
    payload: dict | None = None,
) -> None:
    db.add(
        EmailDispatchLog(
            recipient=recipient,
            subject=subject[:255],
            status=status,
            source=source[:100],
            error_text=(error_text or None),
            payload=payload or None,
        )
    )
    # Keep system activity monitor focused on real incidents.
    if status == "failed":
        await log_system_activity(
            db,
            source="smtp",
            category="email",
            level="error",
            message=f"{source}: {subject}",
            details={
                "status": status,
                "recipient": recipient,
                "error_text": error_text,
                "payload": payload or {},
            },
            commit=False,
        )


async def _was_task_assigned_email_sent_recently(
    db: AsyncSession,
    recipient: str,
    task_id: str,
    window_minutes: int = 30,
) -> bool:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max(1, window_minutes))
    existing = (
        await db.execute(
            select(EmailDispatchLog.id).where(
                EmailDispatchLog.source == "task_assigned",
                EmailDispatchLog.status == "sent",
                EmailDispatchLog.recipient == recipient,
                EmailDispatchLog.created_at >= cutoff,
                EmailDispatchLog.payload["task_id"].astext == task_id,
            )
        )
    ).scalar_one_or_none()
    return existing is not None


async def _send_email_to_recipients(
    db: AsyncSession,
    recipients: list[str],
    subject: str,
    body: str,
    source: str,
    payload: dict | None = None,
    html_body: str | None = None,
) -> None:
    if not recipients:
        return
    if not await get_smtp_enabled():
        for email in recipients:
            await _record_email_dispatch(
                db,
                recipient=email,
                subject=subject,
                status="skipped",
                source=source,
                error_text="SMTP is disabled by admin switch",
                payload=payload,
            )
        await db.commit()
        return
    if not settings.SMTP_HOST:
        for email in recipients:
            await _record_email_dispatch(
                db,
                recipient=email,
                subject=subject,
                status="skipped",
                source=source,
                error_text="SMTP host is not configured",
                payload=payload,
            )
        await db.commit()
        return
    max_attempts = max(1, int(settings.SMTP_MAX_ATTEMPTS))
    base_delay = max(0.0, float(settings.SMTP_RETRY_BASE_DELAY_SECONDS))
    for email in recipients:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body or _default_html_email_template(subject, body), "html", "utf-8"))
        msg["Subject"] = subject
        msg["From"] = settings.EMAILS_FROM
        msg["To"] = email

        last_exc: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                kwargs = {
                    "hostname": settings.SMTP_HOST,
                    "port": settings.SMTP_PORT,
                    "use_tls": settings.SMTP_USE_TLS,
                    "start_tls": settings.SMTP_USE_STARTTLS,
                    "timeout": settings.SMTP_TIMEOUT_SECONDS,
                }
                if settings.SMTP_USER:
                    kwargs["username"] = settings.SMTP_USER
                if settings.SMTP_PASSWORD:
                    kwargs["password"] = settings.SMTP_PASSWORD
                await aiosmtplib.send(msg, **kwargs)
                await _record_email_dispatch(
                    db,
                    recipient=email,
                    subject=subject,
                    status="sent",
                    source=source,
                    payload={**(payload or {}), "attempts": attempt},
                )
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if attempt < max_attempts:
                    delay = base_delay * attempt
                    logger.warning(
                        "SMTP send retry: source=%s recipient=%s attempt=%s/%s delay=%.2fs err=%s",
                        source,
                        email,
                        attempt,
                        max_attempts,
                        delay,
                        repr(exc),
                    )
                    if delay > 0:
                        await asyncio.sleep(delay)
                    continue
                logger.warning(
                    "SMTP send failed: source=%s recipient=%s host=%s port=%s tls=%s starttls=%s attempts=%s err=%s",
                    source,
                    email,
                    settings.SMTP_HOST,
                    settings.SMTP_PORT,
                    settings.SMTP_USE_TLS,
                    settings.SMTP_USE_STARTTLS,
                    max_attempts,
                    repr(exc),
                )
                await _record_email_dispatch(
                    db,
                    recipient=email,
                    subject=subject,
                    status="failed",
                    source=source,
                    error_text=f"{exc.__class__.__name__}: {str(exc)}"[:1000],
                    payload={**(payload or {}), "attempts": max_attempts},
                )
        if last_exc is None:
            continue
    await db.commit()


def _send_email_to_recipients_background(
    recipients: list[str],
    subject: str,
    body: str,
    source: str,
    payload: dict | None = None,
) -> None:
    async def _runner() -> None:
        try:
            async with AsyncSessionLocal() as bg_db:
                await _send_email_to_recipients(
                    bg_db,
                    recipients,
                    subject,
                    body,
                    source=source,
                    payload=payload,
                )
        except Exception as exc:
            logger.warning(
                "Background email dispatch failed: source=%s recipients=%s err=%s",
                source,
                recipients,
                repr(exc),
            )

    asyncio.create_task(_runner())


async def _get_project_member_ids(db: AsyncSession, project_id: str) -> list[str]:
    result = await db.execute(
        select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
    )
    return [row[0] for row in result.all()]


def _exclude_ids(user_ids: list[str], exclude_user_ids: list[str] | None = None) -> list[str]:
    excluded = set(exclude_user_ids or [])
    return [uid for uid in user_ids if uid not in excluded]


async def _get_fcm_tokens(db: AsyncSession, user_ids: list[str]) -> list[str]:
    result = await db.execute(
        select(User.fcm_token).where(User.id.in_(user_ids), User.fcm_token.isnot(None))
    )
    return [row[0] for row in result.all()]


async def _filter_recipients_by_reminder_days(
    db: AsyncSession, user_ids: list[str], days_until: int
) -> list[str]:
    if days_until <= 0:
        return user_ids
    result = await db.execute(select(User.id, User.reminder_days).where(User.id.in_(user_ids)))
    allowed: list[str] = []
    for user_id, reminder_days in result.all():
        raw = reminder_days or "1,3"
        values = {int(item.strip()) for item in raw.split(",") if item.strip().isdigit()}
        if days_until in values:
            allowed.append(user_id)
    return allowed


async def notify_task_assigned(
    db: AsyncSession,
    task: Task,
    assignee_id: str,
    actor_id: str | None = None,
):
    if not assignee_id:
        return
    # Anti-noise: do not notify when user assigns task to themselves.
    if task.created_by_id == assignee_id or (actor_id and actor_id == assignee_id):
        return
    title = "Новая задача на вас"
    body = f"Вам назначена задача «{task.title}»."
    if task.end_date:
        body += f" Дедлайн: {task.end_date.isoformat()}."
    body += f" Откройте задачу: {_build_task_link(task.project_id, task.id)}"
    data = {"task_id": task.id, "project_id": task.project_id, "kind": "task_assigned"}
    notif = await _create_notification(db, assignee_id, "task_assigned", title, body, data)
    await db.flush()

    tokens = await _get_fcm_tokens(db, [assignee_id])
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.send_to_user(assignee_id, ev.TASK_ASSIGNED, {
        "notification_id": notif.id, "task_id": task.id, "title": title, "body": body
    })
    assignee = (
        await db.execute(select(User).where(User.id == assignee_id))
    ).scalar_one_or_none()
    if assignee:
        email = _preferred_email(assignee, datetime.now(timezone.utc))
        if email:
            if await _was_task_assigned_email_sent_recently(db, email, task.id):
                return
            _send_email_to_recipients_background(
                [email],
                title,
                body,
                source="task_assigned",
                payload=data,
            )


async def notify_project_assigned(
    db: AsyncSession,
    project_id: str,
    project_name: str,
    user_id: str,
    assigned_role: str,
):
    title = "У вас появился новый проект"
    body = (
        f"Вас назначили в проект «{project_name}» (роль: {assigned_role}). "
        f"Проверьте задачи и обновите статусы: {_build_project_link(project_id)}"
    )
    data = {"project_id": project_id, "kind": "project_assigned"}
    notif = await _create_notification(db, user_id, "project_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, [user_id])
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.send_to_user(user_id, ev.PROJECT_UPDATED, {
        "notification_id": notif.id,
        "project_id": project_id,
        "title": title,
        "body": body,
    })
    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user:
        email = _preferred_email(user, datetime.now(timezone.utc))
        if email:
            _send_email_to_recipients_background(
                [email],
                title,
                body,
                source="project_assigned",
                payload=data,
            )


async def notify_task_updated(db: AsyncSession, task: Task, actor_id: str):
    member_ids = await _get_project_member_ids(db, task.project_id)
    recipients = _exclude_ids(member_ids, [actor_id])
    if not recipients:
        return

    status_labels = {
        "planning": "в планировании",
        "todo": "к выполнению",
        "in_progress": "в работе",
        "review": "на проверке",
        "done": "выполнено",
    }
    title = "Обновление по задаче"
    body = f"«{task.title}»: статус «{status_labels.get(task.status, task.status)}», прогресс {task.progress_percent}%."
    if task.next_step:
        body += f" Следующий шаг: {task.next_step}"
    data = {"task_id": task.id, "project_id": task.project_id, "kind": "task_updated"}

    for uid in recipients:
        await _create_notification(db, uid, "task_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(task.project_id, ev.TASK_UPDATED, {
        "task_id": task.id, "project_id": task.project_id
    })


async def notify_new_task(db: AsyncSession, task: Task):
    member_ids = await _get_project_member_ids(db, task.project_id)
    recipients = _exclude_ids(member_ids, [task.created_by_id, task.assigned_to_id] if task.assigned_to_id else [task.created_by_id])
    if not recipients:
        return
    title = "Добавлена новая задача"
    body = f"В проекте появилась задача «{task.title}»."
    data = {"task_id": task.id, "project_id": task.project_id, "kind": "new_task"}

    for uid in recipients:
        await _create_notification(db, uid, "new_task", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(task.project_id, ev.TASK_CREATED, {
        "task_id": task.id, "project_id": task.project_id
    })


async def notify_project_updated(db: AsyncSession, project: Project):
    member_ids = await _get_project_member_ids(db, project.id)
    title = "Проект обновлен"
    body = f"В проекте «{project.name}» есть изменения."
    data = {"project_id": project.id, "kind": "project_updated"}

    for uid in member_ids:
        await _create_notification(db, uid, "project_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, member_ids)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(project.id, ev.PROJECT_UPDATED, {"project_id": project.id})


async def notify_deadline(db: AsyncSession, task: Task, days_until: int):
    member_ids = await _get_project_member_ids(db, task.project_id)
    member_ids = await _filter_recipients_by_reminder_days(db, member_ids, days_until)
    if not member_ids:
        return
    type_ = "deadline_approaching" if days_until > 0 else "deadline_missed"
    title = "Срок подходит" if days_until > 0 else "Срок пропущен"
    body = (
        f"Срок задачи «{task.title}» наступит через {days_until} дн."
        if days_until > 0
        else f"Срок задачи «{task.title}» уже прошел"
    )
    deadline_key = f"{task.id}:{days_until}:{task.end_date.isoformat() if task.end_date else 'none'}"
    data = {"task_id": task.id, "project_id": task.project_id, "deadline_key": deadline_key}

    for uid in member_ids:
        existing = await db.execute(
            select(Notification.id).where(
                Notification.user_id == uid,
                Notification.type == type_,
                Notification.data.contains({"deadline_key": deadline_key}),
            )
        )
        if existing.scalar_one_or_none():
            continue
        await _create_notification(db, uid, type_, title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, member_ids)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    if days_until <= 0:
        await _send_email_to_members(
            db,
            member_ids,
            title,
            body,
            source=type_,
            payload=data,
        )

    await ws_manager.broadcast_to_project(task.project_id, ev.DEADLINE_WARNING, data)


async def notify_escalation_sla_breached(db: AsyncSession, task: Task, breached_at):
    owner_id = (
        await db.execute(select(Project.owner_id).where(Project.id == task.project_id))
    ).scalar_one_or_none()
    recipients = [uid for uid in [task.assigned_to_id, owner_id] if uid]
    recipients = list(dict.fromkeys(recipients))
    if not recipients:
        return
    title = "SLA эскалации просрочен"
    body = f"По задаче '{task.title}' превышен срок реакции."
    data = {
        "task_id": task.id,
        "project_id": task.project_id,
        "breached_at": breached_at.isoformat(),
    }
    for uid in recipients:
        await _create_notification(db, uid, "task_updated", title, body, data)
    await db.commit()
    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)
    for uid in recipients:
        await ws_manager.send_to_user(uid, ev.ESCALATION_SLA_BREACHED, data)


async def notify_check_in_help_requested(
    db: AsyncSession,
    task: Task,
    actor_id: str,
    actor_name: str,
    summary: str,
    blockers: str | None,
):
    manager_rows = await db.execute(
        select(ProjectMember.user_id).where(
            ProjectMember.project_id == task.project_id,
            ProjectMember.role.in_(("owner", "manager")),
        )
    )
    project_owner_id = (
        await db.execute(select(Project.owner_id).where(Project.id == task.project_id))
    ).scalar_one_or_none()

    recipients = [row[0] for row in manager_rows.all()]
    if project_owner_id:
        recipients.append(project_owner_id)
    recipients = [uid for uid in list(dict.fromkeys(recipients)) if uid != actor_id]
    if not recipients:
        return

    title = "Требуется помощь менеджера"
    body = f"{actor_name} запросил помощь по задаче «{task.title}». Отчет: {summary}"
    if blockers:
        body += f" | Блокеры: {blockers}"
    data = {
        "task_id": task.id,
        "project_id": task.project_id,
        "kind": "check_in_help_requested",
        "actor_id": actor_id,
    }

    for uid in recipients:
        await _create_notification(db, uid, "task_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    for uid in recipients:
        await ws_manager.send_to_user(uid, ev.TASK_UPDATED, data)


async def notify_team_status_reminder(
    db: AsyncSession,
    user_id: str,
    user_name: str,
    stale_tasks_count: int,
    max_inactive_days: int,
    control_ski_urgent_count: int = 0,
    focus_task_id: str | None = None,
    focus_project_id: str | None = None,
):
    title = "Напоминание по статусам задач"
    parts: list[str] = []
    if stale_tasks_count > 0:
        parts.append(
            f"есть {stale_tasks_count} задач(и) без обновления статуса "
            f"дольше рекомендуемого срока (до {max_inactive_days} дн.)"
        )
    if control_ski_urgent_count > 0:
        parts.append(
            f"{control_ski_urgent_count} задач(и) с флагом Контроль СКИ и дедлайном в ближайшие 5 дней"
        )
    details = "; ".join(parts) if parts else "проверьте актуальность статусов задач"
    body = f"{user_name}, {details}. Зайдите в PlannerBro и обновите статусы."
    if focus_task_id and focus_project_id:
        body += f" Быстрый переход: {_build_task_link(focus_project_id, focus_task_id)}"
    reminder_key = f"team-status:{datetime.now(timezone.utc).date().isoformat()}"
    existing = await db.execute(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.type == "team_status_reminder",
            Notification.data.contains({"reminder_key": reminder_key}),
        )
    )
    if existing.scalar_one_or_none():
        return

    data = {"kind": "team_status_reminder", "reminder_key": reminder_key}
    notif = await _create_notification(
        db,
        user_id,
        "team_status_reminder",
        title,
        body,
        data,
    )
    await db.commit()

    tokens = await _get_fcm_tokens(db, [user_id])
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.send_to_user(user_id, ev.TEAM_STATUS_REMINDER, {
        "notification_id": notif.id,
        "title": title,
        "body": body,
    })

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if not user:
        return
    target_email = _preferred_email(user, datetime.now(timezone.utc))
    if target_email:
        _send_email_to_recipients_background(
            [target_email],
            title,
            body,
            source="team_status_reminder",
            payload=data,
        )


async def _send_email_to_members(
    db: AsyncSession,
    user_ids: list[str],
    subject: str,
    body: str,
    source: str,
    payload: dict | None = None,
):
    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    now = datetime.now(timezone.utc)
    emails = []
    for user in result.scalars().all():
        target_email = _preferred_email(user, now)
        if target_email:
            emails.append(target_email)
    deduplicated = list(dict.fromkeys(emails))
    await _send_email_to_recipients(
        db,
        deduplicated,
        subject,
        body,
        source=source,
        payload=payload,
    )


async def send_management_gap_report(
    db: AsyncSession,
    missing_project_managers: list[tuple[str, str]],
    missing_task_managers: list[tuple[str, str, str]],
):
    target = (settings.MANAGEMENT_AUDIT_EMAIL or "").strip()
    if not target:
        return
    if not missing_project_managers and not missing_task_managers:
        return

    lines = [
        "Автоаудит PlannerBro: обнаружены объекты без менеджера/админа.",
        "",
        f"Проекты без менеджера/админа: {len(missing_project_managers)}",
    ]
    for project_id, project_name in missing_project_managers:
        lines.append(f"- {project_name} ({project_id}) -> {_build_project_link(project_id)}")

    lines.append("")
    lines.append(f"Задачи без менеджера/админа: {len(missing_task_managers)}")
    for task_id, task_title, project_id in missing_task_managers:
        lines.append(f"- {task_title} ({task_id}) -> {_build_task_link(project_id, task_id)}")

    subject = "PlannerBro audit: проекты/задачи без менеджера"
    await _send_email_to_recipients(
        db,
        [target],
        subject,
        "\n".join(lines),
        source="management_gap_report",
        payload={
            "missing_project_managers": len(missing_project_managers),
            "missing_task_managers": len(missing_task_managers),
        },
    )
