"""
Webhook router — receive and process GitHub push events
"""
import hashlib
import hmac
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import verify_github_webhook_signature
from app.core.config import get_settings
from app.models import Project, Branch, Build, BuildStatus, EnvironmentType

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)
settings = get_settings()


@router.post("/github/{project_slug}")
async def github_webhook(
    project_slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_hub_signature_256: str | None = Header(None),
    x_github_event: str | None = Header(None),
):
    """
    Receive GitHub webhook events.
    Only processes 'push' events to trigger builds.
    """
    body = await request.body()

    # Find project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Verify signature using per-project webhook secret
    if not _verify_signature(body, x_hub_signature_256, project.webhook_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = json.loads(body)
    event_type = x_github_event or "unknown"
    logger.info(f"GitHub webhook: project={project_slug}, event={event_type}")

    if event_type == "ping":
        return {"message": "pong", "project": project_slug}

    if event_type == "push":
        return await _handle_push(payload, project, db)

    return {"message": f"Event '{event_type}' received but not processed"}


async def _handle_push(payload: dict, project: Project, db: AsyncSession):
    """Handle GitHub push event → create Build → dispatch Celery task."""
    from app.worker.tasks.build import trigger_build

    ref = payload.get("ref", "")  # e.g. refs/heads/main
    if not ref.startswith("refs/heads/"):
        return {"message": "Not a branch push, skipping"}

    branch_name = ref.replace("refs/heads/", "")
    after_sha = payload.get("after", "")

    # Skip if deleted branch (after = 0000...)
    if after_sha.replace("0", "") == "":
        return {"message": "Branch deleted event, skipping"}

    # Get commit info
    commits = payload.get("commits", [])
    latest_commit = commits[-1] if commits else {}
    commit_message = latest_commit.get("message", "")
    commit_author = latest_commit.get("author", {}).get("name", "unknown")
    commit_author_avatar = payload.get("sender", {}).get("avatar_url")

    # Find or create branch
    result = await db.execute(
        select(Branch).where(
            Branch.project_id == project.id,
            Branch.name == branch_name,
        )
    )
    branch = result.scalar_one_or_none()

    if not branch:
        # Auto-create as development branch
        logger.info(f"Auto-creating branch '{branch_name}' for project '{project.slug}'")
        branch = Branch(
            project_id=project.id,
            name=branch_name,
            environment=EnvironmentType.DEVELOPMENT,
            odoo_version=project.odoo_version,
        )
        db.add(branch)
        await db.flush()

    # Check auto_deploy flag
    if not branch.auto_deploy:
        return {"message": f"Auto-deploy disabled for branch '{branch_name}'"}

    # Create Build record
    build = Build(
        branch_id=branch.id,
        commit_sha=after_sha,
        commit_message=commit_message[:500],
        commit_author=commit_author,
        commit_author_avatar=commit_author_avatar,
        triggered_by="push",
        status=BuildStatus.PENDING,
    )
    db.add(build)
    await db.flush()

    build_id = str(build.id)
    branch_id = str(branch.id)

    # Dispatch async Celery task
    trigger_build.delay(build_id, branch_id)

    logger.info(f"Build {build_id[:8]} queued for {project.slug}/{branch_name}@{after_sha[:8]}")
    return {
        "message": "Build queued",
        "build_id": build_id,
        "branch": branch_name,
        "commit": after_sha[:8],
    }


def _verify_signature(body: bytes, signature_header: str | None, secret: str) -> bool:
    if not signature_header or not secret:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)
