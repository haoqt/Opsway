"""Restore task — Download from MinIO → Restore DB + Filestore."""
import logging
import subprocess
import os
import tarfile
import tempfile
import uuid
import shutil

from app.worker.celery_app import celery_app
from app.worker.tasks.build import SyncSession, _publish_log
from app.worker.tasks.backup import get_minio_client
from app.core.config import get_settings
from app.models import Branch, Project, Backup, Build, BuildStatus, utcnow, EnvironmentType
from app.worker.tasks.neutralize import neutralize_database
from app.worker.docker_manager import DockerManager, OdooContainerConfig
from app.worker.git_utils import get_build_dir
from app.worker.tasks.odoo_utils import clear_odoo_assets

logger = logging.getLogger(__name__)
settings = get_settings()

def _ensure_odoo_started(branch, project, docker_mgr, log_fn):
    """Start or restart the Odoo container for a branch."""
    repo_path = str(get_build_dir(project.slug, branch.name))
    
    # Try to extract existing port from URL
    preferred_port = None
    if branch.container_url and "localhost:" in branch.container_url:
        import re
        match = re.search(r":(\d+)", branch.container_url)
        if match:
            preferred_port = int(match.group(1))

    config = OdooContainerConfig(
        project_slug=project.slug,
        branch_name=branch.name,
        odoo_version=branch.odoo_version or project.odoo_version or "17",
        db_name=branch.db_name,
        environment=branch.environment.value,
        repo_path=repo_path,
        addons_path=f"/mnt/extra-addons",
        extra_env=branch.env_vars,
        preferred_port=preferred_port,
    )
    
    container_name = docker_mgr.get_container_name(project.slug, branch.name)
    container = docker_mgr.get_container(container_name)
    
    if container:
        log_fn(f"🔄 Container {container_name} exists, restarting...")
        container.restart()
        # Refresh container info
        container.reload()
        new_url = branch.container_url # Assume it stays the same
    else:
        log_fn(f"🚀 Container {container_name} not found, creating new one...")
        container, port, new_url = docker_mgr.start_odoo_container(config)
        
    # Update branch state
    branch.container_id = container.id
    branch.container_url = new_url
    branch.container_status = "running"

