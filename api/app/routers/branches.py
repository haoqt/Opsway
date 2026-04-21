"""
Branches router — manage branches (environments) within a project
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import Branch, Project, Build, BuildStatus, User, EnvironmentType
from app.schemas import BranchCreate, BranchUpdate, BranchOut, BuildOut, MessageResponse
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404
from app.worker.tasks.build import trigger_build
from app.worker.docker_manager import DockerManager
from app.models import Build

router = APIRouter(prefix="/projects/{project_id}/branches", tags=["branches"])


async def get_branch_or_404(branch_id: str, project_id: uuid.UUID, db: AsyncSession) -> Branch:
    branch = await db.get(Branch, uuid.UUID(branch_id))
    if not branch or branch.project_id != project_id:
        raise HTTPException(status_code=404, detail="Branch not found")
    return branch


@router.get("", response_model=list[BranchOut])
async def list_branches(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    result = await db.execute(
        select(Branch).where(Branch.project_id == project.id)
        .order_by(Branch.environment, Branch.name)
    )
    return result.scalars().all()


@router.post("", response_model=BranchOut, status_code=201)
async def create_branch(
    project_id: str,
    data: BranchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually register a branch (usually auto-created via webhook)."""
    project = await get_project_or_404(project_id, db, current_user)

    # Production: only 1 allowed
    if data.environment == EnvironmentType.PRODUCTION:
        result = await db.execute(
            select(Branch).where(
                Branch.project_id == project.id,
                Branch.environment == EnvironmentType.PRODUCTION,
            )
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="A production branch already exists for this project"
            )

    branch = Branch(
        project_id=project.id,
        name=data.name,
        environment=data.environment,
        odoo_version=data.odoo_version or project.odoo_version,
        auto_deploy=data.auto_deploy,
        run_tests=data.run_tests,
        env_vars=data.env_vars,
    )
    db.add(branch)
    await db.flush()
    return branch


@router.get("/{branch_id}", response_model=BranchOut)
async def get_branch(
    project_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    return await get_branch_or_404(branch_id, project.id, db)


@router.patch("/{branch_id}", response_model=BranchOut)
async def update_branch(
    project_id: str,
    branch_id: str,
    data: BranchUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    branch = await get_branch_or_404(branch_id, project.id, db)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(branch, field, value)
    await db.flush()
    return branch


@router.delete("/{branch_id}", response_model=MessageResponse)
async def delete_branch(
    project_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    branch = await get_branch_or_404(branch_id, project.id, db)

    # Stop Docker containers
    docker = DockerManager()
    if branch.container_name:
        docker.stop_container(branch.container_name, remove=True)
    pg_name = docker._db_container_name(project.slug, branch.name)
    docker.stop_container(pg_name, remove=True)

    branch.is_active = False
    branch.container_id = None
    branch.container_status = "stopped"
    await db.flush()
    return {"message": f"Branch '{branch.name}' deleted"}


@router.post("/{branch_id}/deploy", response_model=BuildOut, status_code=202)
async def manual_deploy(
    project_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Manually trigger a build/deploy for a branch."""
    project = await get_project_or_404(project_id, db, current_user)
    branch = await get_branch_or_404(branch_id, project.id, db)

    build = Build(
        branch_id=branch.id,
        commit_sha=branch.last_commit_sha or "manual",
        commit_message="Manual deploy",
        commit_author=current_user.username,
        triggered_by="manual",
        status=BuildStatus.PENDING,
    )
    db.add(build)
    await db.flush()

    # Dispatch to Celery
    trigger_build.delay(str(build.id), str(branch.id))
    return build


@router.get("/{branch_id}/builds", response_model=list[BuildOut])
async def list_builds(
    project_id: str,
    branch_id: str,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    branch = await get_branch_or_404(branch_id, project.id, db)

    result = await db.execute(
        select(Build)
        .where(Build.branch_id == branch.id)
        .order_by(Build.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
