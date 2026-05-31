"""
Pipeline Config router — per-project structured pipeline configuration.
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import ProjectCIConfig, ProjectMember, UserRole, User
from app.schemas import PipelineConfigOut, PipelineConfig
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404

router = APIRouter(prefix="/projects", tags=["pipeline"])


async def _get_or_create_record(project_id: uuid.UUID, db: AsyncSession) -> ProjectCIConfig:
    result = await db.execute(
        select(ProjectCIConfig).where(ProjectCIConfig.project_id == project_id)
    )
    ci = result.scalar_one_or_none()
    if not ci:
        # Initialize with an empty pipeline config
        default_config = PipelineConfig(stages=[]).model_dump()
        ci = ProjectCIConfig(project_id=project_id, config=default_config)
        db.add(ci)
        await db.commit()
        await db.refresh(ci)
    return ci


async def _require_owner(project_id: uuid.UUID, current_user: User, db: AsyncSession) -> None:
    if current_user.is_superuser:
        return
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member or member.role != UserRole.OWNER:
        raise HTTPException(status_code=403, detail="Owner role required")


@router.get("/{id}/pipeline", response_model=PipelineConfigOut)
async def get_pipeline_config(
    id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get the structured pipeline configuration for a project."""
    await get_project_or_404(str(id), db, current_user)
    ci = await _get_or_create_record(id, db)
    
    # Handle legacy configurations (which were dicts mapping filename to string)
    if isinstance(ci.config, dict) and (".opsway.yml" in ci.config or not "stages" in ci.config):
        ci.config = PipelineConfig(stages=[]).model_dump()

    return ci


@router.put("/{id}/pipeline", response_model=PipelineConfigOut)
async def update_pipeline_config(
    id: uuid.UUID,
    payload: PipelineConfig,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update the structured pipeline configuration for a project."""
    await get_project_or_404(str(id), db, current_user)
    await _require_owner(id, current_user, db)

    ci = await _get_or_create_record(id, db)
    ci.config = payload.model_dump()
    
    await db.commit()
    await db.refresh(ci)
    
    return ci
