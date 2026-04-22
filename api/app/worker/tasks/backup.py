"""Backup task — pg_dump + filestore → MinIO."""
import logging
import subprocess
import os
import tarfile
import tempfile
import uuid
from datetime import datetime, timezone

from celery import shared_task
from minio import Minio
from minio.error import S3Error

from app.worker.celery_app import celery_app
from app.worker.tasks.build import SyncSession
from app.core.config import get_settings
from app.models import Branch, Project, Backup, EnvironmentType
from app.worker.docker_manager import DockerManager

logger = logging.getLogger(__name__)
settings = get_settings()


def get_minio_client() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
    )


@celery_app.task(name="app.worker.tasks.backup.run_daily_backups", queue="default")
def run_daily_backups():
    """Run daily backup for all production branches."""
    with SyncSession() as session:
        prod_branches = (
            session.query(Branch)
            .filter(
                Branch.environment == EnvironmentType.PRODUCTION,
                Branch.is_active == True,
                Branch.db_name != None,
            )
            .all()
        )
        for branch in prod_branches:
            # Create a backup record directly using a synchronous session
            backup = Backup(
                project_id=branch.project_id,
                branch_id=branch.id,
                backup_type="daily",
                storage_path="",
                status="pending",
            )
            session.add(backup)
            session.commit()
            backup_branch.delay(str(backup.id))
        logger.info(f"Scheduled daily backup for {len(prod_branches)} production branches")


@celery_app.task(name="app.worker.tasks.backup.backup_branch", queue="default")
def backup_branch(backup_id: str):
    """
    1. pg_dump from the branch's PostgreSQL container.
    2. tar the Odoo filestore from the Odoo container.
    3. Package both into a single tar.gz.
    4. Upload to MinIO.
    5. Record in DB.
    """
    minio = get_minio_client()

    # Ensure bucket exists
    if not minio.bucket_exists(settings.minio_bucket_backups):
        minio.make_bucket(settings.minio_bucket_backups)

    with SyncSession() as session:
        backup = session.get(Backup, uuid.UUID(backup_id))
        if not backup:
            logger.error(f"Backup {backup_id} not found")
            return
            
        branch = session.get(Branch, backup.branch_id)
        if not branch or not branch.db_name:
            logger.error(f"Branch not found or has no DB for backup {backup_id}")
            backup.status = "failed"
            backup.error_message = "Branch not found or has no DB"
            session.commit()
            return

        project = session.get(Project, branch.project_id)
        
        backup.status = "running"
        session.commit()
        
        docker_mgr = DockerManager()
        pg_container_name = docker_mgr.get_db_container_name(project.slug, branch.name)
        odoo_container_name = docker_mgr.get_container_name(project.slug, branch.name)

        try:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            object_name = f"{project.slug}/{branch.name}/{backup.backup_type}/backup_{timestamp}.tar.gz"

            logger.info(f"Backing up DB and filestore: {branch.db_name} → {object_name}")

            with tempfile.TemporaryDirectory() as tmpdir:
                dump_path = os.path.join(tmpdir, "dump.sql")
                filestore_path = os.path.join(tmpdir, "filestore.tar.gz")
                final_archive_path = os.path.join(tmpdir, "backup.tar.gz")

                # 1. pg_dump (via docker exec on pg container to ensure we match version and network isn't an issue)
                logger.info(f"Running pg_dump on {pg_container_name}...")
                cmd_dump = [
                    "docker", "exec", pg_container_name, 
                    "pg_dump", "-U", "odoo", "-d", branch.db_name, "-F", "c"
                ]
                with open(dump_path, "wb") as f_out:
                    proc = subprocess.run(cmd_dump, stdout=f_out, stderr=subprocess.PIPE)
                    if proc.returncode != 0:
                        raise Exception(f"pg_dump failed: {proc.stderr.decode('utf-8')}")

                # 2. tar filestore (via docker exec on odoo container)
                logger.info(f"Running tar on {odoo_container_name} for filestore...")
                # Modern Odoo uses /var/lib/odoo/filestore/<db_name>
                # Sometimes it's /var/lib/odoo/.local/share/Odoo/filestore/<db_name>
                # We'll archive the whole filestore directory if we don't know the exact path.
                filestore_internal_path = f"/var/lib/odoo/filestore/{branch.db_name}"
                cmd_tar = [
                    "docker", "exec", odoo_container_name,
                    "tar", "-czf", "-", filestore_internal_path
                ]
                with open(filestore_path, "wb") as f_out:
                    proc = subprocess.run(cmd_tar, stdout=f_out, stderr=subprocess.PIPE)
                    if proc.returncode != 0:
                        logger.warning(f"Filestore tar returned non-zero (might be empty or missing): {proc.stderr.decode('utf-8')}")

                # 3. Combine into final archive
                logger.info("Packaging final archive...")
                with tarfile.open(final_archive_path, "w:gz") as tar:
                    tar.add(dump_path, arcname="dump.sql")
                    if os.path.exists(filestore_path) and os.path.getsize(filestore_path) > 0:
                        tar.add(filestore_path, arcname="filestore.tar.gz")

                size = os.path.getsize(final_archive_path)

                # 4. Upload to MinIO
                logger.info("Uploading to MinIO...")
                minio.fput_object(
                    settings.minio_bucket_backups,
                    object_name,
                    final_archive_path,
                    content_type="application/gzip",
                )

            # Update DB
            backup.status = "completed"
            backup.storage_path = object_name
            backup.size_bytes = size
            session.commit()
            logger.info(f"Backup uploaded: {object_name} ({size} bytes)")

        except Exception as e:
            backup.status = "failed"
            backup.error_message = str(e)
            session.commit()
            logger.error(f"Backup failed for {backup_id}: {e}", exc_info=True)
            raise
