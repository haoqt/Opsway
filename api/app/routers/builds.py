"""
Builds router — build detail, log streaming, cancel
"""
import asyncio
import json
import uuid
import logging
from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import get_settings
from app.models import Build, Branch, Project, BuildStatus, User
from app.schemas import BuildOut, BuildDetail, BranchOut, MessageResponse
from app.routers.auth import get_current_user
from app.worker.celery_app import celery_app
from app.worker.docker_manager import DockerManager
from app.worker.tasks.build import trigger_build

router = APIRouter(prefix="/builds", tags=["builds"])
logger = logging.getLogger(__name__)
settings = get_settings()


@router.get("", response_model=list[BuildDetail])
async def list_all_builds(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
):
    """List recent builds across all projects the user has access to."""
    from app.models import ProjectMember
    result = await db.execute(
        select(Build, Branch, Project.name)
        .select_from(Build)
        .join(Branch, Build.branch_id == Branch.id)
        .join(Project, Branch.project_id == Project.id)
        .join(ProjectMember, Project.id == ProjectMember.project_id)
        .where(ProjectMember.user_id == current_user.id)
        .order_by(Build.created_at.desc())
        .offset(skip).limit(limit)
    )
    
    builds = []
    for build, branch, p_name in result:
        build_out = BuildDetail(
            **BuildOut.model_validate(build).model_dump(),
            branch=BranchOut.model_validate(branch),
            project_name=p_name
        )
        builds.append(build_out)
    return builds


async def _get_redis():
    return await aioredis.from_url(settings.redis_url, decode_responses=True)


@router.get("/{build_id}", response_model=BuildDetail)
async def get_build(
    build_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    build = await db.get(Build, uuid.UUID(build_id))
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    
    branch = await db.get(Branch, build.branch_id)
    project = await db.get(Project, branch.project_id)
    
    return BuildDetail(
        **BuildOut.model_validate(build).model_dump(),
        branch=BranchOut.model_validate(branch),
        project_name=project.name if project else None
    )


@router.post("/{build_id}/cancel", response_model=MessageResponse)
async def cancel_build(
    build_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    build = await db.get(Build, uuid.UUID(build_id))
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")
    if build.status not in (BuildStatus.PENDING, BuildStatus.BUILDING):
        raise HTTPException(status_code=400, detail="Build is not cancellable")

    # 1. Revoke Celery task
    if build.task_id:
        logger.info(f"Revoking Celery task {build.task_id} for build {build_id}")
        celery_app.control.revoke(build.task_id, terminate=True)

    # 2. Cleanup associated containers if it is BUILDING
    if build.status == BuildStatus.BUILDING:
        branch = await db.get(Branch, build.branch_id)
        project = await db.get(Project, branch.project_id)
        if branch and project:
            docker = DockerManager()
            # Stop Odoo container
            odoo_name = docker.get_container_name(project.slug, branch.name)
            logger.info(f"Stopping container {odoo_name}")
            docker.stop_container(odoo_name, remove=True)
            # Stop Postgres container
            pg_name = docker.get_db_container_name(project.slug, branch.name)
            logger.info(f"Stopping container {pg_name}")
            docker.stop_container(pg_name, remove=True)

    build.status = BuildStatus.CANCELLED
    await db.flush()
    return {"message": f"Build {build_id[:8]} cancelled"}


@router.post("/{build_id}/retry", response_model=BuildOut, status_code=202)
async def retry_build(
    build_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-trigger a build using the same commit info."""
    old_build = await db.get(Build, uuid.UUID(build_id))
    if not old_build:
        raise HTTPException(status_code=404, detail="Build not found")
    
    # Reset existing build instead of creating new
    old_build.status = BuildStatus.PENDING
    old_build.started_at = None
    old_build.finished_at = None
    old_build.duration_seconds = None
    old_build.error_message = None
    old_build.test_passed = None
    old_build.test_count = None
    old_build.triggered_by = "retry"
    
    # Dispatch same build ID to Celery
    task = trigger_build.delay(str(old_build.id), str(old_build.branch_id))
    old_build.task_id = task.id
    
    await db.commit()
    return old_build
@router.get("/{build_id}/logs")
async def stream_build_logs(
    build_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Server-Sent Events endpoint for real-time build log streaming.
    
    Client usage:
        const es = new EventSource('/api/builds/<id>/logs');
        es.onmessage = (e) => console.log(e.data);
    """
    build = await db.get(Build, uuid.UUID(build_id))
    if not build:
        raise HTTPException(status_code=404, detail="Build not found")

    async def event_generator() -> AsyncGenerator[str, None]:
        redis = await _get_redis()
        log_key = f"opsway:build_log:{build_id}"
        channel = f"opsway:build:{build_id}:log"

        # First: dump existing log lines
        existing = await redis.lrange(log_key, 0, -1)
        for line in existing:
            yield f"data: {json.dumps({'type': 'log', 'line': line})}\n\n"

        # Then: subscribe to live updates
        current_build = await db.get(Build, uuid.UUID(build_id))
        if current_build and current_build.status in (
            BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED
        ):
            yield f"data: {json.dumps({'type': 'done', 'status': current_build.status.value})}\n\n"
            await redis.aclose()
            return

        pubsub = redis.pubsub()
        await pubsub.subscribe(channel)
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    line = message["data"]
                    yield f"data: {json.dumps({'type': 'log', 'line': line})}\n\n"

                # Check if build is done
                refreshed = await db.get(Build, uuid.UUID(build_id))
                if refreshed and refreshed.status in (
                    BuildStatus.SUCCESS, BuildStatus.FAILED, BuildStatus.CANCELLED
                ):
                    yield f"data: {json.dumps({'type': 'done', 'status': refreshed.status.value})}\n\n"
                    break
        finally:
            await pubsub.unsubscribe(channel)
            await redis.aclose()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
