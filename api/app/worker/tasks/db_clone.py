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
from app.models import Branch, Project, EnvironmentType, Build, BuildStatus, utcnow
from app.worker.docker_manager import DockerManager, OdooContainerConfig
from app.worker.tasks.build import SyncSession, _publish_log
from app.worker.git_utils import get_build_dir

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
    
    # Trigger neutralization if needed
    if branch.environment != EnvironmentType.PRODUCTION:
        log_fn("🔧 Triggering auto-neutralization for non-production branch...")
        neutralize_database.delay(str(branch.id))

@celery_app.task(name="app.worker.tasks.db_clone.clone_database", queue="default")
def clone_database(source_branch_id: str, target_branch_id: str):
    docker_mgr = DockerManager()

    with SyncSession() as session:
        source = session.get(Branch, uuid.UUID(source_branch_id))
        target = session.get(Branch, uuid.UUID(target_branch_id))

        if not source or not target:
            logger.error(f"Source or target branch not found: {source_branch_id} → {target_branch_id}")
            return {"success": False, "error": "Branch not found"}

        project = session.get(Project, source.project_id)
        
        # ── Step 0: Create a Pseudo-Build for tracking ──
        clone_build = Build(
            branch_id=target.id,
            commit_sha=f"CLONE-{datetime.now().strftime('%Y%m%d-%H%M')}",
            commit_message=f"Clone from branch: {source.name}",
            status=BuildStatus.BUILDING,
            started_at=utcnow(),
        )
        session.add(clone_build)
        session.commit()
        
        build_id_str = str(clone_build.id)
        
        def log(line: str):
            _publish_log(build_id_str, line)
            logger.info(f"[Clone {build_id_str[:8]}] {line}")

        log(f"🔄 Starting database clone: {source.name} → {target.name}")
        
        src_pg = docker_mgr.get_db_container_name(project.slug, source.name)
        tgt_pg = docker_mgr.get_db_container_name(project.slug, target.name)
        src_odoo = docker_mgr.get_container_name(project.slug, source.name)
        tgt_odoo = docker_mgr.get_container_name(project.slug, target.name)

        # Target DB name (reuse existing or generate)
        target_db = target.db_name or f"opsway_{project.slug}_{target.name.replace('/', '_')}"

        # ── Update Branch Status ──
        target.current_task = "cloning"
        target.current_task_status = "running"
        session.commit()

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                dump_path = os.path.join(tmpdir, "clone_dump.sql")
                filestore_path = os.path.join(tmpdir, "filestore.tar.gz")

                # ── Step 1: pg_dump from source ──────────────────
                log(f"📦 Dumping source database '{source.db_name}' from {src_pg}...")
                cmd_dump = [
                    "docker", "exec", src_pg,
                    "pg_dump", "-U", "odoo", "-d", source.db_name, "-F", "c"
                ]
                with open(dump_path, "wb") as f_out:
                    proc = subprocess.run(cmd_dump, stdout=f_out, stderr=subprocess.PIPE)
                    if proc.returncode != 0:
                        raise Exception(f"pg_dump failed: {proc.stderr.decode('utf-8')}")

                dump_size = os.path.getsize(dump_path)
                log(f"   ✅ Dump complete: {dump_size / 1024 / 1024:.1f} MB")

                # ── Step 2: Stop target Odoo (keep PG running) ───
                log(f"🛑 Stopping target Odoo container {tgt_odoo}...")
                docker_mgr.stop_container(tgt_odoo)

                # ── Step 3: Ensure target PG is running ──────────
                tgt_pg_container = docker_mgr.get_container(tgt_pg)
                if not tgt_pg_container or tgt_pg_container.status != "running":
                    log(f"🐘 Starting target PG container...")
                    docker_mgr.start_postgres_container(project.slug, target.name, target_db)
                    import time
                    time.sleep(5)  # Wait for PG to be ready

                # ── Step 4: Wipe target data ────────────────────
                log(f"🐘 Wiping existing data in target database: {target_db}")
                
                # Terminate existing connections first
                kill_stmt = f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{target_db}' AND pid <> pg_backend_pid();"
                docker_mgr.exec_command(tgt_pg, f'psql -U odoo -d postgres -c "{kill_stmt}"')
                
                # Wipe Schema: More reliable than DROP DATABASE
                wipe_commands = [
                    f"DROP SCHEMA IF EXISTS public CASCADE;",
                    f"CREATE SCHEMA public;",
                    f"GRANT ALL ON SCHEMA public TO odoo;",
                    f"GRANT ALL ON SCHEMA public TO public;",
                    f"COMMENT ON SCHEMA public IS 'standard public schema';"
                ]
                for cmd in wipe_commands:
                    exit_code, output = docker_mgr.exec_command(tgt_pg, f"psql -U odoo -d {target_db} -c \"{cmd}\"")
                    if exit_code != 0:
                        log(f"⚠️ Warning during database wipe: {output}")

                # ── Step 5: pg_restore into target ───────────────
                log(f"📥 Restoring into target database '{target_db}'...")
                cmd_restore = [
                    "docker", "exec", "-i", tgt_pg,
                    "pg_restore", "-U", "odoo", "-d", target_db, "--no-owner"
                ]
                with open(dump_path, "rb") as f_in:
                    proc = subprocess.run(cmd_restore, stdin=f_in, capture_output=True)
                    stderr = proc.stderr.decode("utf-8")
                    if stderr: log(f"Notes/Warnings:\n{stderr}")
                    
                    if proc.returncode != 0:
                        if "errors ignored on restore" in stderr.lower() or "already exists" in stderr.lower():
                            log("✅ pg_restore completed with minor warnings (ignored)")
                        else:
                            log(f"❌ Database restore FAILED (code {proc.returncode})")
                            raise Exception(f"Database restore failed: {stderr}")
                    else:
                        log("✅ Database restore completed successfully")

                # ── Step 6: Clone filestore ──────────────────────
                src_odoo_container = docker_mgr.get_container(src_odoo)
                if src_odoo_container and src_odoo_container.status == "running":
                    filestore_src_path = f"/var/lib/odoo/filestore/{source.db_name}"
                    filestore_tgt_path = f"/var/lib/odoo/filestore/{target_db}"
                    
                    # Check if source filestore exists
                    exit_code, _ = docker_mgr.exec_command(src_odoo, f"test -d {filestore_src_path}")
                    if exit_code == 0:
                        log(f"📁 Cloning filestore: {filestore_src_path} → {filestore_tgt_path}...")
                        
                        # Tar from source
                        cmd_tar = [
                            "docker", "exec", src_odoo,
                            "tar", "-czf", "-", filestore_src_path
                        ]
                        with open(filestore_path, "wb") as f_out:
                            proc = subprocess.run(cmd_tar, stdout=f_out, stderr=subprocess.PIPE)
                            if proc.returncode != 0:
                                log(f"⚠️ Filestore tar warning: {proc.stderr.decode('utf-8')}")
                    else:
                        log(f"ℹ Source filestore {filestore_src_path} not found (fresh DB?), skipping filestore clone.")

                    # Start target Odoo temporarily to extract filestore
                    tgt_container = docker_mgr.get_container(tgt_odoo)
                    if tgt_container:
                        tgt_container.start()
                        import time
                        time.sleep(3)

                        # Clear old filestore and extract new
                        docker_mgr.exec_command(tgt_odoo, f"rm -rf {filestore_tgt_path}")
                        docker_mgr.exec_command(tgt_odoo, f"mkdir -p {filestore_tgt_path}")

                        if os.path.exists(filestore_path) and os.path.getsize(filestore_path) > 0:
                            log("📦 Extracting filestore in target container...")
                            cmd_untar = [
                                "docker", "exec", "-i", tgt_odoo,
                                "tar", "-xzf", "-", "-C", "/"
                            ]
                            with open(filestore_path, "rb") as f_in:
                                proc = subprocess.run(cmd_untar, stdin=f_in, capture_output=True)
                                if proc.returncode != 0:
                                    log(f"⚠️ Filestore extract warning: {proc.stderr.decode('utf-8')}")

                            # Rename filestore directory if source db name differs
                            if source.db_name != target_db:
                                docker_mgr.exec_command(
                                    tgt_odoo,
                                    f"mv {filestore_src_path} {filestore_tgt_path} 2>/dev/null || true"
                                )
                            
                            # Fix permissions
                            log("🔑 Fixing filestore permissions...")
                            docker_mgr.exec_command(tgt_odoo, "chown -R odoo:odoo /var/lib/odoo")

                            log("   ✅ Filestore cloned")
                        else:
                            log("   ℹ No filestore to clone (empty or not found)")
                else:
                    log("   ℹ Source Odoo not running, skipping filestore clone")

                # ── Step 7: Update target branch DB metadata ─────
                target.db_name = target_db
                target.cloned_from_branch_id = source.id
                target.current_task = None
                target.current_task_status = "success"
                clone_build.status = BuildStatus.SUCCESS
                clone_build.finished_at = utcnow()
                session.commit()

                # ── Step 8: Ensure target Odoo is running ────────
                log("🔄 Ensuring target Odoo container is running...")
                _ensure_odoo_started(target, project, docker_mgr, log)

                log(f"🎉 CLONE SUCCESSFUL: {source.name} → {target.name}")

                return {"success": True}

        except Exception as e:
            log(f"❌ CLONE FAILED: {e}")
            
            with SyncSession() as err_session:
                err_target = err_session.get(Branch, uuid.UUID(target_branch_id))
                err_build = err_session.get(Build, uuid.UUID(build_id_str))
                if err_target:
                    err_target.current_task_status = "failed"
                if err_build:
                    err_build.status = BuildStatus.FAILED
                    err_build.finished_at = utcnow()
                err_session.commit()
            
            # Try to restart target Odoo
            try:
                tgt_container = docker_mgr.get_container(tgt_odoo)
                if tgt_container and tgt_container.status != "running":
                    tgt_container.start()
            except Exception:
                pass

            raise
