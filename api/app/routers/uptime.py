"""
Uptime router — history and current status for branch uptime monitoring
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models import Branch, UptimeCheck, ProjectMember, User
from app.schemas import UptimeCheckOut, BranchOut
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404

router = APIRouter(prefix="/uptime", tags=["uptime"])


@router.get("/projects/{project_id}", response_model=list[BranchOut])
async def get_project_uptime(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all branches for a project with current uptime_status populated."""
    project = await get_project_or_404(project_id, db, current_user)
    result = await db.execute(
        select(Branch).where(Branch.project_id == project.id, Branch.is_active == True)
    )
    return result.scalars().all()


@router.get("/branches/{branch_id}/history", response_model=list[UptimeCheckOut])
async def get_branch_uptime_history(
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the last 100 uptime check records for a branch."""
    try:
        bid = uuid.UUID(branch_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Branch not found")

    branch = await db.get(Branch, bid)
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    # Verify membership via project
    await get_project_or_404(str(branch.project_id), db, current_user)

    result = await db.execute(
        select(UptimeCheck)
        .where(UptimeCheck.branch_id == bid)
        .order_by(UptimeCheck.checked_at.desc())
        .limit(100)
    )
    return result.scalars().all()
