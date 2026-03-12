import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from zoneinfo import ZoneInfo

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


@dataclass(slots=True)
class ScheduleContext:
    mode: str  # "window" | "legacy"
    due: bool
    slot_stamp: str | None
    slot_token: str | None
    window_label: str | None
    current_bucket: int | None
    bucket_count: int | None


_WINDOW_START_HOURS = {6, 9, 12, 15}
_DAY_TO_WEEKDAY = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


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


def _recipient_bucket_for_slot(recipient_email: str, day_iso: str, slot_token: str, bucket_count: int) -> int:
    digest_seed = f"{recipient_email}:{day_iso}:{slot_token}"
    digest = hashlib.sha256(digest_seed.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % max(1, bucket_count)


def _resolve_schedule_context(dispatch_schedule: dict, now_utc: datetime | None = None) -> ScheduleContext:
    tz_name = str(dispatch_schedule.get("timezone") or "Asia/Yekaterinburg")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Asia/Yekaterinburg")
    now_local = (now_utc or datetime.now(timezone.utc)).astimezone(tz)
    slots = dispatch_schedule.get("email_analytics_slots") or []
    if not isinstance(slots, list):
        slots = []
    has_window_slots = False

    for raw_slot in slots:
        token = str(raw_slot).strip().lower()
        if "@" not in token:
            continue
        day, tm = token.split("@", 1)
        if day != "daily" and _DAY_TO_WEEKDAY.get(day) != now_local.weekday():
            continue
        parts = tm.split(":")
        if len(parts) != 2:
            continue
        try:
            hh = int(parts[0])
            mm = int(parts[1])
        except ValueError:
            continue
        if hh not in _WINDOW_START_HOURS:
            continue
        has_window_slots = True
        if mm < 0 or mm > 59:
            continue

        end_hour = hh + 3
        if now_local.hour < hh or now_local.hour >= end_hour:
            continue

        total_minutes = (end_hour - hh) * 60
        buckets = max(1, total_minutes // 5)
        elapsed_minutes = (now_local.hour - hh) * 60 + now_local.minute
        current_bucket = min(buckets - 1, max(0, elapsed_minutes // 5))
        return ScheduleContext(
            mode="window",
            due=True,
            slot_stamp=None,
            slot_token=token,
            window_label=f"{hh:02d}:00-{end_hour:02d}:00",
            current_bucket=current_bucket,
            bucket_count=buckets,
        )

    if has_window_slots:
        return ScheduleContext(
            mode="window",
            due=False,
            slot_stamp=None,
            slot_token=None,
            window_label=None,
            current_bucket=None,
            bucket_count=None,
        )

    # Legacy slots (for older/manual configs): exact timestamp behavior.
    is_due, due_stamp = evaluate_schedule_due(dispatch_schedule, "email_analytics_slots")
    return ScheduleContext(
        mode="legacy",
        due=is_due,
        slot_stamp=due_stamp,
        slot_token=None,
        window_label=None,
        current_bucket=None,
        bucket_count=None,
    )


async def _async_send_email_analytics_digest(compact: bool = False, force: bool = False) -> None:
    runtime_enabled = await get_email_analytics_enabled()
    if not runtime_enabled and not force:
        return

    dispatch_schedule = await get_report_dispatch_schedule()
    include_projects = bool(dispatch_schedule.get("email_projects_enabled", True))
    include_critical = bool(dispatch_schedule.get("email_critical_enabled", True))
    if not (include_projects or include_critical):
        return

    digest_filters_raw = await get_report_digest_filters()
    digest_filters = normalize_digest_filters(digest_filters_raw)
    anti_noise_enabled = bool(digest_filters_raw.get("anti_noise_enabled", True))
    anti_noise_ttl_minutes = int(digest_filters_raw.get("anti_noise_ttl_minutes", 360))

    sent_count = 0
    queued_later_count = 0
    claimed_already_count = 0
    skipped_noise_count = 0
    failed_count = 0

    async with AsyncSessionLocal() as db:
        schedule_ctx = _resolve_schedule_context(dispatch_schedule)
        if not force and not schedule_ctx.due:
            return

        tz_name = str(dispatch_schedule.get("timezone") or "Asia/Yekaterinburg")
        try:
            dispatch_tz = ZoneInfo(tz_name)
        except Exception:
            dispatch_tz = ZoneInfo("Asia/Yekaterinburg")
        day_iso = datetime.now(timezone.utc).astimezone(dispatch_tz).date().isoformat()

        recipient_specs = await _resolve_recipient_specs(db)
        for spec in recipient_specs:
            try:
                if not force:
                    if schedule_ctx.mode == "window":
                        if not schedule_ctx.slot_token or schedule_ctx.bucket_count is None or schedule_ctx.current_bucket is None:
                            continue
                        recipient_bucket = _recipient_bucket_for_slot(
                            spec.email,
                            day_iso=day_iso,
                            slot_token=schedule_ctx.slot_token,
                            bucket_count=schedule_ctx.bucket_count,
                        )
                        if recipient_bucket != schedule_ctx.current_bucket:
                            queued_later_count += 1
                            continue
                        slot_stamp = f"{day_iso}:{schedule_ctx.slot_token}:b{recipient_bucket}"
                    else:
                        slot_stamp = schedule_ctx.slot_stamp
                    if not slot_stamp:
                        continue
                    if not await claim_schedule_slot_once(
                        channel="email",
                        recipient_key=spec.email,
                        digest_key="analytics",
                        slot_stamp=slot_stamp,
                    ):
                        claimed_already_count += 1
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
        message=(
            f"Email digest queue tick: sent {sent_count}, queued {queued_later_count}, "
            f"noise {skipped_noise_count}, failed {failed_count}"
            if schedule_ctx.mode == "window"
            else f"Scoped analytics email digest completed: sent {sent_count}, noise {skipped_noise_count}, failed {failed_count}"
        ),
        details={
            "compact": compact,
            "force": force,
            "schedule_mode": schedule_ctx.mode,
            "window": schedule_ctx.window_label,
            "current_bucket": (
                None
                if schedule_ctx.current_bucket is None or schedule_ctx.bucket_count is None
                else f"{schedule_ctx.current_bucket + 1}/{schedule_ctx.bucket_count}"
            ),
            "total_recipients": len(recipient_specs),
            "queued_later": queued_later_count,
            "already_claimed": claimed_already_count,
            "sent": sent_count,
            "skipped_noise": skipped_noise_count,
            "failed": failed_count,
        },
    )
