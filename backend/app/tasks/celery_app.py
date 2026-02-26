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
    # Asia/Yekaterinburg (UTC+5): Mon 08:00 => Mon 03:00 UTC
    "telegram-projects-summary-mon-0800-yekt": {
        "task": "app.tasks.telegram_summary_checker.send_projects_summary",
        "schedule": crontab(minute=0, hour=3, day_of_week="mon"),
    },
    # Asia/Yekaterinburg (UTC+5): Fri 16:00 => Fri 11:00 UTC
    "telegram-projects-summary-fri-1600-yekt": {
        "task": "app.tasks.telegram_summary_checker.send_projects_summary",
        "schedule": crontab(minute=0, hour=11, day_of_week="fri"),
    },
    # Asia/Yekaterinburg (UTC+5): daily 10:00 => 05:00 UTC
    "telegram-critical-summary-daily-1000-yekt": {
        "task": "app.tasks.telegram_summary_checker.send_critical_tasks_summary",
        "schedule": crontab(minute=0, hour=5),
    },
    "telegram-commands-poll-every-30s": {
        "task": "app.tasks.telegram_commands_checker.check_telegram_commands",
        "schedule": 30.0,
    },
}

celery_app.conf.timezone = "UTC"
celery_app.conf.imports = (
    "app.tasks.deadline_checker",
    "app.tasks.escalation_sla_checker",
    "app.tasks.status_update_reminder_checker",
    "app.tasks.management_audit_checker",
    "app.tasks.telegram_summary_checker",
    "app.tasks.telegram_commands_checker",
    "app.tasks.ai_ingestion",
)
celery_app.autodiscover_tasks(["app.tasks"])
