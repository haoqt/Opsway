"""
Notifier — Send build and uptime event notifications.
Channels: Webhook
"""
import logging
import json
import urllib.request

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

def send_notification(
    event: str,
    project_name: str,
    project_slug: str,
    branch_name: str,
    build_info: dict,
    notification_webhook_url: str | None = None,
):
    if not notification_webhook_url:
        return

    payload = {
        "event": event,
        "project": project_name,
        "project_slug": project_slug,
        "branch": branch_name,
        **build_info,
    }

    # ── Webhook ───────────────────────────────────────────────
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            notification_webhook_url, data=body,
            headers={"Content-Type": "application/json", "X-Opsway-Event": event},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info(f"Webhook notification sent: {event} → {notification_webhook_url} ({resp.status})")
    except Exception as e:
        logger.warning(f"Webhook notification failed: {e}")
