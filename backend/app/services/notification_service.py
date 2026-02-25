from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.notification import Notification
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.core.firebase import send_push_to_multiple
from app.services.websocket_manager import ws_manager
from app.services import events as ev
import aiosmtplib
from email.mime.text import MIMEText
from app.core.config import settings


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


async def notify_task_assigned(db: AsyncSession, task: Task, assignee_id: str):
    if not assignee_id:
        return
    title = "Новая задача на вас"
    body = f"Вам назначена задача «{task.title}»."
    if task.end_date:
        body += f" Дедлайн: {task.end_date.isoformat()}."
    data = {"task_id": task.id, "project_id": task.project_id, "kind": "task_assigned"}
    notif = await _create_notification(db, assignee_id, "task_assigned", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, [assignee_id])
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.send_to_user(assignee_id, ev.TASK_ASSIGNED, {
        "notification_id": notif.id, "task_id": task.id, "title": title, "body": body
    })


async def notify_task_updated(db: AsyncSession, task: Task, actor_id: str):
    member_ids = await _get_project_member_ids(db, task.project_id)
    recipients = _exclude_ids(member_ids, [actor_id])
    if not recipients:
        return

    status_labels = {
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
    title = f"Deadline {'Approaching' if days_until > 0 else 'Missed'}"
    body = (
        f"Task '{task.title}' deadline is in {days_until} day(s)"
        if days_until > 0
        else f"Task '{task.title}' deadline has passed"
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
        await _send_email_to_members(db, member_ids, title, body)

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


async def _send_email_to_members(db: AsyncSession, user_ids: list[str], subject: str, body: str):
    if not settings.SMTP_USER:
        return
    result = await db.execute(select(User.email).where(User.id.in_(user_ids)))
    emails = [row[0] for row in result.all()]
    for email in emails:
        msg = MIMEText(body, "plain")
        msg["Subject"] = subject
        msg["From"] = settings.EMAILS_FROM
        msg["To"] = email
        try:
            await aiosmtplib.send(
                msg,
                hostname=settings.SMTP_HOST,
                port=settings.SMTP_PORT,
                username=settings.SMTP_USER,
                password=settings.SMTP_PASSWORD,
                start_tls=True,
            )
        except Exception:
            pass
