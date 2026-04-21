from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import Project, Build, BuildStatus, Branch
from app.schemas import GlobalStats

router = APIRouter(prefix="/stats", tags=["stats"])

@router.get("", response_model=GlobalStats)
async def get_global_stats(db: AsyncSession = Depends(get_db)):
    """Fetch aggregated system metrics for the dashboard."""
    # Active builds (Pending or Building)
    active_builds_q = await db.execute(
        select(func.count(Build.id)).where(Build.status.in_([BuildStatus.PENDING, BuildStatus.BUILDING]))
    )
    active_builds = active_builds_q.scalar() or 0

    # Deployments today (successful builds since midnight UTC)
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    deployments_today_q = await db.execute(
        select(func.count(Build.id)).where(
            Build.status == BuildStatus.SUCCESS,
            Build.finished_at >= today_start
        )
    )
    deployments_today = deployments_today_q.scalar() or 0

    # Running containers
    containers_q = await db.execute(
        select(func.count(Branch.id)).where(Branch.container_status == "running")
    )
    containers = containers_q.scalar() or 0

    # Active projects
    projects_q = await db.execute(
        select(func.count(Project.id)).where(Project.is_active == True)
    )
    projects = projects_q.scalar() or 0

    return {
        "active_builds": active_builds,
        "deployments_today": deployments_today,
        "containers": containers,
        "projects": projects
    }
