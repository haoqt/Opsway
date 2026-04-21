"""
Repository tasks — Syncing branches and commits
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings
from app.models import Branch, Project, EnvironmentType
from app.worker.celery_app import celery_app
from app.worker.git_utils import list_remote_branches

logger = logging.getLogger(__name__)
settings = get_settings()

sync_engine = create_engine(
    settings.database_url.replace("+asyncpg", "+psycopg2"),
    pool_pre_ping=True,
)
SyncSession = sessionmaker(sync_engine)


@celery_app.task(name="app.worker.tasks.repo.sync_project_branches")
def sync_project_branches(project_id: str):
    """
    Sync branches from Git remote to database.
    """
    project_uuid = uuid.UUID(project_id)
    
    with SyncSession() as session:
        project = session.get(Project, project_uuid)
        if not project:
            logger.error(f"Project {project_id} not found")
            return

        logger.info(f"Syncing branches for project {project.name} ({project.repo_full_name})")
        
        # 1. Fetch remote branches
        if project.deploy_key_private:
            repo_url = f"git@github.com:{project.repo_full_name}.git"
        else:
            repo_url = f"https://github.com/{project.repo_full_name}.git"
            
        key_path = None
        if project.deploy_key_private:
            key_path = f"/tmp/deploy_key_{project.id}"
            with open(key_path, "w") as f:
                f.write(project.deploy_key_private)
            import os
            os.chmod(key_path, 0o600)

        try:
            remote_branches = list_remote_branches(repo_url, key_path)
            logger.info(f"Found {len(remote_branches)} branches for {project.slug}")
        except Exception as e:
            logger.error(f"Failed to list remote branches for {project.slug}: {e}")
            return

        # 2. Get existing branches
        result = session.execute(select(Branch).where(Branch.project_id == project.id))
        existing_branches = {b.name: b for b in result.scalars().all()}

        # 3. UPSERT branches
        newly_synced = []
        for branch_name in remote_branches:
            if branch_name in existing_branches:
                branch = existing_branches[branch_name]
                branch.is_active = True
                logger.debug(f"Branch '{branch_name}' already exists, marked as active")
            else:
                logger.info(f"New branch found: {branch_name}")
                branch = Branch(
                    project_id=project.id,
                    name=branch_name,
                    environment=EnvironmentType.DEVELOPMENT,
                    odoo_version=project.odoo_version,
                    is_active=True,
                )
                session.add(branch)
            newly_synced.append(branch_name)

        # 4. Deactivate deleted branches
        for name, branch in existing_branches.items():
            if name not in newly_synced:
                logger.info(f"Branch '{name}' no longer exists on remote, deactivating")
                branch.is_active = False

        session.commit()
        logger.info(f"✅ Finished syncing branches for {project.slug}")
