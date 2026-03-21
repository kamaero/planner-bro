from celery import Celery
from celery.schedules import crontab
from app.core.config import settings

celery_app = Celery(
    "planner-bro",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.beat_schedule = {
    "check-deadlines-hourly": {
        "task": "app.tasks.deadline_checker.check_deadlines",
        "schedule": crontab(minute=0),  # every hour at :00
    },
    "check-escalation-sla-every-10-min": {
        "task": "app.tasks.escalation_sla_checker.check_escalation_sla",
        "schedule": crontab(minute="*/10"),
    },
    "check-status-updates-daily": {
        "task": "app.tasks.status_update_reminder_checker.check_status_update_reminders",
        "schedule": crontab(minute=0, hour=9),
    },
    "management-audit-daily": {
        "task": "app.tasks.management_audit_checker.check_management_gaps",
        "schedule": crontab(minute=30, hour=9),
    },
    # Runtime schedule is resolved from report settings; check every 5 minutes.
    "telegram-projects-summary-scheduler-every-5-min": {
        "task": "app.tasks.telegram_summary_checker.send_projects_summary",
        "schedule": crontab(minute="*/5"),
    },
    "telegram-critical-summary-scheduler-every-5-min": {
        "task": "app.tasks.telegram_summary_checker.send_critical_tasks_summary",
        "schedule": crontab(minute="*/5"),
    },
    "email-analytics-summary-scheduler-every-5-min": {
        "task": "app.tasks.analytics_email_digest_checker.send_email_analytics_digest",
        "schedule": crontab(minute="*/5"),
    },
    "admin-directive-email-scheduler-every-5-min": {
        "task": "app.tasks.admin_directive_email_checker.send_admin_directive_email",
        "schedule": crontab(minute="*/5"),
    },
    "telegram-commands-poll-every-30s": {
        "task": "app.tasks.telegram_commands_checker.check_telegram_commands",
        "schedule": 30.0,
    },
    "email-log-cleanup-daily": {
        "task": "app.tasks.email_log_cleanup.cleanup_email_logs",
        "schedule": crontab(hour=3, minute=0),  # daily at 03:00 UTC
    },
}

celery_app.conf.timezone = "UTC"
celery_app.conf.imports = (
    "app.tasks.deadline_checker",
    "app.tasks.escalation_sla_checker",
    "app.tasks.status_update_reminder_checker",
    "app.tasks.management_audit_checker",
    "app.tasks.telegram_summary_checker",
    "app.tasks.analytics_email_digest_checker",
    "app.tasks.admin_directive_email_checker",
    "app.tasks.telegram_commands_checker",
    "app.tasks.ai_ingestion",
    "app.tasks.email_log_cleanup",
)
celery_app.autodiscover_tasks(["app.tasks"])
