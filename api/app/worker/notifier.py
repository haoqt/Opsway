"""
Notifier — Send build event notifications via Email and/or Webhook.
Supports: build_started, build_success, build_failed
"""
import logging
import smtplib
import json
import urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _build_email_body(event: str, project_name: str, branch_name: str, build_info: dict) -> str:
    status_emoji = {"build_success": "✅", "build_failed": "❌", "build_started": "🚀"}.get(event, "📦")
    duration = build_info.get("duration_seconds")
    duration_str = f"{duration}s" if duration else "—"
    commit = build_info.get("commit_sha", "")[:8]
    commit_msg = build_info.get("commit_message", "")
    error = build_info.get("error_message", "")

    lines = [
        f"<h2>{status_emoji} Build {event.replace('build_', '').upper()}</h2>",
        f"<p><strong>Project:</strong> {project_name}</p>",
        f"<p><strong>Branch:</strong> {branch_name}</p>",
        f"<p><strong>Commit:</strong> <code>{commit}</code> — {commit_msg}</p>",
        f"<p><strong>Duration:</strong> {duration_str}</p>",
    ]
    if error:
        lines.append(f"<p><strong>Error:</strong> <code style='color:red'>{error[:500]}</code></p>")

    return "".join(lines)


def send_notification(
    event: str,
    project_name: str,
    project_slug: str,
    branch_name: str,
    build_info: dict,
    notification_email: str | None = None,
    notification_webhook_url: str | None = None,
):
    """
    Send build event notification.
    
    event: 'build_started' | 'build_success' | 'build_failed'
    build_info: dict with commit_sha, commit_message, duration_seconds, error_message
    """
    if not notification_email and not notification_webhook_url:
        return

    payload = {
        "event": event,
        "project": project_name,
        "project_slug": project_slug,
        "branch": branch_name,
        **build_info,
    }

    # ── Send Webhook ──────────────────────────────────────────
    if notification_webhook_url:
        try:
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                notification_webhook_url,
                data=body,
                headers={"Content-Type": "application/json", "X-Opsway-Event": event},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.info(f"Webhook notification sent: {event} → {notification_webhook_url} ({resp.status})")
        except Exception as e:
            logger.warning(f"Webhook notification failed: {e}")

    # ── Send Email ────────────────────────────────────────────
    if notification_email and settings.smtp_host:
        try:
            subject_map = {
                "build_started": f"🚀 Build started — {project_name}/{branch_name}",
                "build_success": f"✅ Build succeeded — {project_name}/{branch_name}",
                "build_failed": f"❌ Build FAILED — {project_name}/{branch_name}",
            }
            subject = subject_map.get(event, f"📦 Opsway build event: {event}")
            body_html = _build_email_body(event, project_name, branch_name, build_info)

            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from or "opsway@noreply.local"
            msg["To"] = notification_email
            msg.attach(MIMEText(body_html, "html"))

            with smtplib.SMTP(settings.smtp_host, settings.smtp_port or 25) as server:
                if settings.smtp_user and settings.smtp_password:
                    server.starttls()
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(msg["From"], [notification_email], msg.as_string())

            logger.info(f"Email notification sent: {event} → {notification_email}")
        except Exception as e:
            logger.warning(f"Email notification failed: {e}")
    elif notification_email and not settings.smtp_host:
        logger.info(f"Email notification skipped (no SMTP_HOST configured): {event} → {notification_email}")
