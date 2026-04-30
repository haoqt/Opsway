"""
CI Config router — per-project CI file storage (raw content), repo auto-sync, and default generation.

Files stored as {filename: raw_content_string} in project_ci_configs.config (JSON column).
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import ProjectCIConfig, ProjectMember, UserRole, User, ProjectType
from app.schemas import CIFilesOut, CIFileUpdate
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404
from app.services.ci_config_generator import (
    CI_FILENAMES, FILENAME_GENERATORS, get_effective_config, DEFAULT_CI_CONFIG
)

router = APIRouter(prefix="/projects", tags=["ci-config"])


def _require_generic_project(project) -> None:
    """CI Config Files are only available for Generic projects."""
    if project.project_type == ProjectType.ODOO:
        raise HTTPException(
            status_code=400,
            detail="CI Config Files are not available for Odoo projects. Use Project Settings instead."
        )


async def _get_or_create_record(project_id: uuid.UUID, db: AsyncSession) -> ProjectCIConfig:
    result = await db.execute(
        select(ProjectCIConfig).where(ProjectCIConfig.project_id == project_id)
    )
    ci = result.scalar_one_or_none()
    if not ci:
        ci = ProjectCIConfig(project_id=project_id, config={})
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


def _build_files_response(stored: dict, odoo_version: str | None) -> dict:
    """Return all CI files: stored content if present, generated default otherwise."""
    effective_cfg = get_effective_config({})  # default config for generation
    files = {}
    for filename in CI_FILENAMES:
        if filename in stored:
            files[filename] = stored[filename]
        else:
            gen = FILENAME_GENERATORS.get(filename)
            if gen:
                try:
                    files[filename] = gen(effective_cfg, odoo_version)
                except TypeError:
                    files[filename] = gen(effective_cfg)
            else:
                files[filename] = ""
    return files


# ── Endpoints ──────────────────────────────────────────────────

@router.get("/{project_id}/ci-config", response_model=CIFilesOut)
async def get_ci_files(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all CI files — stored content or generated defaults."""
    project = await get_project_or_404(project_id, db, current_user)
    _require_generic_project(project)
    ci = await _get_or_create_record(project.id, db)

    stored = dict(ci.config or {})
    files = _build_files_response(stored, project.odoo_version)

    return CIFilesOut(
        id=ci.id,
        project_id=ci.project_id,
        files=files,
        updated_at=ci.updated_at,
    )


@router.put("/{project_id}/ci-config/files/{filename:path}", response_model=CIFilesOut)
async def save_ci_file(
    project_id: str,
    filename: str,
    data: CIFileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save raw content for a specific CI file."""
    if filename not in CI_FILENAMES:
        raise HTTPException(status_code=400, detail=f"Unknown file: {filename}. Allowed: {CI_FILENAMES}")

    project = await get_project_or_404(project_id, db, current_user)
    _require_generic_project(project)
    await _require_owner(project.id, current_user, db)

    ci = await _get_or_create_record(project.id, db)
    stored = dict(ci.config or {})
    stored[filename] = data.content
    ci.config = stored
    db.add(ci)
    await db.commit()
    await db.refresh(ci)

    files = _build_files_response(stored, project.odoo_version)
    return CIFilesOut(id=ci.id, project_id=ci.project_id, files=files, updated_at=ci.updated_at)


@router.delete("/{project_id}/ci-config/files/{filename:path}", response_model=CIFilesOut)
async def reset_ci_file(
    project_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove custom content for a file — it will revert to generated default."""
    if filename not in CI_FILENAMES:
        raise HTTPException(status_code=400, detail=f"Unknown file: {filename}")

    project = await get_project_or_404(project_id, db, current_user)
    _require_generic_project(project)
    await _require_owner(project.id, current_user, db)

    ci = await _get_or_create_record(project.id, db)
    stored = dict(ci.config or {})
    stored.pop(filename, None)
    ci.config = stored
    db.add(ci)
    await db.commit()
    await db.refresh(ci)

    files = _build_files_response(stored, project.odoo_version)
    return CIFilesOut(id=ci.id, project_id=ci.project_id, files=files, updated_at=ci.updated_at)


@router.get("/{project_id}/ci-config/files/{filename:path}", response_class=PlainTextResponse)
async def download_ci_file(
    project_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download a single CI file as plain text."""
    if filename not in CI_FILENAMES:
        raise HTTPException(status_code=404, detail=f"Unknown file: {filename}")

    project = await get_project_or_404(project_id, db, current_user)
    _require_generic_project(project)
    ci = await _get_or_create_record(project.id, db)
    stored = dict(ci.config or {})

    if filename in stored:
        content = stored[filename]
    else:
        effective_cfg = get_effective_config({})
        gen = FILENAME_GENERATORS[filename]
        try:
            content = gen(effective_cfg, project.odoo_version)
        except TypeError:
            content = gen(effective_cfg)

    return PlainTextResponse(
        content=content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
