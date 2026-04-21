"""
Build task — Main CI/CD pipeline executed by Celery worker
"""
import logging
import time
import uuid
from datetime import datetime, timezone

import redis as redis_lib
from celery import shared_task
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models import Build, Branch, Project, BuildStatus, EnvironmentType
from app.worker.celery_app import celery_app
from app.worker.docker_manager import DockerManager, OdooContainerConfig
from app.worker.git_utils import clone_or_pull, detect_odoo_version, get_latest_commit, check_manifest_version_bump

logger = logging.getLogger(__name__)
settings = get_settings()


# Sync SQLAlchemy session for Celery (not async)
sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)
redis_client = redis_lib.from_url(settings.redis_url)


def _log_key(build_id: str) -> str:
    return f"opsway:build_log:{build_id}"


def _publish_log(build_id: str, line: str):
    """Publish a log line to Redis pub/sub channel."""
    key = _log_key(build_id)
    redis_client.rpush(key, line)
    redis_client.expire(key, 86400)  # keep 24h
    redis_client.publish(f"opsway:build:{build_id}:log", line)


def _update_build_status(session: Session, build: Build, status: BuildStatus, **kwargs):
    build.status = status
    for k, v in kwargs.items():
        setattr(build, k, v)
    session.commit()


@celery_app.task(bind=True, name="app.worker.tasks.build.trigger_build", queue="builds")
def trigger_build(self, build_id: str, branch_id: str):
    """
    Main build pipeline:
    1. Update status → BUILDING
    2. Git clone/pull
    3. Detect Odoo version
    4. Start PostgreSQL container
    5. Start Odoo container
    6. Run unit tests (dev only)
    7. Update status → SUCCESS/FAILED
    """
    build_id_str = str(build_id)
    docker = DockerManager()

    def log(line: str):
        _publish_log(build_id_str, line)
        logger.info(f"[Build {build_id_str[:8]}] {line}")

    with SyncSession() as session:
        build = session.get(Build, uuid.UUID(build_id_str))
        if not build:
            logger.error(f"Build {build_id_str} not found")
            return

        branch = session.get(Branch, uuid.UUID(branch_id))
        if not branch:
            logger.error(f"Branch {branch_id} not found")
            return

        project = session.get(Project, branch.project_id)
        if not project:
            logger.error(f"Project not found for branch {branch_id}")
            return

        # ── Step 1: Mark as building ──────────────────────────
        _update_build_status(
            session, build, BuildStatus.BUILDING,
            started_at=datetime.now(timezone.utc),
        )
        log(f"🚀 Build started: {project.name}/{branch.name}")
        log(f"   Commit: {build.commit_sha[:8]} — {build.commit_message}")
        log(f"   Environment: {branch.environment.value}")

        try:
            # ── Step 2: Clone / pull repo ─────────────────────
            log("📥 Cloning/pulling repository...")
            repo_url = f"https://github.com/{project.repo_full_name}.git"
            if project.deploy_key_private:
                # Write deploy key to temp file
                key_path = f"/tmp/deploy_key_{project.id}"
                with open(key_path, "w") as f:
                    f.write(project.deploy_key_private)
                import os
                os.chmod(key_path, 0o600)
            else:
                key_path = None

            repo, local_path = clone_or_pull(
                repo_url=repo_url,
                project_slug=project.slug,
                branch_name=branch.name,
                deploy_key_path=key_path,
            )
            commit_info = get_latest_commit(repo)
            log(f"✅ Checked out: {commit_info['short_sha']}")

            # ── Step 3: Detect Odoo version ───────────────────
            odoo_version = (
                branch.odoo_version
                or project.odoo_version
                or detect_odoo_version(local_path)
                or "17"
            )
            log(f"🔍 Odoo version: {odoo_version}")

            # ── Step 4: Check for manifest version bumps ──────
            if build.commit_sha and build.commit_sha != branch.last_commit_sha:
                bumped = check_manifest_version_bump(
                    repo, branch.last_commit_sha or "HEAD~1", build.commit_sha
                )
                if bumped:
                    log(f"📦 Module version bumps detected: {', '.join(bumped)}")

            # ── Step 5: Ensure networks exist ─────────────────
            log("🌐 Setting up container network...")
            docker.ensure_project_network(project.slug)

            # ── Step 6: Start PostgreSQL ───────────────────────
            db_name = f"opsway_{project.slug}_{branch.name.replace('/', '_')}"
            log(f"🐘 Starting PostgreSQL container (db: {db_name})...")
            pg_container, pg_host = docker.start_postgres_container(
                project.slug, branch.name, db_name
            )
            # Wait for postgres to be healthy
            log("   Waiting for PostgreSQL to be ready...")
            for attempt in range(30):
                time.sleep(2)
                pg_container.reload()
                if pg_container.status == "running":
                    # Check pg is accepting connections
                    exit_code, _ = docker.exec_command(
                        pg_container.name,
                        f"pg_isready -U odoo -d {db_name}"
                    )
                    if exit_code == 0:
                        break
            log("✅ PostgreSQL is ready")

            # ── Step 7: Start Odoo container ──────────────────
            log("🦙 Starting Odoo container...")
            odoo_config = OdooContainerConfig(
                project_slug=project.slug,
                branch_name=branch.name,
                odoo_version=odoo_version,
                db_name=db_name,
                environment=branch.environment.value,
                extra_env=branch.env_vars or {},
                repo_path=str(local_path),
                mailhog_host=settings.mailhog_host,
                mailhog_smtp_port=settings.mailhog_smtp_port,
            )
            odoo_container = docker.start_odoo_container(odoo_config)

            # Wait for Odoo to start
            log("   Waiting for Odoo HTTP server...")
            time.sleep(10)
            odoo_container.reload()

            container_url = docker._public_url(project.slug, branch.name)
            log(f"✅ Odoo is running: {container_url}")

            # ── Step 8: Run unit tests (dev only) ─────────────
            test_passed = None
            test_count = None
            if (
                branch.environment == EnvironmentType.DEVELOPMENT
                and branch.run_tests
            ):
                log("🧪 Running unit tests...")
                exit_code, test_output = docker.exec_command(
                    odoo_container.name,
                    f"odoo --test-enable --test-tags at_install --stop-after-init -d {db_name}"
                )
                # Parse test count from output
                import re
                match = re.search(r"(\d+) tests? ran", test_output)
                if match:
                    test_count = int(match.group(1))
                test_passed = exit_code == 0
                status_icon = "✅" if test_passed else "❌"
                log(f"{status_icon} Tests: {'passed' if test_passed else 'failed'} ({test_count or 0} run)")
                for line in test_output.splitlines()[-20:]:
                    log(f"   {line}")

            # ── Step 9: Update branch + build ─────────────────
            branch.container_id = odoo_container.id
            branch.container_name = odoo_container.name
            branch.container_url = container_url
            branch.container_status = "running"
            branch.db_name = db_name
            branch.last_commit_sha = commit_info["sha"]
            branch.last_commit_message = commit_info["message"]
            branch.last_deployed_at = datetime.now(timezone.utc)

            finished = datetime.now(timezone.utc)
            _update_build_status(
                session, build, BuildStatus.SUCCESS,
                finished_at=finished,
                duration_seconds=int((finished - build.started_at).total_seconds()),
                test_passed=test_passed,
                test_count=test_count,
            )

            log(f"🎉 Build SUCCESS in {build.duration_seconds}s")
            log(f"   Access Odoo at: {container_url}")

        except Exception as exc:
            logger.exception(f"Build {build_id_str} failed: {exc}")
            log(f"💥 Build FAILED: {exc}")
            finished = datetime.now(timezone.utc)
            _update_build_status(
                session, build, BuildStatus.FAILED,
                finished_at=finished,
                duration_seconds=int((finished - (build.started_at or finished)).total_seconds()),
                error_message=str(exc),
            )
            raise
