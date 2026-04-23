"""
Neutralize task — Disable dangerous features when cloning production data
to non-production environments (like Odoo.sh does).

Actions:
  1. Disable all ir.cron (scheduled actions)
  2. Mask/redirect mail servers to MailHog
  3. Disable fetchmail servers
  4. Clear OAuth tokens and webhook URLs
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.worker.celery_app import celery_app
from app.core.config import get_settings
from app.models import Branch, Project
from app.worker.docker_manager import DockerManager

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)

# SQL statements to neutralize an Odoo database
NEUTRALIZE_QUERIES = [
    # 1. Disable all scheduled actions (ir.cron)
    ("Disabling scheduled actions (ir.cron)", 
     "UPDATE ir_cron SET active = false WHERE active = true;"),

    # 2. Redirect mail servers to MailHog
    ("Redirecting mail servers to MailHog",
     "UPDATE ir_mail_server SET smtp_host = 'mailhog', smtp_port = 1025, "
     "smtp_user = '', smtp_pass = '', smtp_encryption = 'none' "
     "WHERE active = true;"),

    # 3. Disable fetchmail servers
    ("Disabling fetchmail servers",
     "UPDATE fetchmail_server SET active = false WHERE active = true;"),

    # 4. Clear OAuth provider tokens (if table exists)
    ("Clearing OAuth tokens",
     "UPDATE auth_oauth_provider SET enabled = false WHERE enabled = true;"),

    # 5. Disable outgoing mail by setting a catch-all
    ("Setting system mail catchall",
     "UPDATE ir_config_parameter SET value = 'catchall@localhost' "
     "WHERE key = 'mail.catchall.domain';"),

    # 6. Clear webhook URLs (mail.bounce.alias)
    ("Clearing bounce alias",
     "UPDATE ir_config_parameter SET value = 'bounce-neutralized' "
     "WHERE key = 'mail.bounce.alias';"),
]


def _run_sql_safe(docker_mgr: DockerManager, pg_container: str, db_name: str, 
                  description: str, sql: str) -> tuple[bool, str]:
    """Run a SQL query safely, ignoring errors for missing tables."""
    logger.info(f"  → {description}")
    exit_code, output = docker_mgr.exec_command(
        pg_container,
        f'psql -U odoo -d {db_name} -c "{sql}"'
    )
    if exit_code != 0:
        # Some tables might not exist (e.g., fetchmail not installed)
        if "does not exist" in output or "relation" in output:
            logger.info(f"    ⚠ Skipped (table not found): {output.strip()}")
            return True, "skipped"
        logger.warning(f"    ✗ Failed: {output.strip()}")
        return False, output.strip()
    
    logger.info(f"    ✓ Done: {output.strip()}")
    return True, output.strip()


@celery_app.task(name="app.worker.tasks.neutralize.neutralize_database", queue="default")
def neutralize_database(branch_id: str):
    """
    Neutralize an Odoo database for non-production use.
    
    This disables cron jobs, redirects mail to MailHog, and clears
    sensitive credentials — exactly like Odoo.sh does when cloning
    production to staging.
    """
    docker_mgr = DockerManager()

    with SyncSession() as session:
        branch = session.get(Branch, uuid.UUID(branch_id))
        if not branch:
            logger.error(f"Branch {branch_id} not found")
            return {"success": False, "error": "Branch not found"}

        if not branch.db_name:
            logger.error(f"Branch {branch_id} has no database")
            return {"success": False, "error": "No database assigned"}

        project = session.get(Project, branch.project_id)
        pg_container = docker_mgr.get_db_container_name(project.slug, branch.name)

        logger.info(f"🔧 Neutralizing database '{branch.db_name}' for branch '{branch.name}'...")
        
        branch.current_task = "neutralizing"
        branch.current_task_status = "running"
        session.commit()
        
        try:
            results = []
            all_success = True

            for description, sql in NEUTRALIZE_QUERIES:
                success, output = _run_sql_safe(docker_mgr, pg_container, branch.db_name, 
                                                description, sql)
                results.append({"action": description, "success": success, "output": output})
                if not success:
                    all_success = False

            # Update branch neutralization status
            branch.is_neutralized = True
            branch.neutralized_at = datetime.now(timezone.utc)
            branch.current_task = None
            branch.current_task_status = None
            session.commit()

            status = "✅ Neutralization complete" if all_success else "⚠️ Neutralization completed with some warnings"
            logger.info(f"{status} for branch '{branch.name}'")

            return {
                "success": True,
                "branch_id": branch_id,
                "actions": results,
                "all_success": all_success,
            }

        except Exception as e:
            logger.error(f"❌ Neutralization failed: {e}", exc_info=True)
            with SyncSession() as err_session:
                err_branch = err_session.get(Branch, uuid.UUID(branch_id))
                if err_branch:
                    err_branch.current_task_status = "failed"
                    err_session.commit()
            return {"success": False, "error": str(e)}
