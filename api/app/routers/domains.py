"""
Domains router — Custom domain management for branches.
Supports setting, verifying (DNS CNAME check), and removing custom domains.
"""
import logging
import socket
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.config import get_settings
from app.models import Project, User
from app.schemas import (
    ProjectOut, SetDomainRequest, DomainVerification, MessageResponse
)
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404
from app.worker.docker_manager import DockerManager

router = APIRouter(tags=["domains"])
logger = logging.getLogger(__name__)
settings = get_settings()


def _get_project_cname_target(project_slug: str) -> str:
    """Generate the expected CNAME target for DNS verification."""
    return f"{project_slug}.{settings.traefik_domain}"


def _verify_dns(domain: str, expected_cname: str) -> tuple[bool, str]:
    """Check if domain's DNS resolves correctly."""
    try:
        # Try CNAME resolution
        results = socket.getaddrinfo(domain, None)
        if results:
            # Also try to see if the domain resolves to something
            # For development/localhost, we accept any resolution
            if settings.traefik_domain == "localhost":
                return True, "Accepted (development mode — localhost always resolves)"
            
            # In production, we verify the CNAME target
            try:
                import subprocess
                result = subprocess.run(
                    ["dig", "+short", "CNAME", domain],
                    capture_output=True, text=True, timeout=10
                )
                cname_value = result.stdout.strip().rstrip(".")
                if cname_value and expected_cname in cname_value:
                    return True, f"CNAME verified: {domain} → {cname_value}"
                elif cname_value:
                    return False, (
                        f"CNAME mismatch: {domain} points to '{cname_value}', "
                        f"expected '{expected_cname}'"
                    )
                else:
                    # No CNAME but domain resolves (might be A record)
                    return True, "Domain resolves (A record detected, CNAME preferred)"
            except FileNotFoundError:
                # dig not available, fall back to basic resolution
                return True, "DNS resolves (CNAME check skipped — dig not available)"
        
        return False, f"DNS resolution failed for {domain}"

    except socket.gaierror as e:
        return False, f"DNS lookup failed: {e}"
    except Exception as e:
        return False, f"Verification error: {e}"


@router.post("/projects/{project_id}/domain", response_model=ProjectOut)
async def set_custom_domain(
    project_id: str,
    data: SetDomainRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set or update a custom domain for a project.
    
    After setting, the user must configure DNS (Wildcard CNAME record pointing to 
    the project slug) and then call the verify endpoint.
    """
    project = await get_project_or_404(project_id, db, current_user)

    domain = data.domain.strip().lower()

    # Validate domain format
    if not domain or "." not in domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid domain format. Example: mycompany.com"
        )

    # Check uniqueness — no other project should have this domain
    result = await db.execute(
        select(Project).where(
            Project.custom_domain == domain,
            Project.id != project.id,
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Domain '{domain}' is already assigned to another project"
        )

    project.custom_domain = domain
    project.custom_domain_verified = False
    project.custom_domain_verified_at = None
    await db.commit()
    await db.refresh(project)

    return project


@router.post(
    "/projects/{project_id}/domain/verify",
    response_model=DomainVerification,
)
async def verify_custom_domain(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify that a custom domain's DNS is correctly configured."""
    project = await get_project_or_404(project_id, db, current_user)

    if not project.custom_domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No custom domain set for this project"
        )

    cname_target = _get_project_cname_target(project.slug)
    verified, message = _verify_dns(project.custom_domain, cname_target)

    if verified:
        project.custom_domain_verified = True
        project.custom_domain_verified_at = datetime.now(timezone.utc)
        await db.commit()

    return DomainVerification(
        domain=project.custom_domain,
        verified=verified,
        cname_target=cname_target,
        message=message,
    )


@router.delete("/projects/{project_id}/domain", response_model=MessageResponse)
async def remove_custom_domain(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a custom domain from a project."""
    project = await get_project_or_404(project_id, db, current_user)

    project.custom_domain = None
    project.custom_domain_verified = False
    project.custom_domain_verified_at = None
    await db.commit()

    return {"message": f"Custom domain removed from project '{project.name}'"}


@router.get(
    "/projects/{project_id}/domain",
    response_model=DomainVerification,
)
async def get_domain_info(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get current custom domain information and DNS instructions."""
    project = await get_project_or_404(project_id, db, current_user)

    cname_target = _get_project_cname_target(project.slug)

    if not project.custom_domain:
        return DomainVerification(
            domain="",
            verified=False,
            cname_target=cname_target,
            message="No custom domain configured. Set one via POST.",
        )

    return DomainVerification(
        domain=project.custom_domain,
        verified=project.custom_domain_verified,
        cname_target=cname_target,
        message="Verified" if project.custom_domain_verified else "Pending DNS verification",
    )
