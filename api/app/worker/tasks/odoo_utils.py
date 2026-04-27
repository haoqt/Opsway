import logging
from app.worker.docker_manager import DockerManager

logger = logging.getLogger(__name__)

def clear_odoo_assets(docker_mgr: DockerManager, pg_container: str, db_name: str, log_fn=None):
    """
    Clear Odoo asset cache in the database.
    This forces Odoo to regenerate CSS/JS bundles.
    """
    if log_fn:
        log_fn("🧹 Clearing Odoo asset cache (forcing bundle regeneration)...")
    else:
        logger.info(f"Clearing Odoo assets for {db_name}")

    # Delete asset-related attachments. 
    # Works for Odoo 12, 13, 14, 15, 16, 17.
    query = "DELETE FROM ir_attachment WHERE url LIKE '/web/assets/%';"
    
    exit_code, output = docker_mgr.exec_command(
        pg_container,
        f'psql -U odoo -d {db_name} -c "{query}"'
    )
    
    if exit_code != 0:
        if "does not exist" in output or "relation" in output:
             if log_fn: log_fn("   ℹ ir_attachment table not found, skipping asset clear.")
        else:
             if log_fn: log_fn(f"   ⚠️ Warning: Failed to clear assets: {output.strip()}")
    else:
        if log_fn: log_fn(f"   ✅ Asset cache cleared: {output.strip()}")
