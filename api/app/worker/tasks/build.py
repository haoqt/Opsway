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


def _is_db_initialized(docker: DockerManager, pg_container_name: str, db_name: str) -> bool:
    """Check if Odoo database has been initialized with the 'base' module."""
    check_query = f"SELECT 1 FROM information_schema.tables WHERE table_name = 'ir_module_module';"
    exit_code, output = docker.exec_command(
        pg_container_name,
        f"psql -U odoo -d {db_name} -c \"{check_query}\""
    )
    return exit_code == 0 and "1 row" in output


def _prune_old_builds(session, project, branch):
    """Prune old builds for the branch if it's in development environment."""
    if branch.environment != EnvironmentType.DEVELOPMENT:
        return

    # Count builds for this branch
    count = session.query(Build).filter(Build.branch_id == branch.id).count()
    limit = project.build_limit_dev

    if count > limit:
        # Fetch the oldest builds to delete
        to_delete = (
            session.query(Build)
            .filter(Build.branch_id == branch.id)
            .order_by(Build.created_at.asc())
            .limit(count - limit)
            .all()
        )
        
        for build in to_delete:
            # Note: redis log cleanup is handled by shared logic or expiration if configured
            # Here we just delete the DB record
            session.delete(build)
        
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
            if project.deploy_key_private:
                repo_url = f"git@github.com:{project.repo_full_name}.git"
            else:
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

            # ── Step 7.1: Check and Initialize DB if needed ──────
            if not _is_db_initialized(docker, pg_container.name, db_name):
                log("🆕 Database is empty. Initializing Odoo schema (base module)...")
                log("   (This may take 1-2 minutes)")
                init_config = OdooContainerConfig(
                    **{k: v for k, v in odoo_config.__dict__.items() if k != "init_db"},
                    init_db=True
                )
                try:
                    docker.start_odoo_container(init_config)
                    log("✅ Database initialization complete")
                except Exception as e:
                    log(f"💥 Database initialization FAILED: {e}")
                    raise e
            else:
                log("✅ Database already initialized")

            # ── Step 7.2: Auto-Rollback Preparation (Production) ──
            old_container_id = None
            old_container_name = None
            if branch.environment == EnvironmentType.PRODUCTION and branch.container_id:
                try:
                    c = docker.get_container(branch.container_id)
                    if c:
                        old_container_name = c.name
                        old_container_id = c.id
                        temp_name = f"{old_container_name}-old-{int(time.time())}"
                        log(f"   📦 Renaming old container to {temp_name} for fallback")
                        c.rename(temp_name)
                        # We stop it so the new container can use resources if needed, though port 8069 is internal
                        c.stop(timeout=10)
                except Exception as e:
                    logger.warning(f"Could not prepare old container for rollback: {e}")

            try:
                odoo_container, mapped_port = docker.start_odoo_container(odoo_config)
                
                # Update branch state in DB
                branch.container_id = odoo_container.id
                if mapped_port:
                    branch.container_url = f"http://localhost:{mapped_port}"
                else:
                    branch.container_url = docker._public_url(project.slug, branch.name)
                
                branch.container_status = "running"
                log(f"✅ Odoo started! Accessible at: {branch.container_url}")
            except Exception as e:
                log(f"❌ Failed to start Odoo: {e}")
                raise e

            # Wait for Odoo to start
            log("   Waiting for Odoo HTTP server...")
            time.sleep(5)
            odoo_container.reload()
            
            if odoo_container.status != "running":
                logs = odoo_container.logs().decode("utf-8")
                raise Exception(f"Container exited unexpectedly. Logs: {logs[-500:]}")

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
                log(f"{'✅' if test_passed else '❌'} Tests: {'passed' if test_passed else 'failed'} ({test_count or 0} run)")

            # ── Step 9: Update branch + build ─────────────────
            branch.container_name = odoo_container.name
            branch.db_name = db_name
            branch.last_commit_sha = commit_info["sha"]
            branch.last_commit_message = commit_info["message"]
            branch.last_deployed_at = datetime.now(timezone.utc)
            session.commit()

            finished = datetime.now(timezone.utc)
            _update_build_status(
                session, build, BuildStatus.SUCCESS,
                finished_at=finished,
                duration_seconds=int((finished - build.started_at).total_seconds()),
                test_passed=test_passed,
                test_count=test_count,
            )
            
            # Prune old builds after success
            _prune_old_builds(session, project, branch)

            log(f"🎉 Build SUCCESS in {build.duration_seconds}s")
            log(f"   Access Odoo at: {branch.container_url}")

            # Clean up old container if rollback preparation occurred
            if 'old_container_id' in locals() and old_container_id:
                try:
                    log(f"   🧹 Cleaning up old container {old_container_name}")
                    docker.stop_container(old_container_id, remove=True)
                except Exception as e:
                    logger.warning(f"Failed to cleanup old container: {e}")

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
            
            # Execute Rollback if applicable
            if branch.environment == EnvironmentType.PRODUCTION and 'old_container_id' in locals() and old_container_id:
                log("🔄 Initiating Auto-Rollback to previous container...")
                try:
                    # Remove the failed new container
                    new_container_name = docker.get_container_name(project.slug, branch.name)
                    docker.stop_container(new_container_name, remove=True)
                    
                    # Restore old container
                    c = docker.get_container(old_container_id)
                    if c:
                        c.rename(old_container_name)
                        c.start()
                        log(f"✅ Rollback successful. Container {old_container_name} restored.")
                        branch.container_status = "running"
                        branch.container_id = c.id
                        session.commit()
                except Exception as rollback_exc:
                    log(f"❌ Rollback failed: {rollback_exc}")
                    branch.container_status = "stopped"
                    session.commit()
                    
            raise
