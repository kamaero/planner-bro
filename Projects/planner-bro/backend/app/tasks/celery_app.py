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
}

celery_app.conf.timezone = "UTC"
celery_app.autodiscover_tasks(["app.tasks"])
