"""Cleanup task — remove stale/old containers and builds."""
import logging
from datetime import datetime, timezone, timedelta

from celery import shared_task
from sqlalchemy.orm import Session

from app.worker.celery_app import celery_app
from app.worker.docker_manager import DockerManager
from app.worker.tasks.build import SyncSession
from app.models import Build, BuildStatus

logger = logging.getLogger(__name__)


@celery_app.task(name="app.worker.tasks.cleanup.cleanup_old_builds", queue="default")
def cleanup_old_builds():
    """
    - Remove builds stuck in BUILDING for >1h (likely crashed worker)
    - Remove orphan Docker containers
    """
    docker = DockerManager()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)

    with SyncSession() as session:
        # Find stuck builds
        stuck_builds = (
            session.query(Build)
            .filter(
                Build.status == BuildStatus.BUILDING,
                Build.started_at < cutoff,
            )
            .all()
        )
        for build in stuck_builds:
            logger.warning(f"Marking stuck build {build.id} as FAILED")
            build.status = BuildStatus.FAILED
            build.error_message = "Build timed out (worker crash)"
            build.finished_at = datetime.now(timezone.utc)
        session.commit()
        logger.info(f"Cleaned up {len(stuck_builds)} stuck builds")

    # Remove orphan Opsway containers not in DB
    all_containers = docker.list_opsway_containers()
    logger.info(f"Total Opsway containers: {len(all_containers)}")
