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
from app.services.ssh import generate_ssh_key_pair

router = APIRouter(prefix="/projects", tags=["projects"])
settings = get_settings()


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:50]


def get_repo_ssh_url(repo_full_name: str) -> str:
    """Convert owner/repo to git@github.com:owner/repo.git"""
    return f"git@github.com:{repo_full_name}.git"


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
    """List all projects the current user is a member of with stats."""
    # Subquery for branch count
    branch_count_sq = (
        select(func.count(Branch.id))
        .where(Branch.project_id == Project.id, Branch.is_active == True)
        .scalar_subquery()
    )
    
    # Subquery for active builds count
    from app.models import Build, BuildStatus
    active_builds_sq = (
        select(func.count(Build.id))
        .join(Branch)
        .where(
            Branch.project_id == Project.id,
            Build.status.in_([BuildStatus.PENDING, BuildStatus.BUILDING])
        )
        .scalar_subquery()
    )

    result = await db.execute(
        select(Project, branch_count_sq.label("branch_count"), active_builds_sq.label("active_builds"))
        .join(ProjectMember)
        .where(ProjectMember.user_id == current_user.id, Project.is_active == True)
        .offset(skip)
        .limit(limit)
    )
    
    projects = []
    for row in result:
        proj, b_count, a_builds = row
        p_out = ProjectOut.model_validate(proj)
        p_out.branch_count = b_count or 0
        p_out.active_builds = a_builds or 0
        projects.append(p_out)
        
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

    # Generate SSH Deploy Key
    public_key, private_key = generate_ssh_key_pair(f"opsway-{slug}")

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
        deploy_key_public=public_key,
        deploy_key_private=private_key,
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
    """Get project details with accurate stats and branches."""
    # Subquery for branch count
    branch_count_sq = (
        select(func.count(Branch.id))
        .where(Branch.project_id == Project.id, Branch.is_active == True)
        .scalar_subquery()
    )
    
    # Subquery for active builds count
    from app.models import Build, BuildStatus
    active_builds_sq = (
        select(func.count(Build.id))
        .join(Branch)
        .where(
            Branch.project_id == Project.id,
            Build.status.in_([BuildStatus.PENDING, BuildStatus.BUILDING])
        )
        .scalar_subquery()
    )

    result = await db.execute(
        select(Project, branch_count_sq.label("branch_count"), active_builds_sq.label("active_builds"))
        .where(Project.id == uuid.UUID(project_id))
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project, b_count, a_builds = row
    
    # Check membership
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == current_user.id,
        )
    )
    if not result.scalar_one_or_none() and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(Branch).where(Branch.project_id == project.id, Branch.is_active == True)
    )
    branches = result.scalars().all()

    p_detail = ProjectDetail(
        **ProjectOut.model_validate(project).model_dump(),
        webhook_id=project.webhook_id,
        webhook_url=f"{settings.webhook_base_url}/webhooks/github/{project.slug}",
        webhook_secret=project.webhook_secret,
        deploy_key_public=project.deploy_key_public,
        branches=[BranchOut.model_validate(b) for b in branches],
    )
    p_detail.branch_count = b_count or 0
    p_detail.active_builds = a_builds or 0
    return p_detail


@router.post("/{project_id}/sync", response_model=MessageResponse)
async def sync_project_repo(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger a manual repository branch synchronization."""
    from app.worker.tasks.repo import sync_project_branches
    project = await get_project_or_404(project_id, db, current_user)
    
    sync_project_branches.delay(str(project.id))
    return {"message": "Repository synchronization started in background"}


@router.post("/{project_id}/test-connection", response_model=MessageResponse)
async def test_project_connection(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Test connection to the GitHub repository and trigger a webhook ping if possible."""
    project = await get_project_or_404(project_id, db, current_user)

    if current_user.github_token:
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {current_user.github_token}",
                "Accept": "application/vnd.github.v3+json",
            }

            # 1. Check repo access
            repo_resp = await client.get(
                f"https://api.github.com/repos/{project.repo_full_name}",
                headers=headers
            )
            if repo_resp.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot access repository: {repo_resp.json().get('message', 'Unknown error')}"
                )

            # 2. If webhook_id exists, trigger a ping
            if project.webhook_id:
                ping_resp = await client.post(
                    f"https://api.github.com/repos/{project.repo_full_name}/hooks/{project.webhook_id}/pings",
                    headers=headers
                )
                if ping_resp.status_code == 204:
                    return {"message": "Success: Repository accessible and Webhook ping sent!"}
                else:
                    return {"message": "Repository accessible, but Webhook ping failed.", "detail": ping_resp.text}

            return {"message": "Success: Repository is accessible! Webhook must be configured manually if not using OAuth."}

    # Manual check (no token)
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"https://github.com/{project.repo_full_name}")
            if resp.status_code == 200:
                return {"message": "Success: Public repository is accessible! Ensure the Webhook is configured on GitHub."}
            
            # If 404/403, and we have a deploy key, try SSH check
            if resp.status_code in (404, 403) and project.deploy_key_private:
                from app.worker.git_utils import list_remote_branches
                import os
                
                key_path = f"/tmp/test_key_{project.id}"
                with open(key_path, "w") as f:
                    f.write(project.deploy_key_private)
                os.chmod(key_path, 0o600)
                
                try:
                    ssh_url = get_repo_ssh_url(project.repo_full_name)
                    list_remote_branches(ssh_url, key_path)
                    return {
                        "message": "Success: Repository accessible via SSH Deploy Key!",
                        "detail": "The repository is private, but your Deploy Key is working correctly."
                    }
                except Exception as ssh_err:
                    return {
                        "message": f"Failed: Repository not accessible (HTTP {resp.status_code}).",
                        "detail": f"SSH check also failed: {str(ssh_err)}"
                    }
                finally:
                    if os.path.exists(key_path):
                        os.remove(key_path)

            return {
                "message": f"Failed: Repository not accessible (HTTP {resp.status_code}).",
                "detail": "If the repository is private, you MUST add the Deploy Key to GitHub or use OAuth."
            }
        except Exception as e:
            return {
                "message": "Failed: Network error while checking repository.",
                "detail": str(e)
            }


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
    webhook_url = f"{settings.webhook_base_url}/webhooks/github/{project.slug}"
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
