"""
Projects router — CRUD for projects, GitHub repo connection
"""
import re
import uuid
import httpx
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.config import get_settings
from app.models import Project, Branch, ProjectMember, UserRole, User
from app.schemas import ProjectCreate, ProjectUpdate, ProjectOut, ProjectDetail, BranchOut, MessageResponse
from app.routers.auth import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])
settings = get_settings()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:50]


async def get_project_or_404(
    project_id: str,
    db: AsyncSession,
    current_user: User,
) -> Project:
    try:
        project_uuid = uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")
    project = await db.get(Project, project_uuid)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Check membership
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == current_user.id,
        )
    )
    if not result.scalar_one_or_none() and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Access denied")
    return project


# ── Endpoints ──────────────────────────────────────────────────

@router.get("", response_model=list[ProjectOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """List all projects the current user is a member of."""
    result = await db.execute(
        select(Project)
        .join(ProjectMember)
        .where(ProjectMember.user_id == current_user.id, Project.is_active == True)
        .offset(skip)
        .limit(limit)
    )
    projects = result.scalars().all()
    return projects


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Connect a GitHub repository as a new project."""
    # Parse owner/repo
    parts = data.repo_full_name.split("/")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="repo_full_name must be in 'owner/repo' format")
    owner, repo_name = parts

    # Check if already connected
    result = await db.execute(
        select(Project).where(
            Project.git_provider == data.git_provider,
            Project.repo_full_name == data.repo_full_name,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Repository already connected")

    # Fetch repo info from GitHub
    repo_url = f"https://github.com/{data.repo_full_name}"
    gh_id = None
    if current_user.github_token:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"https://api.github.com/repos/{data.repo_full_name}",
                headers={"Authorization": f"Bearer {current_user.github_token}"},
            )
            if resp.status_code == 200:
                gh_data = resp.json()
                repo_url = gh_data.get("clone_url", repo_url)
                gh_id = str(gh_data.get("id"))

    # Generate unique slug
    base_slug = slugify(data.name)
    slug = base_slug
    counter = 1
    while True:
        exists = await db.execute(select(Project).where(Project.slug == slug))
        if not exists.scalar_one_or_none():
            break
        slug = f"{base_slug}-{counter}"
        counter += 1

    project = Project(
        name=data.name,
        slug=slug,
        description=data.description,
        git_provider=data.git_provider,
        repo_owner=owner,
        repo_name=repo_name,
        repo_full_name=data.repo_full_name,
        repo_url=repo_url,
        repo_id=gh_id,
        odoo_version=data.odoo_version,
        custom_addons_path=data.custom_addons_path,
    )
    db.add(project)
    await db.flush()

    # Add creator as owner
    member = ProjectMember(
        project_id=project.id,
        user_id=current_user.id,
        role=UserRole.OWNER,
    )
    db.add(member)
    await db.flush()

    # Register GitHub webhook
    if current_user.github_token:
        await _register_github_webhook(project, current_user.github_token)

    return project


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)

    result = await db.execute(
        select(Branch).where(Branch.project_id == project.id, Branch.is_active == True)
    )
    branches = result.scalars().all()

    return ProjectDetail(
        **ProjectOut.model_validate(project).model_dump(),
        webhook_id=project.webhook_id,
        deploy_key_public=project.deploy_key_public,
        branches=[BranchOut.model_validate(b) for b in branches],
    )


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    await db.flush()
    return project


@router.delete("/{project_id}", response_model=MessageResponse)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    # Soft delete
    project.is_active = False
    await db.flush()
    return {"message": f"Project '{project.name}' deactivated"}


# ── Internal helpers ───────────────────────────────────────────

async def _register_github_webhook(project: Project, github_token: str):
    webhook_url = f"https://api.opsway.io/webhooks/github/{project.slug}"
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.github.com/repos/{project.repo_full_name}/hooks",
            headers={
                "Authorization": f"Bearer {github_token}",
                "Accept": "application/vnd.github.v3+json",
            },
            json={
                "name": "web",
                "active": True,
                "events": ["push", "create", "delete"],
                "config": {
                    "url": webhook_url,
                    "content_type": "json",
                    "secret": project.webhook_secret,
                    "insecure_ssl": "0",
                },
            },
        )
        if resp.status_code == 201:
            import re
            project.webhook_id = str(resp.json().get("id"))
