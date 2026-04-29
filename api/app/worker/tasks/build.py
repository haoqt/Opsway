"""
Build task — CI/CD pipeline driven by .opsway.yml stage definitions.

Pipeline flow:
  1. Mark build BUILDING
  2. Git clone / pull + commit checkout
  3. Sync CI files from repo root → DB
  4. Read .opsway.yml → derive stage order
  5. Execute each stage in order:
       code_quality  → _execute_docker_job()       (image: <img>)
       deploy        → _execute_opsway_deploy()    (trigger: opsway)
       tests         → _execute_exec_job()         (exec_in: odoo)
  6. Mark build SUCCESS / FAILED + notify
"""
import logging
import re
import time
import uuid
from datetime import datetime, timezone

import redis as redis_lib
from celery import shared_task
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models import Build, Branch, Project, BuildStatus, EnvironmentType, ProjectCIConfig
from app.worker.celery_app import celery_app
from app.worker.docker_manager import DockerManager, OdooContainerConfig
from app.worker.git_utils import clone_or_pull, detect_odoo_version, get_latest_commit, check_manifest_version_bump
from app.worker.tasks.odoo_utils import clear_odoo_assets
from app.worker.notifier import send_notification

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)
redis_client = redis_lib.from_url(settings.redis_url)


# ── Logging helpers ────────────────────────────────────────────

def _log_key(build_id: str) -> str:
    return f"opsway:build_log:{build_id}"


def _publish_log(build_id: str, line: str):
    key = _log_key(build_id)
    redis_client.rpush(key, line)
    redis_client.expire(key, 86400)
    redis_client.publish(f"opsway:build:{build_id}:log", line)


def _update_build_status(session: Session, build: Build, status: BuildStatus, **kwargs):
    build.status = status
    for k, v in kwargs.items():
        setattr(build, k, v)
    session.commit()


# ── .opsway.yml helpers ────────────────────────────────────────

def _load_opsway_config(session, project_id, log) -> dict:
    """Load and parse .opsway.yml from the project's CI config DB record."""
    try:
        import yaml
        ci = session.query(ProjectCIConfig).filter_by(project_id=project_id).first()
        stored = dict(ci.config or {}) if ci else {}
        raw = stored.get(".opsway.yml", "")
        if not raw:
            return {}
        data = yaml.safe_load(raw) or {}
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log(f"⚠️  Could not parse .opsway.yml: {e}")
        return {}


def _find_stage_jobs(cfg: dict, stage: str, environment: str | None = None) -> list[dict]:
    """Return jobs for a stage, filtered by environment and only lists."""
    reserved = {"version", "stages"}
    jobs = []
    for key, val in cfg.items():
        if key in reserved or not isinstance(val, dict):
            continue
        if val.get("stage") != stage:
            continue
        # Filter by 'only' list (environment names)
        only = val.get("only") or []
        if only and environment and environment not in only:
            continue
        # Filter by explicit 'environment' field (deploy jobs)
        job_env = val.get("environment")
        if job_env and environment and job_env != environment:
            continue
        jobs.append({"_name": key, **val})
    return jobs


# ── Job executors ──────────────────────────────────────────────

def _worker_container_id() -> str | None:
    """Return the current worker container's ID (for volumes_from sharing)."""
    import socket
    import docker as docker_sdk
    hostname = socket.gethostname()
    try:
        client = docker_sdk.from_env()
        # hostname inside a container is the short container ID
        container = client.containers.get(hostname)
        return container.id
    except Exception:
        return None


