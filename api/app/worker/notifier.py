"""
Notifier — Send build and uptime event notifications.
Channels: Email, Webhook, Slack, Telegram
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


def _build_text(event: str, project_name: str, branch_name: str, build_info: dict) -> str:
    emoji = {
        "build_success": "✅", "build_failed": "❌", "build_started": "🚀",
        "uptime_down": "🔴", "uptime_up": "🟢",
    }.get(event, "📦")
    duration = build_info.get("duration_seconds")
    duration_str = f"{duration}s" if duration else ""
    commit = build_info.get("commit_sha", "")[:8]
    parts = [f"{emoji} *{event.replace('_', ' ').upper()}*", f"Project: {project_name}  Branch: {branch_name}"]
    if commit:
        parts.append(f"Commit: `{commit}` — {build_info.get('commit_message', '')[:80]}")
    if duration_str:
        parts.append(f"Duration: {duration_str}")
    if build_info.get("error_message"):
        parts.append(f"Error: {build_info['error_message'][:300]}")
    return "\n".join(parts)


def _build_email_body(event: str, project_name: str, branch_name: str, build_info: dict) -> str:
    status_emoji = {
        "build_success": "✅", "build_failed": "❌", "build_started": "🚀",
        "uptime_down": "🔴", "uptime_up": "🟢",
    }.get(event, "📦")
    duration = build_info.get("duration_seconds")
    duration_str = f"{duration}s" if duration else "—"
    commit = build_info.get("commit_sha", "")[:8]
    commit_msg = build_info.get("commit_message", "")
    error = build_info.get("error_message", "")

    lines = [
        f"<h2>{status_emoji} {event.replace('_', ' ').upper()}</h2>",
        f"<p><strong>Project:</strong> {project_name}</p>",
        f"<p><strong>Branch:</strong> {branch_name}</p>",
    ]
    if commit:
        lines.append(f"<p><strong>Commit:</strong> <code>{commit}</code> — {commit_msg}</p>")
    if duration_str != "—":
        lines.append(f"<p><strong>Duration:</strong> {duration_str}</p>")
    if error:
        lines.append(f"<p><strong>Error:</strong> <code style='color:red'>{error[:500]}</code></p>")
    return "".join(lines)


def _send_slack(url: str, text: str, event: str):
    try:
        body = json.dumps({"text": text}).encode("utf-8")
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info(f"Slack notification sent: {event} ({resp.status})")
    except Exception as e:
        logger.warning(f"Slack notification failed: {e}")


def _send_telegram(bot_token: str, chat_id: str, text: str, event: str):
    try:
        body = json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info(f"Telegram notification sent: {event} ({resp.status})")
    except Exception as e:
        logger.warning(f"Telegram notification failed: {e}")


def send_notification(
    event: str,
    project_name: str,
    project_slug: str,
    branch_name: str,
    build_info: dict,
    notification_email: str | None = None,
    notification_webhook_url: str | None = None,
    notification_slack_url: str | None = None,
    notification_telegram_bot_token: str | None = None,
    notification_telegram_chat_id: str | None = None,
):
    has_any = any([
        notification_email, notification_webhook_url,
        notification_slack_url,
        notification_telegram_bot_token and notification_telegram_chat_id,
    ])
    if not has_any:
        return

    payload = {
        "event": event,
        "project": project_name,
        "project_slug": project_slug,
        "branch": branch_name,
        **build_info,
    }
    text = _build_text(event, project_name, branch_name, build_info)

    # ── Webhook ───────────────────────────────────────────────
    if notification_webhook_url:
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

    # ── Slack ─────────────────────────────────────────────────
    if notification_slack_url:
        _send_slack(notification_slack_url, text, event)

    # ── Telegram ──────────────────────────────────────────────
    if notification_telegram_bot_token and notification_telegram_chat_id:
        _send_telegram(notification_telegram_bot_token, notification_telegram_chat_id, text, event)

    # ── Email ─────────────────────────────────────────────────
    if notification_email and settings.smtp_host:
        try:
            subject_map = {
                "build_started": f"🚀 Build started — {project_name}/{branch_name}",
                "build_success": f"✅ Build succeeded — {project_name}/{branch_name}",
                "build_failed": f"❌ Build FAILED — {project_name}/{branch_name}",
                "uptime_down": f"🔴 DOWN — {project_name}/{branch_name}",
                "uptime_up": f"🟢 Recovered — {project_name}/{branch_name}",
            }
            subject = subject_map.get(event, f"📦 Opsway: {event}")
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
        logger.info(f"Email notification skipped (no SMTP_HOST): {event} → {notification_email}")
