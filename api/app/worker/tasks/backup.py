"""Backup task — pg_dump + filestore → MinIO."""
import logging
import subprocess
import os
from datetime import datetime, timezone

from celery import shared_task
from minio import Minio
from minio.error import S3Error

from app.worker.celery_app import celery_app
from app.worker.tasks.build import SyncSession
from app.core.config import get_settings
from app.models import Branch, Project, Backup, EnvironmentType

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
            backup_branch.delay(str(branch.id), "daily")
        logger.info(f"Scheduled daily backup for {len(prod_branches)} production branches")


@celery_app.task(name="app.worker.tasks.backup.backup_branch", queue="default")
def backup_branch(branch_id: str, backup_type: str = "manual"):
    """
    1. pg_dump from the branch's PostgreSQL container
    2. Upload to MinIO
    3. Record in DB
    """
    minio = get_minio_client()

    # Ensure bucket exists
    if not minio.bucket_exists(settings.minio_bucket_backups):
        minio.make_bucket(settings.minio_bucket_backups)

    with SyncSession() as session:
        import uuid
        branch = session.get(Branch, uuid.UUID(branch_id))
        if not branch or not branch.db_name:
            logger.error(f"Branch {branch_id} not found or has no DB")
            return

        project = session.get(Project, branch.project_id)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        dump_path = f"/tmp/opsway_backup_{branch.db_name}_{timestamp}.sql"
        object_name = f"{project.slug}/{branch.name}/{backup_type}/{timestamp}.sql"

        # Create backup record
        backup = Backup(
            project_id=project.id,
            branch_id=branch.id,
            backup_type=backup_type,
            storage_path=object_name,
            status="pending",
        )
        session.add(backup)
        session.commit()

        try:
            logger.info(f"Backing up DB: {branch.db_name} → {object_name}")

            # pg_dump (connect to container)
            result = subprocess.run(
                [
                    "pg_dump",
                    "-h", branch.db_name,  # container name acts as hostname in Docker network
                    "-U", "odoo",
                    "-d", branch.db_name,
                    "-f", dump_path,
                ],
                capture_output=True,
                timeout=300,
                env={**os.environ, "PGPASSWORD": "odoo"},
            )
            if result.returncode != 0:
                raise Exception(f"pg_dump failed: {result.stderr.decode()}")

            size = os.path.getsize(dump_path)
            minio.fput_object(
                settings.minio_bucket_backups,
                object_name,
                dump_path,
                content_type="application/sql",
            )

            backup.status = "completed"
            backup.size_bytes = size
            session.commit()
            logger.info(f"Backup uploaded: {object_name} ({size} bytes)")

        except Exception as e:
            backup.status = "failed"
            backup.error_message = str(e)
            session.commit()
            logger.error(f"Backup failed for {branch_id}: {e}")
            raise
        finally:
            if os.path.exists(dump_path):
                os.remove(dump_path)