def _execute_docker_job(job: dict, local_path: str, log):
    """Run job script inside a fresh Docker container (image: <img>).

    Uses --volumes-from the worker container so the repo checkout path
    (/builds/...) is accessible without needing a host-level bind mount.
    This avoids Docker Desktop file-sharing restrictions on Mac.
    """
    import docker as docker_sdk

    image = job["image"]
    script_lines = job.get("script") or []
    allow_failure = bool(job.get("allow_failure", False))
    # Redirect stdout→stderr so ContainerError.stderr captures all output
    # (pre-commit writes failures to stdout; docker-py ContainerError only has .stderr)
    full_script = "exec 1>&2; " + " && ".join(script_lines)

    log(f"🐳 [{job['_name']}] image={image}")
    client = docker_sdk.from_env()

    worker_id = _worker_container_id()
    run_kwargs: dict = dict(
        command=["bash", "-c", full_script],
        working_dir=str(local_path),
        remove=True,
        stdout=True,
        stderr=True,
        network_mode="bridge",
    )
    if worker_id:
        # Share the worker's filesystem so /builds/... is visible
        run_kwargs["volumes_from"] = [worker_id]
    else:
        # Fallback: direct bind mount (works when worker runs on host)
        run_kwargs["volumes"] = {str(local_path): {"bind": str(local_path), "mode": "ro"}}

    try:
        output = client.containers.run(image, **run_kwargs)
        decoded = output.decode("utf-8", errors="replace") if isinstance(output, bytes) else str(output)
        log(f"✅ [{job['_name']}] passed\n{decoded[-800:] if decoded else ''}")
    except docker_sdk.errors.ContainerError as e:
        # docker-py ContainerError only exposes .stderr (stdout merged via 2>&1 above)
        out_bytes = e.stderr or b""
        out = out_bytes.decode("utf-8", errors="replace") if out_bytes else str(e)
        if allow_failure:
            log(f"⚠️  [{job['_name']}] failed (allow_failure=true):\n{out[-2000:]}")
        else:
            raise Exception(f"[{job['_name']}] failed:\n{out[-2000:]}")
    except Exception as e:
        if allow_failure:
            log(f"⚠️  [{job['_name']}] skipped: {e}")
        else:
            raise


def _inject_odoo_db_args(cmd: str, extra_env: dict) -> str:
    """Auto-append missing --db_host / --db_user / --db_password to odoo CLI commands.

    When running `odoo` via docker exec (not through the image entrypoint),
    the container's odoo.conf may have db_host=False. Injecting these flags
    explicitly ensures the CLI connects to the correct PostgreSQL container.
    """
    if not cmd.lstrip().startswith("odoo "):
        return cmd
    injections = [
        ("--db_host", extra_env.get("DB_HOST")),
        ("--db_user",  extra_env.get("DB_USER", "odoo")),
        ("--db_password", extra_env.get("DB_PASSWORD", "odoo")),
    ]
    for flag, value in injections:
        if value and flag not in cmd:
            cmd = f"{cmd} {flag} {value}"
    return cmd


def _execute_exec_job(job: dict, container_name: str, docker: DockerManager,
                      extra_env: dict, log) -> tuple[bool, str]:
    """Run job script via docker exec inside a running container (exec_in: odoo).
    Returns (passed, combined_output).
    """
    script_lines = job.get("script") or []
    allow_failure = bool(job.get("allow_failure", False))
    combined_out = ""
    passed = True

    for raw_line in script_lines:
        # Substitute ${VAR} placeholders
        cmd = raw_line
        for k, v in extra_env.items():
            cmd = cmd.replace(f"${{{k}}}", v).replace(f"${k}", v)
        # Auto-inject missing DB connection flags for odoo CLI commands
        cmd = _inject_odoo_db_args(cmd, extra_env)
        log(f"🔧 [{job['_name']}] $ {cmd}")
        exit_code, output = docker.exec_command(container_name, cmd)
        combined_out += output or ""
        log((output or "")[-800:])
        if exit_code != 0:
            passed = False
            if allow_failure:
                log(f"⚠️  [{job['_name']}] exit {exit_code} (allow_failure=true)")
                break
            raise Exception(f"[{job['_name']}] command failed (exit {exit_code}): {cmd}")

    return passed, combined_out


