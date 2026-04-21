"""
Builds router — build detail, log streaming, cancel
"""
import asyncio
import json
import uuid
import logging
from typing import AsyncGenerator

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import get_settings
from app.models import Build, Branch, Project, BuildStatus, User
from app.schemas import BuildOut, BuildDetail, BranchOut, MessageResponse
from app.routers.auth import get_current_user

router = APIRouter(prefix="/builds", tags=["builds"])
logger = logging.getLogger(__name__)
settings = get_settings()


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
    return BuildDetail(
        **BuildOut.model_validate(build).model_dump(),
        branch=BranchOut.model_validate(branch),
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

    # TODO: revoke Celery task
    build.status = BuildStatus.CANCELLED
    await db.flush()
    return {"message": f"Build {build_id[:8]} cancelled"}


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
