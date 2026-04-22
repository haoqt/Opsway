"""
Celery app + Worker configuration
"""
from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "opsway",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.worker.tasks.build",
        "app.worker.tasks.cleanup",
        "app.worker.tasks.backup",
        "app.worker.tasks.restore",
        "app.worker.tasks.repo",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.worker.tasks.build.*": {"queue": "builds"},
        "app.worker.tasks.backup.*": {"queue": "default"},
        "app.worker.tasks.restore.*": {"queue": "default"},
        "app.worker.tasks.cleanup.*": {"queue": "default"},
    },
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_reject_on_worker_lost=True,
    # Beat schedule
    beat_schedule={
        "cleanup-old-builds": {
            "task": "app.worker.tasks.cleanup.cleanup_old_builds",
            "schedule": 3600.0,  # Every hour
        },
        "daily-backup": {
            "task": "app.worker.tasks.backup.run_daily_backups",
            "schedule": 86400.0,  # Every 24h
        },
    },
)
