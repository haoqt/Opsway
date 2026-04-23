"""
DB Clone task — Clone database + filestore from one branch to another.
Similar to Odoo.sh "Clone Production → Staging" feature.

Flow:
  1. pg_dump from source branch's PG container
  2. Drop/create target database
  3. pg_restore into target
  4. Clone filestore between containers
  5. Trigger neutralization (if target is non-production)
  6. Restart target Odoo container
"""
import logging
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.worker.celery_app import celery_app
from app.worker.tasks.neutralize import neutralize_database
from app.core.config import get_settings
from app.models import Branch, Project, EnvironmentType
from app.worker.docker_manager import DockerManager

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)


@celery_app.task(name="app.worker.tasks.db_clone.clone_database", queue="default")
def clone_database(source_branch_id: str, target_branch_id: str):
    """
    Clone database and filestore from source branch to target branch.
    
    1. pg_dump from source PG container
    2. Terminate connections + DROP/CREATE target DB
    3. pg_restore into target
    4. Pipe filestore tar between containers
    5. Auto-neutralize if target is non-production
    6. Restart target Odoo
    """
    docker_mgr = DockerManager()

    with SyncSession() as session:
        source = session.get(Branch, uuid.UUID(source_branch_id))
        target = session.get(Branch, uuid.UUID(target_branch_id))

        if not source or not target:
            logger.error(f"Source or target branch not found: {source_branch_id} → {target_branch_id}")
            return {"success": False, "error": "Branch not found"}

        if not source.db_name:
            logger.error(f"Source branch '{source.name}' has no database")
            return {"success": False, "error": "Source has no database"}

        project = session.get(Project, source.project_id)
        if not project:
            logger.error("Project not found")
            return {"success": False, "error": "Project not found"}

        # Verify both branches belong to same project
        if source.project_id != target.project_id:
            return {"success": False, "error": "Branches must belong to same project"}

        src_pg = docker_mgr.get_db_container_name(project.slug, source.name)
        tgt_pg = docker_mgr.get_db_container_name(project.slug, target.name)
        src_odoo = docker_mgr.get_container_name(project.slug, source.name)
        tgt_odoo = docker_mgr.get_container_name(project.slug, target.name)

        # Target DB name (reuse existing or generate)
        target_db = target.db_name or f"opsway_{project.slug}_{target.name.replace('/', '_')}"

        # ── Step 0: Mark as cloning ──────────────────────────
        target.current_task = "cloning"
        target.current_task_status = "running"
        session.commit()

        logger.info(f"🔄 Cloning DB: {source.name} ({source.db_name}) → {target.name} ({target_db})")
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                dump_path = os.path.join(tmpdir, "clone_dump.sql")
                filestore_path = os.path.join(tmpdir, "filestore.tar.gz")

                # ── Step 1: pg_dump from source ──────────────────
                logger.info(f"📦 Dumping source database '{source.db_name}' from {src_pg}...")
                cmd_dump = [
                    "docker", "exec", src_pg,
                    "pg_dump", "-U", "odoo", "-d", source.db_name, "-F", "c"
                ]
                with open(dump_path, "wb") as f_out:
                    proc = subprocess.run(cmd_dump, stdout=f_out, stderr=subprocess.PIPE)
                    if proc.returncode != 0:
                        raise Exception(f"pg_dump failed: {proc.stderr.decode('utf-8')}")

                dump_size = os.path.getsize(dump_path)
                logger.info(f"   ✅ Dump complete: {dump_size / 1024 / 1024:.1f} MB")

                # ── Step 2: Stop target Odoo (keep PG running) ───
                logger.info(f"⏸ Stopping target Odoo container {tgt_odoo}...")
                docker_mgr.stop_container(tgt_odoo)

                # ── Step 3: Ensure target PG is running ──────────
                tgt_pg_container = docker_mgr.get_container(tgt_pg)
                if not tgt_pg_container or tgt_pg_container.status != "running":
                    logger.info(f"🐘 Starting target PG container...")
                    docker_mgr.start_postgres_container(project.slug, target.name, target_db)
                    import time
                    time.sleep(5)  # Wait for PG to be ready

                # ── Step 4: Drop/Create target DB ────────────────
                logger.info(f"🗑 Resetting target database '{target_db}'...")
                
                # Terminate existing connections
                kill_stmt = (
                    f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    f"WHERE datname = '{target_db}' AND pid <> pg_backend_pid();"
                )
                docker_mgr.exec_command(tgt_pg, f'psql -U odoo -d postgres -c "{kill_stmt}"')
                docker_mgr.exec_command(tgt_pg, f'psql -U odoo -d postgres -c "DROP DATABASE IF EXISTS {target_db};"')
                docker_mgr.exec_command(tgt_pg, f'psql -U odoo -d postgres -c "CREATE DATABASE {target_db} OWNER odoo;"')

                # ── Step 5: pg_restore into target ───────────────
                logger.info(f"📥 Restoring into target database '{target_db}'...")
                cmd_restore = [
                    "docker", "exec", "-i", tgt_pg,
                    "pg_restore", "-U", "odoo", "-d", target_db, "--no-owner"
                ]
                with open(dump_path, "rb") as f_in:
                    proc = subprocess.run(cmd_restore, stdin=f_in, capture_output=True)
                    if proc.returncode != 0:
                        stderr = proc.stderr.decode("utf-8")
                        if "errors ignored on restore" not in stderr.lower():
                            logger.warning(f"pg_restore warning: {stderr}")

                logger.info("   ✅ Database restore complete")

                # ── Step 6: Clone filestore ──────────────────────
                src_odoo_container = docker_mgr.get_container(src_odoo)
                if src_odoo_container and src_odoo_container.status == "running":
                    filestore_src_path = f"/var/lib/odoo/filestore/{source.db_name}"
                    filestore_tgt_path = f"/var/lib/odoo/filestore/{target_db}"

                    logger.info(f"📁 Cloning filestore: {filestore_src_path} → {filestore_tgt_path}...")
                    
                    # Tar from source
                    cmd_tar = [
                        "docker", "exec", src_odoo,
                        "tar", "-czf", "-", filestore_src_path
                    ]
                    with open(filestore_path, "wb") as f_out:
                        proc = subprocess.run(cmd_tar, stdout=f_out, stderr=subprocess.PIPE)
                        if proc.returncode != 0:
                            logger.warning(f"Filestore tar warning: {proc.stderr.decode('utf-8')}")

                    # Restart target Odoo temporarily to extract filestore
                    tgt_container = docker_mgr.get_container(tgt_odoo)
                    if tgt_container:
                        tgt_container.start()
                        import time
                        time.sleep(3)

                        # Clear old filestore and extract new
                        docker_mgr.exec_command(tgt_odoo, f"rm -rf {filestore_tgt_path}")
                        docker_mgr.exec_command(tgt_odoo, f"mkdir -p {filestore_tgt_path}")

                        if os.path.exists(filestore_path) and os.path.getsize(filestore_path) > 0:
                            cmd_untar = [
                                "docker", "exec", "-i", tgt_odoo,
                                "tar", "-xzf", "-", "-C", "/"
                            ]
                            with open(filestore_path, "rb") as f_in:
                                proc = subprocess.run(cmd_untar, stdin=f_in, capture_output=True)
                                if proc.returncode != 0:
                                    logger.warning(f"Filestore extract warning: {proc.stderr.decode('utf-8')}")

                            # Rename filestore directory if source db name differs
                            if source.db_name != target_db:
                                docker_mgr.exec_command(
                                    tgt_odoo,
                                    f"mv {filestore_src_path} {filestore_tgt_path} 2>/dev/null || true"
                                )

                            logger.info("   ✅ Filestore cloned")
                        else:
                            logger.info("   ℹ No filestore to clone (empty or not found)")
                else:
                    logger.info("   ℹ Source Odoo not running, skipping filestore clone")

                # ── Step 7: Update target branch DB metadata ─────
                target.db_name = target_db
                target.cloned_from_branch_id = source.id
                target.current_task = None
                target.current_task_status = None
                session.commit()

                # ── Step 8: Restart target Odoo ──────────────────
                logger.info(f"🔄 Restarting target Odoo container {tgt_odoo}...")
                tgt_container = docker_mgr.get_container(tgt_odoo)
                if tgt_container:
                    tgt_container.restart()

                # ── Step 9: Auto-neutralize for non-production ───
                if target.environment != EnvironmentType.PRODUCTION:
                    logger.info("🔧 Triggering auto-neutralization for non-production branch...")
                    neutralize_database.delay(str(target.id))

                logger.info(f"🎉 Clone complete: {source.name} → {target.name}")

                return {
                    "success": True,
                    "source_branch": source.name,
                    "target_branch": target.name,
                    "database": target_db,
                    "auto_neutralize": target.environment != EnvironmentType.PRODUCTION,
                }

        except Exception as e:
            logger.error(f"❌ Clone failed: {e}", exc_info=True)
            
            with SyncSession() as err_session:
                err_target = err_session.get(Branch, uuid.UUID(target_branch_id))
                if err_target:
                    err_target.current_task_status = "failed"
                    err_session.commit()
            
            # Try to restart target Odoo
            try:
                tgt_container = docker_mgr.get_container(tgt_odoo)
                if tgt_container and tgt_container.status != "running":
                    tgt_container.start()
            except Exception:
                pass

            return {"success": False, "error": str(e)}
