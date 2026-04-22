"""Restore task — Download from MinIO → Restore DB + Filestore."""
import logging
import subprocess
import os
import tarfile
import tempfile
import uuid
import shutil

from app.worker.celery_app import celery_app
from app.worker.tasks.build import SyncSession
from app.worker.tasks.backup import get_minio_client
from app.core.config import get_settings
from app.models import Branch, Project, Backup
from app.worker.docker_manager import DockerManager

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(name="app.worker.tasks.restore.restore_backup", queue="default")
def restore_backup(backup_id: str):
    """
    1. Download tar.gz from MinIO.
    2. Extract dump.sql and filestore.tar.gz.
    3. Stop Odoo container.
    4. Restore PostgreSQL dump using pg_restore.
    5. Replace filestore directory.
    6. Restart Odoo container.
    """
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
        
        logger.info(f"Restoring backup {backup.id} for branch {branch.name}...")
        
        pg_container_name = docker_mgr.get_db_container_name(project.slug, branch.name)
        odoo_container_name = docker_mgr.get_container_name(project.slug, branch.name)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                archive_path = os.path.join(tmpdir, "backup.tar.gz")
                extract_dir = os.path.join(tmpdir, "extract")
                os.makedirs(extract_dir)

                # 1. Download from MinIO
                logger.info(f"Downloading {backup.storage_path} from MinIO...")
                minio.fget_object(
                    settings.minio_bucket_backups,
                    backup.storage_path,
                    archive_path
                )

                # 2. Extract archive
                logger.info("Extracting backup archive...")
                with tarfile.open(archive_path, "r:gz") as tar:
                    tar.extractall(path=extract_dir)

                dump_path = os.path.join(extract_dir, "dump.sql")
                filestore_archive = os.path.join(extract_dir, "filestore.tar.gz")

                if not os.path.exists(dump_path):
                    raise Exception("dump.sql not found in backup")

                # 3. Stop Odoo container (keep PG running) to prevent concurrent access
                logger.info(f"Stopping Odoo container {odoo_container_name}...")
                docker_mgr.stop_container(odoo_container_name)

                # 4. Clear and Restore DB
                logger.info(f"Clearing database {branch.db_name} on {pg_container_name}...")
                
                # Terminate existing connections first
                kill_stmt = f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{branch.db_name}' AND pid <> pg_backend_pid();"
                docker_mgr.exec_command(pg_container_name, f"psql -U odoo -d postgres -c \"{kill_stmt}\"")
                
                # Drop and Create
                docker_mgr.exec_command(pg_container_name, f"psql -U odoo -d postgres -c \"DROP DATABASE IF EXISTS {branch.db_name};\"")
                docker_mgr.exec_command(pg_container_name, f"psql -U odoo -d postgres -c \"CREATE DATABASE {branch.db_name} OWNER odoo;\"")

                logger.info(f"Restoring database {branch.db_name}...")
                cmd_restore = [
                    "docker", "exec", "-i", pg_container_name,
                    "pg_restore", "-U", "odoo", "-d", branch.db_name, "--no-owner"
                ]
                with open(dump_path, "rb") as f_in:
                    proc = subprocess.run(cmd_restore, stdin=f_in, capture_output=True)
                    if proc.returncode != 0:
                        stderr = proc.stderr.decode("utf-8")
                        if "errors ignored on restore" not in stderr.lower():
                             logger.warning(f"pg_restore warning/error: {stderr}")

                # Start Odoo again so we can use exec to restore filestore
                logger.info(f"Starting Odoo container {odoo_container_name} for filestore restoration...")
                c = docker_mgr.get_container(odoo_container_name)
                if c:
                    c.start()

                # 5. Restore Filestore
                if os.path.exists(filestore_archive):
                    filestore_internal_path = f"/var/lib/odoo/filestore/{branch.db_name}"
                    logger.info(f"Clearing filestore at {filestore_internal_path}...")
                    
                    # Wipe and extract
                    docker_mgr.exec_command(odoo_container_name, f"rm -rf {filestore_internal_path}")
                    docker_mgr.exec_command(odoo_container_name, f"mkdir -p {filestore_internal_path}")
                    
                    logger.info("Extracting new filestore...")
                    cmd_untar = [
                        "docker", "exec", "-i", odoo_container_name,
                        "tar", "-xzf", "-", "-C", "/"
                    ]
                    with open(filestore_archive, "rb") as f_in:
                        proc = subprocess.run(cmd_untar, stdin=f_in, capture_output=True)
                        if proc.returncode != 0:
                            raise Exception(f"Filestore extraction failed: {proc.stderr.decode('utf-8')}")

                # 6. Final Restart to ensure Odoo is clean
                logger.info(f"Final restart of Odoo container {odoo_container_name}...")
                if c:
                    c.restart()
                
                logger.info(f"Restore completed for branch {branch.name}")

        except Exception as e:
            logger.error(f"Restore failed: {e}", exc_info=True)
            # Try to restart odoo anyway
            try:
                c = docker_mgr.get_container(odoo_container_name)
                if c and c.status != "running":
                    c.start()
            except:
                pass
            raise
