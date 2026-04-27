from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.models import Project, Build, BuildStatus, Branch, ProjectMember, User
from app.schemas import GlobalStats
from app.routers.auth import get_current_user

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("", response_model=GlobalStats)
async def get_global_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch aggregated metrics scoped to the current user's projects."""
    now = datetime.now(timezone.utc)
    today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

    # Superusers see global stats; regular users see only their projects
    if current_user.is_superuser:
        project_ids_sq = select(Project.id).where(Project.is_active == True).scalar_subquery()
    else:
        project_ids_sq = (
            select(ProjectMember.project_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                ProjectMember.user_id == current_user.id,
                Project.is_active == True,
            )
            .scalar_subquery()
        )

    # Active projects
    projects_q = await db.execute(
        select(func.count()).select_from(
            select(Project.id).where(Project.id.in_(project_ids_sq)).subquery()
        )
    )
    projects = projects_q.scalar() or 0

    # Branch IDs in user's projects
    branch_ids_sq = (
        select(Branch.id)
        .where(Branch.project_id.in_(project_ids_sq))
        .scalar_subquery()
    )

    # Active builds
    active_builds_q = await db.execute(
        select(func.count(Build.id)).where(
            Build.status.in_([BuildStatus.PENDING, BuildStatus.BUILDING]),
            Build.branch_id.in_(branch_ids_sq),
        )
    )
    active_builds = active_builds_q.scalar() or 0

    # Deployments today
    deployments_today_q = await db.execute(
        select(func.count(Build.id)).where(
            Build.status == BuildStatus.SUCCESS,
            Build.finished_at >= today_start,
            Build.branch_id.in_(branch_ids_sq),
        )
    )
    deployments_today = deployments_today_q.scalar() or 0

    # Running containers
    containers_q = await db.execute(
        select(func.count(Branch.id)).where(
            Branch.container_status == "running",
            Branch.id.in_(branch_ids_sq),
        )
    )
    containers = containers_q.scalar() or 0

    return {
        "active_builds": active_builds,
        "deployments_today": deployments_today,
        "containers": containers,
        "projects": projects,
    }
