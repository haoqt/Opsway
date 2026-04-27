"""
Project Members router — manage team access and roles per project
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models import Project, ProjectMember, User, UserRole
from app.schemas import MemberOut, MemberAdd, MemberUpdate, MessageResponse
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404

router = APIRouter(prefix="/projects/{project_id}/members", tags=["members"])


async def require_owner(project: Project, db: AsyncSession, current_user: User) -> ProjectMember:
    """Raise 403 unless user is OWNER or superuser."""
    if current_user.is_superuser:
        result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == current_user.id,
            )
        )
        m = result.scalar_one_or_none()
        return m  # superuser bypasses role check
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == current_user.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member or member.role != UserRole.OWNER:
        raise HTTPException(status_code=403, detail="Project owner role required")
    return member


@router.get("", response_model=list[MemberOut])
async def list_members(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_project_or_404(project_id, db, current_user)
    result = await db.execute(
        select(ProjectMember)
        .options(selectinload(ProjectMember.user))
        .where(ProjectMember.project_id == uuid.UUID(project_id))
        .order_by(ProjectMember.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=MemberOut, status_code=201)
async def add_member(
    project_id: str,
    data: MemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    await require_owner(project, db, current_user)

    # Check user exists
    user = await db.get(User, data.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")

    # Check not already a member
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == data.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User is already a member of this project")

    # Only one OWNER allowed
    if data.role == UserRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot assign OWNER role to additional members. Transfer ownership instead.")

    member = ProjectMember(
        project_id=project.id,
        user_id=data.user_id,
        role=data.role,
    )
    db.add(member)
    await db.flush()
    await db.refresh(member, ["user"])
    return member


@router.patch("/{member_id}", response_model=MemberOut)
async def update_member_role(
    project_id: str,
    member_id: str,
    data: MemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    await require_owner(project, db, current_user)

    result = await db.execute(
        select(ProjectMember)
        .options(selectinload(ProjectMember.user))
        .where(
            ProjectMember.id == uuid.UUID(member_id),
            ProjectMember.project_id == project.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    if data.role == UserRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot assign OWNER role. Transfer ownership instead.")

    member.role = data.role
    await db.flush()
    return member


@router.delete("/{member_id}", response_model=MessageResponse)
async def remove_member(
    project_id: str,
    member_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await get_project_or_404(project_id, db, current_user)
    await require_owner(project, db, current_user)

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.id == uuid.UUID(member_id),
            ProjectMember.project_id == project.id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if member.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself from the project")

    if member.role == UserRole.OWNER:
        raise HTTPException(status_code=400, detail="Cannot remove the project owner")

    await db.delete(member)
    await db.flush()
    return {"message": "Member removed from project"}
