import asyncio
from dataclasses import dataclass

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.user import User
from app.services.analytics_digest_service import (
    build_digest_fingerprint,
    collect_analytics_digest,
    format_email_digest_html,
    format_email_digest_subject,
    format_email_digest_text,
    normalize_digest_filters,
)
from app.services.notification_service import _send_email_to_recipients
from app.services.report_settings_service import (
    claim_schedule_slot_once,
    evaluate_schedule_due,
    get_email_analytics_enabled,
    get_email_analytics_recipients,
    get_report_dispatch_schedule,
    get_report_digest_filters,
    should_send_digest,
)
from app.services.system_activity_service import log_system_activity_standalone
from app.tasks.celery_app import celery_app


@dataclass(slots=True)
class RecipientSpec:
    email: str
    user: User | None
    scope_key: str


@celery_app.task(name="app.tasks.analytics_email_digest_checker.send_email_analytics_digest")
def send_email_analytics_digest(compact: bool = False, force: bool = False):
    asyncio.run(_async_send_email_analytics_digest(compact=compact, force=force))


def _preferred_email(user: User) -> str:
    return (user.work_email or user.email or "").strip().lower()


def _role_rank(user: User) -> int:
    if user.role == "admin":
        return 4
    if user.role == "manager":
        return 3
    if user.can_manage_team:
        return 2
    return 1


async def _resolve_recipient_specs(db) -> list[RecipientSpec]:
    users = (
        await db.execute(
            select(User).where(
                User.is_active == True,  # noqa: E712
            )
        )
    ).scalars().all()

    by_email: dict[str, RecipientSpec] = {}
    for user in users:
        email = _preferred_email(user)
        if "@" not in email:
            continue
        spec = RecipientSpec(email=email, user=user, scope_key=f"user:{user.id}")
        existing = by_email.get(email)
        if not existing:
            by_email[email] = spec
            continue
        if existing.user is None or _role_rank(user) > _role_rank(existing.user):
            by_email[email] = spec

    runtime_recipients = await get_email_analytics_recipients()
    for raw_email in runtime_recipients.split(","):
        email = raw_email.strip().lower()
        if "@" not in email or email in by_email:
            continue
        by_email[email] = RecipientSpec(email=email, user=None, scope_key="global")

    return list(by_email.values())


async def _async_send_email_analytics_digest(compact: bool = False, force: bool = False) -> None:
    runtime_enabled = await get_email_analytics_enabled()
    if not runtime_enabled and not force:
        return

    dispatch_schedule = await get_report_dispatch_schedule()
    include_projects = bool(dispatch_schedule.get("email_projects_enabled", True))
    include_critical = bool(dispatch_schedule.get("email_critical_enabled", True))
    if not (include_projects or include_critical):
        return

    slot_stamp: str | None = None
    if not force:
        is_due, due_stamp = evaluate_schedule_due(dispatch_schedule, "email_analytics_slots")
        if not is_due:
            return
        slot_stamp = due_stamp

    digest_filters_raw = await get_report_digest_filters()
    digest_filters = normalize_digest_filters(digest_filters_raw)
    anti_noise_enabled = bool(digest_filters_raw.get("anti_noise_enabled", True))
    anti_noise_ttl_minutes = int(digest_filters_raw.get("anti_noise_ttl_minutes", 360))

    sent_count = 0
    skipped_noise_count = 0
    failed_count = 0

    async with AsyncSessionLocal() as db:
        recipient_specs = await _resolve_recipient_specs(db)
        for spec in recipient_specs:
            try:
                if slot_stamp and not await claim_schedule_slot_once(
                    channel="email",
                    recipient_key=spec.email,
                    digest_key="analytics",
                    slot_stamp=slot_stamp,
                ):
                    continue

                digest = await collect_analytics_digest(
                    db,
                    compact=compact,
                    viewer=spec.user,
                    filters=digest_filters,
                )
                topic_signature = f"p{int(include_projects)}c{int(include_critical)}"
                fingerprint = build_digest_fingerprint(digest, section=f"all:{topic_signature}")
                if anti_noise_enabled and not force:
                    can_send = await should_send_digest(
                        channel="email",
                        recipient_key=spec.email,
                        digest_key=f"{spec.scope_key}:{topic_signature}",
                        fingerprint=fingerprint,
                        ttl_minutes=anti_noise_ttl_minutes,
                    )
                    if not can_send:
                        skipped_noise_count += 1
                        continue

                subject = format_email_digest_subject(digest)
                text_body = format_email_digest_text(
                    digest,
                    compact=compact,
                    include_projects=include_projects,
                    include_critical=include_critical,
                )
                html_body = format_email_digest_html(
                    digest,
                    compact=compact,
                    include_projects=include_projects,
                    include_critical=include_critical,
                )
                await _send_email_to_recipients(
                    db,
                    recipients=[spec.email],
                    subject=subject,
                    body=text_body,
                    html_body=html_body,
                    source="analytics_email_digest_scoped",
                    payload={
                        "compact": compact,
                        "force": force,
                        "scope": spec.scope_key,
                        "topics": {
                            "projects": include_projects,
                            "critical": include_critical,
                        },
                        "projects_count": digest.active_projects_count,
                        "critical_tasks_count": digest.critical_tasks_count,
                    },
                )
                sent_count += 1
            except Exception as exc:
                failed_count += 1
                await log_system_activity_standalone(
                    source="analytics_email",
                    category="email_error",
                    level="error",
                    message="Scoped analytics email digest failed",
                    details={
                        "compact": compact,
                        "force": force,
                        "recipient": spec.email,
                        "scope": spec.scope_key,
                        "error": str(exc),
                    },
                )

    await log_system_activity_standalone(
        source="analytics_email",
        category="email",
        level="info",
        message="Scoped analytics email digest completed",
        details={
            "compact": compact,
            "force": force,
            "sent": sent_count,
            "skipped_noise": skipped_noise_count,
            "failed": failed_count,
        },
    )
