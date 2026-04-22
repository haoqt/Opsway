import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from minio.error import S3Error

from app.core.database import get_db
from app.routers.auth import get_current_user
from app.routers.projects import get_project_or_404
from app.models import Branch, Backup, Project, UserRole, User, ProjectMember
from app.worker.tasks.backup import backup_branch, get_minio_client
from app.core.config import get_settings

router = APIRouter()
settings = get_settings()

class BackupResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    branch_id: uuid.UUID
    backup_type: str
    storage_path: str | None
    size_bytes: int | None
    status: str
    error_message: str | None
    created_at: Any
    expires_at: Any | None

    class Config:
        from_attributes = True

@router.get("/projects/{project_id}/branches/{branch_id}/backups", response_model=list[BackupResponse])
async def list_backups(
    project_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all backups for a branch."""
    await get_project_or_404(project_id, db, current_user)
    
    stmt = select(Backup).where(Backup.branch_id == uuid.UUID(branch_id)).order_by(Backup.created_at.desc())
    result = await db.execute(stmt)
    backups = result.scalars().all()
    
    return backups

@router.post("/projects/{project_id}/branches/{branch_id}/backups", response_model=BackupResponse)
async def create_backup(
    project_id: str,
    branch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger a manual backup for the branch."""
    project = await get_project_or_404(project_id, db, current_user)
    
    # Check for DEVELOPER or OWNER role
    if not current_user.is_superuser:
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == current_user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role == UserRole.VIEWER:
            raise HTTPException(status_code=403, detail="Developer role required")
    
    branch = await db.get(Branch, uuid.UUID(branch_id))
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
        
    if not branch.db_name:
        raise HTTPException(status_code=400, detail="Branch has no database assigned yet")
        
    backup = Backup(
        project_id=uuid.UUID(project_id),
        branch_id=uuid.UUID(branch_id),
        backup_type="manual",
        storage_path="",
        status="pending",
    )
    db.add(backup)
    await db.commit()
    await db.refresh(backup)
    
    # Trigger Celery Task
    backup_branch.delay(str(backup.id))
    
    return backup

@router.post("/projects/{project_id}/branches/{branch_id}/backups/restore-upload")
async def restore_from_upload(
    project_id: str,
    branch_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an external backup file and trigger restoration."""
    project = await get_project_or_404(project_id, db, current_user)
    
    # Check for DEVELOPER or OWNER role
    if not current_user.is_superuser:
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == current_user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role == UserRole.VIEWER:
            raise HTTPException(status_code=403, detail="Developer role required")
            
    if not file.filename.endswith(".tar.gz"):
        raise HTTPException(status_code=400, detail="Only .tar.gz files are supported")

    try:
        minio = get_minio_client()
        
        # 1. Upload to a temporary path in MinIO
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        object_name = f"{project.slug}/uploads/upload_{timestamp}_{file.filename}"
        
        # Read file into memory (for small files) or stream it
        file_content = await file.read()
        file_size = len(file_content)
        
        minio.put_object(
            settings.minio_bucket_backups,
            object_name,
            io.BytesIO(file_content),
            length=file_size,
            content_type="application/gzip",
        )
        
        # 2. Create a temporary backup record
        backup = Backup(
            project_id=uuid.UUID(project_id),
            branch_id=uuid.UUID(branch_id),
            backup_type="upload",
            storage_path=object_name,
            size_bytes=file_size,
            status="completed",
        )
        db.add(backup)
        await db.commit()
        await db.refresh(backup)
        
        # 3. Trigger restoration
        from app.worker.tasks.restore import restore_backup
        restore_backup.delay(str(backup.id))
        
        return {"message": "File uploaded and restoration triggered", "backup_id": str(backup.id)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.get("/projects/{project_id}/branches/{branch_id}/backups/{backup_id}/download")
async def get_backup_download_url(
    project_id: str,
    branch_id: str,
    backup_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a presigned S3/MinIO URL to download the backup."""
    project = await get_project_or_404(project_id, db, current_user)
    
    # Check for DEVELOPER or OWNER role
    if not current_user.is_superuser:
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == current_user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role == UserRole.VIEWER:
            raise HTTPException(status_code=403, detail="Developer role required")
    
    backup = await db.get(Backup, uuid.UUID(backup_id))
    if not backup or str(backup.branch_id) != branch_id:
        raise HTTPException(status_code=404, detail="Backup not found")
        
    if backup.status != "completed" or not backup.storage_path:
        raise HTTPException(status_code=400, detail="Backup is not completed or has no file")
        
    try:
        # For development, we must sign the URL with 'localhost:9000' because that's 
        # how the browser accesses MinIO. 
        if settings.app_env == "development":
            from minio import Minio
            signer = Minio(
                "localhost:9000",
                access_key=settings.minio_access_key,
                secret_key=settings.minio_secret_key,
                secure=settings.minio_secure,
                region="us-east-1"
            )
        else:
            signer = get_minio_client()

        url = signer.presigned_get_object(
            settings.minio_bucket_backups,
            backup.storage_path,
            expires=timedelta(hours=1)
        )
        return RedirectResponse(url)
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {str(e)}")

@router.post("/projects/{project_id}/branches/{branch_id}/backups/{backup_id}/restore")
async def trigger_restore(
    project_id: str,
    branch_id: str,
    backup_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger a restoration of a backup."""
    project = await get_project_or_404(project_id, db, current_user)
    
    # Check for DEVELOPER or OWNER role
    if not current_user.is_superuser:
        member_result = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == current_user.id,
            )
        )
        member = member_result.scalar_one_or_none()
        if not member or member.role == UserRole.VIEWER:
            raise HTTPException(status_code=403, detail="Developer role required")
    
    backup = await db.get(Backup, uuid.UUID(backup_id))
    if not backup or str(backup.branch_id) != branch_id:
        raise HTTPException(status_code=404, detail="Backup not found")
        
    if backup.status != "completed":
        raise HTTPException(status_code=400, detail="Only completed backups can be restored")
        
    # Import here to avoid circular imports
    from app.worker.tasks.restore import restore_backup
    
    # Trigger Celery Task
    restore_backup.delay(str(backup.id))
    
    return {"message": "Restoration task triggered"}
