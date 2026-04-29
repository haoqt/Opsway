"""
Uptime monitoring — periodic HTTP health checks per branch.
Alerts on status change (down/recovered) via configured notification channels.
"""
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)

MAX_CHECKS_PER_BRANCH = 200


@celery_app.task(name="app.worker.tasks.uptime.check_all_uptime")
def check_all_uptime():
    """Fan out per-branch uptime checks. Runs on beat schedule every 60s."""
    from app.models import Branch

    with SyncSession() as session:
        branches = session.query(Branch).filter(
            Branch.is_active == True,
            Branch.container_url != None,
            Branch.container_status == "running",
        ).all()
        branch_ids = [str(b.id) for b in branches]

    for bid in branch_ids:
        check_branch_uptime.delay(bid)


@celery_app.task(name="app.worker.tasks.uptime.check_branch_uptime")
def check_branch_uptime(branch_id: str):
    from app.models import Branch, UptimeCheck, UptimeStatus, Project
    from app.worker.notifier import send_notification

    with SyncSession() as session:
        branch = session.query(Branch).filter(Branch.id == branch_id).first()
        if not branch or not branch.container_url:
            return
        project = session.query(Project).filter(Project.id == branch.project_id).first()
        if not project:
            return

        previous_status = branch.uptime_status

        # HTTP check
        start = datetime.now(timezone.utc)
        response_ms = None
        error_msg = None
        new_status = UptimeStatus.UNKNOWN

        try:
            req = urllib.request.Request(branch.container_url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                elapsed = (datetime.now(timezone.utc) - start).total_seconds()
                response_ms = int(elapsed * 1000)
                new_status = UptimeStatus.UP if resp.status < 500 else UptimeStatus.DOWN
                if resp.status >= 500:
                    error_msg = f"HTTP {resp.status}"
        except urllib.error.HTTPError as e:
            elapsed = (datetime.now(timezone.utc) - start).total_seconds()
            response_ms = int(elapsed * 1000)
            if e.code < 500:
                new_status = UptimeStatus.UP
            else:
                new_status = UptimeStatus.DOWN
                error_msg = f"HTTP {e.code}"
        except Exception as e:
            new_status = UptimeStatus.DOWN
            error_msg = str(e)[:200]

        now = datetime.now(timezone.utc)

        check = UptimeCheck(
            branch_id=branch.id,
            status=new_status,
            response_ms=response_ms,
            error=error_msg,
            checked_at=now,
        )
        session.add(check)

        branch.uptime_status = new_status
        branch.uptime_last_checked_at = now
        branch.uptime_response_ms = response_ms
        session.commit()

        # Prune old records
        old_checks = (
            session.query(UptimeCheck)
            .filter(UptimeCheck.branch_id == branch.id)
            .order_by(UptimeCheck.checked_at.desc())
            .offset(MAX_CHECKS_PER_BRANCH)
            .all()
        )
        for old in old_checks:
            session.delete(old)
        session.commit()

        # Alert on status transition
        if new_status != previous_status and new_status in (UptimeStatus.DOWN, UptimeStatus.UP):
            event = "uptime_down" if new_status == UptimeStatus.DOWN else "uptime_up"
            send_notification(
                event=event,
                project_name=project.name,
                project_slug=project.slug,
                branch_name=branch.name,
                build_info={"error_message": error_msg, "response_ms": response_ms},
                notification_email=project.notification_email,
                notification_webhook_url=project.notification_webhook_url,
                notification_slack_url=project.notification_slack_url,
                notification_telegram_bot_token=project.notification_telegram_bot_token,
                notification_telegram_chat_id=project.notification_telegram_chat_id,
            )
