from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.notification import Notification
from app.models.user import User
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.core.firebase import send_push_to_multiple
from app.services.websocket_manager import ws_manager
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


async def notify_task_assigned(db: AsyncSession, task: Task, assignee_id: str):
    if not assignee_id:
        return
    title = "Task Assigned"
    body = f"You have been assigned to: {task.title}"
    data = {"task_id": task.id, "project_id": task.project_id}
    notif = await _create_notification(db, assignee_id, "task_assigned", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, [assignee_id])
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.send_to_user(assignee_id, "task_assigned", {
        "notification_id": notif.id, "task_id": task.id, "title": title, "body": body
    })


async def notify_task_updated(db: AsyncSession, task: Task, actor_id: str):
    member_ids = await _get_project_member_ids(db, task.project_id)
    recipients = _exclude_ids(member_ids, [actor_id])
    if not recipients:
        return

    title = "Task Updated"
    body = f"Task '{task.title}' has been updated"
    data = {"task_id": task.id, "project_id": task.project_id}

    for uid in recipients:
        await _create_notification(db, uid, "task_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(task.project_id, "task_updated", {
        "task_id": task.id, "project_id": task.project_id
    })


async def notify_new_task(db: AsyncSession, task: Task):
    member_ids = await _get_project_member_ids(db, task.project_id)
    recipients = _exclude_ids(member_ids, [task.created_by_id, task.assigned_to_id] if task.assigned_to_id else [task.created_by_id])
    if not recipients:
        return
    title = "New Task Added"
    body = f"New task: {task.title}"
    data = {"task_id": task.id, "project_id": task.project_id}

    for uid in recipients:
        await _create_notification(db, uid, "new_task", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, recipients)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(task.project_id, "task_created", {
        "task_id": task.id, "project_id": task.project_id
    })


async def notify_project_updated(db: AsyncSession, project: Project):
    member_ids = await _get_project_member_ids(db, project.id)
    title = "Project Updated"
    body = f"Project '{project.name}' has been updated"
    data = {"project_id": project.id}

    for uid in member_ids:
        await _create_notification(db, uid, "project_updated", title, body, data)
    await db.commit()

    tokens = await _get_fcm_tokens(db, member_ids)
    if tokens:
        send_push_to_multiple(tokens, title, body, data)

    await ws_manager.broadcast_to_project(project.id, "project_updated", {"project_id": project.id})


async def notify_deadline(db: AsyncSession, task: Task, days_until: int):
    member_ids = await _get_project_member_ids(db, task.project_id)
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

    await ws_manager.broadcast_to_project(task.project_id, "deadline_warning", data)


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