def _execute_opsway_deploy(
    job: dict,
    session, branch, project,
    docker: DockerManager,
    local_path: str,
    log,
    repo,
    build_commit_sha: str | None,
) -> dict:
    """Execute a deploy job (trigger: opsway).

    Manages the full container lifecycle via Docker SDK:
      - Detect Odoo version
      - Check module version bumps
      - Start PostgreSQL + wait for healthy
      - DB init (first run) or module upgrades (version bumps)
      - Start persistent Odoo HTTP server
      - Auto-rollback on failure

    Returns a context dict:
      odoo_container, db_name, pg_container, odoo_version
    """
    env_value = job.get("environment", branch.environment.value)
    log(f"🚀 [{job['_name']}] Deploying to {env_value}...")

    # ── Detect Odoo version ────────────────────────────────────
    odoo_version = (
        branch.odoo_version
        or project.odoo_version
        or detect_odoo_version(local_path)
        or "17"
    )
    log(f"   Odoo version: {odoo_version}")

    # ── Check manifest version bumps ──────────────────────────
    bumped_modules: list[str] = []
    if build_commit_sha and build_commit_sha != branch.last_commit_sha:
        bumped_modules = check_manifest_version_bump(
            repo, branch.last_commit_sha or "HEAD~1", build_commit_sha
        )
        if bumped_modules:
            log(f"📦 Module version bumps: {', '.join(bumped_modules)}")

    # ── Ensure project network ─────────────────────────────────
    log("🌐 Setting up container network...")
    docker.ensure_project_network(project.slug)

    # ── Start PostgreSQL ───────────────────────────────────────
    db_name = f"opsway_{project.slug}_{branch.name.replace('/', '_')}"
    log(f"🐘 Starting PostgreSQL (db: {db_name})...")
    pg_container, pg_host = docker.start_postgres_container(project.slug, branch.name, db_name)

    log("   Waiting for PostgreSQL to be ready...")
    for _ in range(30):
        time.sleep(2)
        pg_container.reload()
        if pg_container.status == "running":
            exit_code, _ = docker.exec_command(pg_container.name, f"pg_isready -U odoo -d {db_name}")
            if exit_code == 0:
                break
    log("✅ PostgreSQL ready")

    # ── Build Odoo container config ────────────────────────────
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
        custom_domain=project.custom_domain if project.custom_domain_verified else None,
    )

    # ── Preserve preferred port ────────────────────────────────
    if branch.container_url and "localhost:" in branch.container_url:
        m = re.search(r":(\d+)", branch.container_url)
        if m:
            odoo_config.preferred_port = int(m.group(1))

    # ── Auto-rollback preparation ──────────────────────────────
    old_container_id = None
    old_container_name = None
    if branch.container_id:
        try:
            c = docker.get_container(branch.container_id)
            if c:
                old_container_name = c.name
                old_container_id = c.id
                temp_name = f"{old_container_name}-old-{int(time.time())}"
                log(f"   📦 Old container → {temp_name} (held for rollback)")
                c.rename(temp_name)
                c.stop(timeout=10)
        except Exception as e:
            logger.warning(f"Could not prepare rollback container: {e}")

    try:
        # ── DB init or module upgrades ─────────────────────────
        is_initialized = _is_db_initialized(docker, pg_container.name, db_name)

        if not is_initialized:
            log("🆕 Fresh database — initialising Odoo schema...")
            log("   (This may take 1-2 minutes)")
            init_cfg = OdooContainerConfig(
                **{k: v for k, v in odoo_config.__dict__.items()
                   if k not in ("init_db", "upgrade_modules")},
                init_db=True,
            )
            _, _, init_logs = docker.start_odoo_container(init_cfg)
            log(f"📝 Init logs:\n{init_logs}")
            log("✅ Schema initialised")
            clear_odoo_assets(docker, pg_container.name, db_name, log)
        else:
            log("✅ Database already initialised")
            if bumped_modules:
                mods = ",".join(bumped_modules)
                log(f"⬆️  Upgrading modules: {mods}")
                upgrade_cfg = OdooContainerConfig(
                    **{k: v for k, v in odoo_config.__dict__.items()
                       if k not in ("init_db", "upgrade_modules")},
                    upgrade_modules=bumped_modules,
                )
                _, _, upg_logs = docker.start_odoo_container(upgrade_cfg)
                log(f"📝 Upgrade logs:\n{upg_logs}")
                log(f"✅ Modules upgraded: {mods}")
                clear_odoo_assets(docker, pg_container.name, db_name, log)

        # ── Start persistent Odoo HTTP server ──────────────────
        log("🦙 Starting Odoo HTTP server...")
        odoo_container, mapped_port, container_url = docker.start_odoo_container(odoo_config)
        branch.container_id = odoo_container.id
        branch.container_url = container_url
        branch.container_status = "running"
        log(f"✅ Odoo running at {container_url}")

        log("   Waiting for Odoo HTTP server...")
        time.sleep(5)
        odoo_container.reload()
        if odoo_container.status != "running":
            raw_logs = odoo_container.logs().decode("utf-8")
            raise Exception(f"Odoo container exited unexpectedly:\n{raw_logs[-500:]}")

        # ── Clean up old container after success ───────────────
        if old_container_id:
            try:
                log(f"   🧹 Removing old container {old_container_name}")
                docker.stop_container(old_container_id, remove=True)
            except Exception as e:
                logger.warning(f"Failed to remove old container: {e}")

        return {
            "odoo_container": odoo_container,
            "db_name": db_name,
            "pg_container": pg_container,
            "odoo_version": odoo_version,
        }

    except Exception as exc:
        log(f"💥 Deploy failed: {exc}")
        # ── Auto-rollback ──────────────────────────────────────
        if old_container_id:
            log("🔄 Rolling back to previous container...")
            try:
                new_name = docker.get_container_name(project.slug, branch.name)
                docker.stop_container(new_name, remove=True)
                c = docker.get_container(old_container_id)
                if c:
                    c.rename(old_container_name)
                    c.start()
                    log(f"✅ Rollback successful — {old_container_name} restored")
                    branch.container_status = "running"
                    branch.container_id = c.id
                    session.commit()
            except Exception as rb_exc:
                log(f"❌ Rollback failed: {rb_exc}")
                branch.container_status = "stopped"
                session.commit()
        raise