@celery_app.task(name="app.worker.tasks.restore.restore_backup", queue="default")
def restore_backup(backup_id: str):
    minio = get_minio_client()
    docker_mgr = DockerManager()

    with SyncSession() as session:
        backup = session.get(Backup, uuid.UUID(backup_id))
        if not backup:
            logger.error(f"Backup {backup_id} not found")
            return
            
        branch = session.get(Branch, backup.branch_id)
        if not branch:
            logger.error(f"Branch not found for backup {backup_id}")
            return

        project = session.get(Project, branch.project_id)
        
        # ── Step 0: Create a Pseudo-Build for tracking ──
        restore_build = Build(
            branch_id=branch.id,
            commit_sha=f"RESTORE-{backup.created_at.strftime('%Y%m%d-%H%M')}",
            commit_message=f"Restore from {backup.backup_type} backup ({backup.created_at.strftime('%Y-%m-%d %H:%M')})",
            status=BuildStatus.BUILDING,
            started_at=utcnow(),
        )
        session.add(restore_build)
        session.commit()
        
        build_id_str = str(restore_build.id)
        
        def log(line: str):
            _publish_log(build_id_str, line)
            logger.info(f"[Restore {build_id_str[:8]}] {line}")

        # ── Update Branch Status ──
        branch.current_task = "restoring"
        branch.current_task_status = "running"
        session.commit()

        log(f"🔄 Starting restore of backup {backup.id}")
        log(f"   Target branch: {branch.name}")
        log(f"   Backup type: {backup.backup_type}")
        
        pg_container_name = docker_mgr.get_db_container_name(project.slug, branch.name)
        odoo_container_name = docker_mgr.get_container_name(project.slug, branch.name)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                archive_path = os.path.join(tmpdir, "backup.tar.gz")
                extract_dir = os.path.join(tmpdir, "extract")
                os.makedirs(extract_dir)

                # 1. Download from MinIO
                log("📥 Downloading backup archive from MinIO...")
                minio.fget_object(
                    settings.minio_bucket_backups,
                    backup.storage_path,
                    archive_path
                )

                # 2. Extract archive
                log("📦 Extracting backup archive...")
                with tarfile.open(archive_path, "r:gz") as tar:
                    tar.extractall(path=extract_dir)

                # Find dump.sql and filestore.tar.gz (might be nested if created manually)
                dump_path = None
                filestore_archive = None
                for root, dirs, files in os.walk(extract_dir):
                    if "dump.sql" in files:
                        dump_path = os.path.join(root, "dump.sql")
                    if "filestore.tar.gz" in files:
                        filestore_archive = os.path.join(root, "filestore.tar.gz")

                if not dump_path:
                    # Fallback: check for any .sql file if dump.sql not found
                    for root, dirs, files in os.walk(extract_dir):
                        for f in files:
                            if f.endswith(".sql") or f.endswith(".dump"):
                                dump_path = os.path.join(root, f)
                                break
                        if dump_path: break

                if not dump_path:
                    raise Exception("Database dump file (dump.sql) not found in backup archive")

                # Log dump details
                file_size = os.path.getsize(dump_path)
                log(f"📂 Using dump file: {os.path.basename(dump_path)} ({file_size / 1024 / 1024:.2f} MB)")

                # 3. Stop Odoo container (keep PG running) to prevent concurrent access
                log(f"🛑 Stopping Odoo container {odoo_container_name}...")
                docker_mgr.stop_container(odoo_container_name)

                # 4. Clear and Restore DB
                log(f"🐘 Wiping existing data in database: {branch.db_name}")
                
                # Terminate existing connections first (best effort)
                kill_stmt = f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{branch.db_name}' AND pid <> pg_backend_pid();"
                docker_mgr.exec_command(pg_container_name, f"psql -U odoo -d postgres -c \"{kill_stmt}\"")
                
                # Wipe Schema: More reliable than DROP DATABASE which often fails due to active connections
                wipe_commands = [
                    f"DROP SCHEMA IF EXISTS public CASCADE;",
                    f"CREATE SCHEMA public;",
                    f"GRANT ALL ON SCHEMA public TO odoo;",
                    f"GRANT ALL ON SCHEMA public TO public;",
                    f"COMMENT ON SCHEMA public IS 'standard public schema';"
                ]
                
                for cmd in wipe_commands:
                    exit_code, output = docker_mgr.exec_command(pg_container_name, f"psql -U odoo -d {branch.db_name} -c \"{cmd}\"")
                    if exit_code != 0:
                        log(f"⚠️ Warning during database wipe: {output}")
                        # If DROP SCHEMA fails, we might still have a problem, but we try to continue

                # Determine if dump is custom format or plain text
                is_custom_format = False
                try:
                    with open(dump_path, "rb") as f:
                        header = f.read(5)
                        log(f"🔍 Dump header: {header}")
                        if header == b"PGDMP":
                            is_custom_format = True
                except Exception as e:
                    log(f"⚠️ Could not determine dump format, defaulting to pg_restore: {e}")
                    is_custom_format = True

                if is_custom_format:
                    log("🧬 Format: PostgreSQL Custom Archive. Restoring via pg_restore...")
                    cmd_restore = [
                        "docker", "exec", "-i", pg_container_name,
                        "pg_restore", "-U", "odoo", "-d", branch.db_name, "--no-owner"
                    ]
                else:
                    log("📝 Format: Plain Text SQL. Restoring via psql...")
                    cmd_restore = [
                        "docker", "exec", "-i", pg_container_name,
                        "psql", "-U", "odoo", "-d", branch.db_name
                    ]

                with open(dump_path, "rb") as f_in:
                    proc = subprocess.run(cmd_restore, stdin=f_in, capture_output=True)
                    stdout = proc.stdout.decode("utf-8")
                    stderr = proc.stderr.decode("utf-8")
                    
                    if stdout: log(f"Output:\n{stdout}")
                    if stderr: log(f"Notes/Warnings:\n{stderr}")

                    if proc.returncode != 0:
                        # pg_restore often exits with non-zero due to non-critical errors
                        if is_custom_format and ("errors ignored on restore" in stderr.lower() or "already exists" in stderr.lower()):
                            log("✅ pg_restore completed with minor warnings (ignored)")
                        else:
                            log(f"❌ Database restore FAILED (code {proc.returncode})")
                            raise Exception(f"Database restore failed: {stderr}")
                    else:
                        log("✅ Database restore completed successfully")
                    
                    # 4.5 Clear Assets (forcing regeneration)
                    clear_odoo_assets(docker_mgr, pg_container_name, branch.db_name, log)

                # Start Odoo again so we can use exec to restore filestore
                log("🚀 Ensuring Odoo container exists for filestore restoration...")
                _ensure_odoo_started(branch, project, docker_mgr, log)

                # 5. Restore Filestore
                if filestore_archive and os.path.exists(filestore_archive):
                    filestore_internal_path = f"/var/lib/odoo/filestore/{branch.db_name}"
                    log(f"📁 Restoring filestore to {filestore_internal_path}...")
                    
                    # Wipe and extract
                    docker_mgr.exec_command(odoo_container_name, f"rm -rf {filestore_internal_path}")
                    docker_mgr.exec_command(odoo_container_name, f"mkdir -p {filestore_internal_path}")
                    
                    log("📦 Extracting filestore archive...")
                    cmd_untar = [
                        "docker", "exec", "-i", odoo_container_name,
                        "tar", "-xzf", "-", "-C", "/"
                    ]
                    with open(filestore_archive, "rb") as f_in:
                        proc = subprocess.run(cmd_untar, stdin=f_in, capture_output=True)
                        if proc.returncode != 0:
                            log(f"❌ Filestore extraction FAILED: {proc.stderr.decode('utf-8')}")
                            raise Exception(f"Filestore extraction failed: {proc.stderr.decode('utf-8')}")
                    
                    # Fix permissions
                    log("🔑 Fixing filestore permissions...")
                    docker_mgr.exec_command(odoo_container_name, "chown -R odoo:odoo /var/lib/odoo")
                else:
                    log("⚠️ No filestore found in backup, skipping filestore restoration.")

                # 6. Final Restart
                log("🔄 Final restart of Odoo container...")
                _ensure_odoo_started(branch, project, docker_mgr, log)
                
                # ── Final Success Update ──
                branch.current_task = None
                branch.current_task_status = "success"
                restore_build.status = BuildStatus.SUCCESS
                restore_build.finished_at = utcnow()
                session.commit()
                
                log(f"✅ RESTORE SUCCESSFUL for branch {branch.name}")

        except Exception as e:
            log(f"❌ RESTORE FAILED: {e}")
            
            # ── Final Failure Update ──
            branch.current_task_status = "failed"
            restore_build.status = BuildStatus.FAILED
            restore_build.finished_at = utcnow()
            session.commit()

            # Try to restart odoo anyway
            try:
                c = docker_mgr.get_container(odoo_container_name)
                if c and c.status != "running":
                    c.start()
            except:
                pass
            raise