# ── CI file sync ───────────────────────────────────────────────

def _sync_ci_files_from_repo(session, project_id, local_path, log):
    """Scan repo root for CI config files and persist them to DB."""
    from pathlib import Path
    from app.services.ci_config_generator import CI_FILENAMES

    repo_root = Path(local_path)
    ci = session.query(ProjectCIConfig).filter_by(project_id=project_id).first()
    if not ci:
        ci = ProjectCIConfig(project_id=project_id, config={})
        session.add(ci)

    stored = dict(ci.config or {})
    synced = []
    for filename in CI_FILENAMES:
        fp = repo_root / filename
        if fp.is_file():
            try:
                stored[filename] = fp.read_text(encoding="utf-8")
                synced.append(filename)
            except Exception:
                pass

    if synced:
        ci.config = stored
        session.commit()
        log(f"📋 Synced from repo: {', '.join(synced)}")


def _is_db_initialized(docker: DockerManager, pg_container_name: str, db_name: str) -> bool:
    check_query = "SELECT 1 FROM information_schema.tables WHERE table_name = 'ir_module_module';"
    exit_code, output = docker.exec_command(
        pg_container_name,
        f'psql -U odoo -d {db_name} -c "{check_query}"',
    )
    return exit_code == 0 and "1 row" in output


def _prune_old_builds(session, project, branch):
    if branch.environment != EnvironmentType.DEVELOPMENT:
        return
    count = session.query(Build).filter(Build.branch_id == branch.id).count()
    limit = project.build_limit_dev
    if count > limit:
        to_delete = (
            session.query(Build)
            .filter(Build.branch_id == branch.id)
            .order_by(Build.created_at.asc())
            .limit(count - limit)
            .all()
        )
        for b in to_delete:
            session.delete(b)
        session.commit()


# ── Main task ──────────────────────────────────────────────────

@celery_app.task(bind=True, name="app.worker.tasks.build.trigger_build", queue="builds")
def trigger_build(self, build_id: str, branch_id: str):
    """
    CI/CD pipeline entry point.

    Reads .opsway.yml after repo checkout and executes each stage in order:
      code_quality → deploy → tests  (or whatever stages are declared)
    """
    build_id_str = str(build_id)
    docker = DockerManager()

    def log(line: str):
        _publish_log(build_id_str, line)
        logger.info(f"[Build {build_id_str[:8]}] {line}")

    lock_key = f"opsway:branch_lock:{branch_id}"
    lock = redis_client.lock(lock_key, timeout=1200, blocking_timeout=30)

    if not lock.acquire(blocking=True):
        log("⏳ Branch locked by another task. Retrying in 60s...")
        raise self.retry(countdown=60)

    try:
        with SyncSession() as session:
            build = session.get(Build, uuid.UUID(build_id_str))
            branch = session.get(Branch, uuid.UUID(branch_id))
            if not build or not branch:
                logger.error(f"Build or branch not found: {build_id_str}/{branch_id}")
                return

            project = session.get(Project, branch.project_id)
            if not project:
                logger.error(f"Project not found for branch {branch_id}")
                return

            # ── Mark BUILDING ──────────────────────────────────
            _update_build_status(
                session, build, BuildStatus.BUILDING,
                started_at=datetime.now(timezone.utc),
            )
            branch.current_task = "building"
            branch.current_task_status = "running"
            session.commit()

            log(f"🚀 Build started — {project.name}/{branch.name}")
            log(f"   Commit : {build.commit_sha[:8]} — {build.commit_message}")
            log(f"   Env    : {branch.environment.value}")

            send_notification(
                event="build_started",
                project_name=project.name,
                project_slug=project.slug,
                branch_name=branch.name,
                build_info={"commit_sha": build.commit_sha, "commit_message": build.commit_message},
                notification_email=project.notification_email,
                notification_webhook_url=project.notification_webhook_url,
                notification_slack_url=project.notification_slack_url,
                notification_telegram_bot_token=project.notification_telegram_bot_token,
                notification_telegram_chat_id=project.notification_telegram_chat_id,
            )

            try:
                # ── Clone / pull ───────────────────────────────
                log("📥 Cloning/pulling repository...")
                key_path = None
                if project.git_provider.value == "gitlab":
                    gl_base = (project.gitlab_url or "https://gitlab.com").rstrip("/")
                    if project.gitlab_token:
                        from urllib.parse import urlparse
                        parsed = urlparse(gl_base)
                        repo_url = f"{parsed.scheme}://oauth2:{project.gitlab_token}@{parsed.netloc}/{project.repo_full_name}.git"
                    elif project.deploy_key_private:
                        host = gl_base.replace("https://", "").replace("http://", "")
                        repo_url = f"git@{host}:{project.repo_full_name}.git"
                    else:
                        repo_url = f"{gl_base}/{project.repo_full_name}.git"
                else:
                    repo_url = (
                        f"git@github.com:{project.repo_full_name}.git"
                        if project.deploy_key_private
                        else f"https://github.com/{project.repo_full_name}.git"
                    )

                if not project.gitlab_token and project.deploy_key_private:
                    import os
                    key_path = f"/tmp/deploy_key_{project.id}"
                    with open(key_path, "w") as f:
                        f.write(project.deploy_key_private)
                    os.chmod(key_path, 0o600)

                repo, local_path = clone_or_pull(
                    repo_url=repo_url,
                    project_slug=project.slug,
                    branch_name=branch.name,
                    deploy_key_path=key_path,
                )
                if build.commit_sha:
                    repo.git.checkout(build.commit_sha)

                commit_info = get_latest_commit(repo)
                log(f"✅ Checked out {commit_info['short_sha']}")

                # ── Sync CI files from repo → DB ───────────────
                try:
                    _sync_ci_files_from_repo(session, project.id, local_path, log)
                except Exception as e:
                    log(f"⚠️  CI file sync skipped: {e}")

                # ── Read .opsway.yml → pipeline plan ───────────
                opsway_cfg = _load_opsway_config(session, project.id, log)
                env_value = branch.environment.value

                # When no .opsway.yml is present (or it has no jobs), inject a
                # minimal default so deploy always runs via Docker SDK and tests
                # respect the branch.run_tests DB flag.
                if not _find_stage_jobs(opsway_cfg, "deploy", env_value):
                    log("ℹ️  No deploy jobs in .opsway.yml — using Opsway default pipeline")
                    opsway_cfg.setdefault("stages", ["deploy"])
                    if "deploy" not in opsway_cfg["stages"]:
                        opsway_cfg["stages"].insert(0, "deploy")
                    opsway_cfg[f"deploy_{env_value}"] = {
                        "stage": "deploy",
                        "trigger": "opsway",
                        "environment": env_value,
                        "when": "auto",
                    }
                    if branch.run_tests and branch.environment == EnvironmentType.DEVELOPMENT:
                        if "tests" not in opsway_cfg["stages"]:
                            opsway_cfg["stages"].append("tests")
                        opsway_cfg.setdefault("tests", {
                            "stage": "tests",
                            "exec_in": "odoo",
                            "script": ["odoo --test-enable --test-tags at_install --stop-after-init -d ${DB_NAME} --db_host ${DB_HOST}"],
                            "allow_failure": True,
                            "only": ["development"],
                        })

                pipeline_stages = opsway_cfg.get("stages") or ["deploy"]
                log(f"📋 Pipeline: {' → '.join(pipeline_stages)}")

                # ── Shared context populated by deploy stage ───
                deploy_ctx: dict = {}   # keys: odoo_container, db_name, pg_container, odoo_version
                test_passed: bool | None = None
                test_count: int | None = None

                # ── Execute stages in order ────────────────────
                for stage in pipeline_stages:
                    jobs = _find_stage_jobs(opsway_cfg, stage, env_value)

                    if not jobs:
                        log(f"⏭  [{stage}] no matching jobs — skipped")
                        continue

                    log(f"\n▶ Stage: {stage}")

                    for job in jobs:
                        when = job.get("when", "auto")
                        if when == "manual":
                            log(f"   [{job['_name']}] when=manual — skipped (trigger from UI)")
                            continue

                        trigger = job.get("trigger")
                        image = job.get("image")
                        exec_in = job.get("exec_in")

                        if trigger == "opsway":
                            # Full container lifecycle via Docker SDK
                            deploy_ctx = _execute_opsway_deploy(
                                job=job,
                                session=session,
                                branch=branch,
                                project=project,
                                docker=docker,
                                local_path=local_path,
                                log=log,
                                repo=repo,
                                build_commit_sha=build.commit_sha,
                            )
                            # Persist container info to DB immediately
                            branch.container_name = deploy_ctx["odoo_container"].name
                            branch.db_name = deploy_ctx["db_name"]
                            session.commit()
                            log(f"✅ [{job['_name']}] deployed")

                        elif image:
                            # Run script in fresh Docker container
                            _execute_docker_job(job, local_path, log)

                        elif exec_in == "odoo":
                            # Run script inside the deployed Odoo container
                            if not deploy_ctx.get("odoo_container"):
                                log(f"⚠️  [{job['_name']}] No Odoo container — deploy stage must run first")
                                continue
                            pg = deploy_ctx.get("pg_container")
                            exec_env = {
                                "DB_NAME": deploy_ctx["db_name"],
                                "DB_HOST": pg.name if pg else "localhost",
                            }
                            passed, out = _execute_exec_job(
                                job=job,
                                container_name=deploy_ctx["odoo_container"].name,
                                docker=docker,
                                extra_env=exec_env,
                                log=log,
                            )
                            if stage == "tests":
                                test_passed = passed
                                m = re.search(r"(\d+) tests? ran", out)
                                if m:
                                    test_count = int(m.group(1))
                                log(f"{'✅' if test_passed else '❌'} Tests: "
                                    f"{'passed' if test_passed else 'failed'} ({test_count or 0} run)")
                            if passed:
                                log(f"✅ [{job['_name']}] passed")
                            else:
                                log(f"⚠️  [{job['_name']}] failed (allow_failure=true)")
                        else:
                            log(f"⚠️  [{job['_name']}] Unknown job type — skipped "
                                f"(no trigger/image/exec_in defined)")

                # ── Finalise branch state ──────────────────────
                branch.last_commit_sha = commit_info["sha"]
                branch.last_commit_message = commit_info["message"]
                branch.last_deployed_at = datetime.now(timezone.utc)
                branch.current_task = None
                branch.current_task_status = None
                session.commit()

                finished = datetime.now(timezone.utc)
                _update_build_status(
                    session, build, BuildStatus.SUCCESS,
                    finished_at=finished,
                    duration_seconds=int((finished - build.started_at).total_seconds()),
                    test_passed=test_passed,
                    test_count=test_count,
                )

                _prune_old_builds(session, project, branch)

                log(f"\n🎉 Build SUCCESS in {build.duration_seconds}s")
                if deploy_ctx.get("odoo_container"):
                    log(f"   Access Odoo at: {branch.container_url}")

                send_notification(
                    event="build_success",
                    project_name=project.name,
                    project_slug=project.slug,
                    branch_name=branch.name,
                    build_info={
                        "commit_sha": build.commit_sha,
                        "commit_message": build.commit_message,
                        "duration_seconds": build.duration_seconds,
                        "url": branch.container_url,
                    },
                    notification_email=project.notification_email,
                    notification_webhook_url=project.notification_webhook_url,
                    notification_slack_url=project.notification_slack_url,
                    notification_telegram_bot_token=project.notification_telegram_bot_token,
                    notification_telegram_chat_id=project.notification_telegram_chat_id,
                )

            except Exception as exc:
                logger.exception(f"Build {build_id_str} failed: {exc}")
                log(f"\n💥 Build FAILED: {exc}")
                finished = datetime.now(timezone.utc)
                _update_build_status(
                    session, build, BuildStatus.FAILED,
                    finished_at=finished,
                    duration_seconds=int((finished - (build.started_at or finished)).total_seconds()),
                    error_message=str(exc),
                )
                branch.current_task_status = "failed"
                session.commit()

                send_notification(
                    event="build_failed",
                    project_name=project.name,
                    project_slug=project.slug,
                    branch_name=branch.name,
                    build_info={
                        "commit_sha": build.commit_sha,
                        "commit_message": build.commit_message,
                        "duration_seconds": build.duration_seconds,
                        "error_message": str(exc),
                    },
                    notification_email=project.notification_email,
                    notification_webhook_url=project.notification_webhook_url,
                    notification_slack_url=project.notification_slack_url,
                    notification_telegram_bot_token=project.notification_telegram_bot_token,
                    notification_telegram_chat_id=project.notification_telegram_chat_id,
                )
                raise

    finally:
        try:
            lock.release()
        except redis_lib.exceptions.LockError:
            pass
