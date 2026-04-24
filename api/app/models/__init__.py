"""
Opsway Database Models
"""
import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    String, Text, Integer, Boolean, DateTime, Enum,
    ForeignKey, JSON, BigInteger, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────

class GitProvider(str, enum.Enum):
    GITHUB = "github"
    GITLAB = "gitlab"
    GITEA = "gitea"


class EnvironmentType(str, enum.Enum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class BuildStatus(str, enum.Enum):
    PENDING = "pending"
    BUILDING = "building"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


class UserRole(str, enum.Enum):
    OWNER = "owner"
    DEVELOPER = "developer"
    VIEWER = "viewer"


# ──────────────────────────────────────────────────────────────
# User
# ──────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255))
    full_name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(500))

    # OAuth
    github_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    github_login: Mapped[str | None] = mapped_column(String(100))
    github_token: Mapped[str | None] = mapped_column(Text)  # encrypted in prod

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    project_members: Mapped[list["ProjectMember"]] = relationship(back_populates="user")


# ──────────────────────────────────────────────────────────────
# Project
# ──────────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    # Git integration
    git_provider: Mapped[GitProvider] = mapped_column(
        Enum(GitProvider), default=GitProvider.GITHUB, nullable=False
    )
    repo_owner: Mapped[str] = mapped_column(String(255), nullable=False)
    repo_name: Mapped[str] = mapped_column(String(255), nullable=False)
    repo_full_name: Mapped[str] = mapped_column(String(512), nullable=False)  # owner/repo
    repo_url: Mapped[str] = mapped_column(String(512))
    repo_id: Mapped[str | None] = mapped_column(String(100))  # GitHub repo ID

    # Webhook
    webhook_id: Mapped[str | None] = mapped_column(String(100))
    webhook_secret: Mapped[str] = mapped_column(String(255), default=lambda: str(uuid.uuid4()))

    # Deploy key (for private repos)
    deploy_key_id: Mapped[str | None] = mapped_column(String(100))
    deploy_key_public: Mapped[str | None] = mapped_column(Text)
    deploy_key_private: Mapped[str | None] = mapped_column(Text)  # encrypted

    # Odoo config
    odoo_version: Mapped[str | None] = mapped_column(String(10))  # e.g. "17"
    custom_addons_path: Mapped[str | None] = mapped_column(String(255), default="custom_addons")

    # Build limits
    build_limit_dev: Mapped[int] = mapped_column(Integer, default=5)
    build_limit_staging: Mapped[int] = mapped_column(Integer, default=2)
    build_limit_production: Mapped[int] = mapped_column(Integer, default=1)

    # Domain settings (Phase 2)
    custom_domain: Mapped[str | None] = mapped_column(String(255))  # e.g. "mycompany.com"
    custom_domain_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    custom_domain_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Backup policy (Phase 2)
    backup_schedule: Mapped[str] = mapped_column(String(50), default="daily")  # daily/weekly/none
    backup_retention_daily: Mapped[int] = mapped_column(Integer, default=7)
    backup_retention_weekly: Mapped[int] = mapped_column(Integer, default=4)
    backup_retention_monthly: Mapped[int] = mapped_column(Integer, default=3)

    # Notifications (Phase 2)
    notification_email: Mapped[str | None] = mapped_column(String(255))  # email to notify on build events
    notification_webhook_url: Mapped[str | None] = mapped_column(String(512))  # generic webhook URL

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    branches: Mapped[list["Branch"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    members: Mapped[list["ProjectMember"]] = relationship(back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("git_provider", "repo_full_name", name="uq_project_repo"),
    )


class ProjectMember(Base):
    __tablename__ = "project_members"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.DEVELOPER)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    project: Mapped["Project"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="project_members")

    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )


# ──────────────────────────────────────────────────────────────
# Branch
# ──────────────────────────────────────────────────────────────

class Branch(Base):
    __tablename__ = "branches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))

    name: Mapped[str] = mapped_column(String(255), nullable=False)  # git branch name
    environment: Mapped[EnvironmentType] = mapped_column(
        Enum(EnvironmentType), default=EnvironmentType.DEVELOPMENT, nullable=False
    )

    # Container state
    container_id: Mapped[str | None] = mapped_column(String(100))
    container_name: Mapped[str | None] = mapped_column(String(255))
    container_url: Mapped[str | None] = mapped_column(String(512))  # http://<branch>.<proj>.localhost
    container_status: Mapped[str | None] = mapped_column(String(50))  # running/stopped/etc

    # Database
    db_name: Mapped[str | None] = mapped_column(String(255))
    db_container_id: Mapped[str | None] = mapped_column(String(100))

    # Odoo version (overrides project default)
    odoo_version: Mapped[str | None] = mapped_column(String(10))

    # Settings
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    auto_deploy: Mapped[bool] = mapped_column(Boolean, default=True)  # deploy on push
    run_tests: Mapped[bool] = mapped_column(Boolean, default=True)   # run unit tests (dev only)

    # Environment variables (JSON)
    env_vars: Mapped[dict | None] = mapped_column(JSON, default=dict)


    # Neutralization tracking (Phase 2)
    is_neutralized: Mapped[bool] = mapped_column(Boolean, default=False)
    neutralized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cloned_from_branch_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("branches.id", ondelete="SET NULL"), nullable=True
    )

    # Active Operations (Cloning, Building, Neutralizing, etc)
    current_task: Mapped[str | None] = mapped_column(String(50))
    current_task_status: Mapped[str | None] = mapped_column(String(50))  # pending, running, failed

    # Last deploy
    last_commit_sha: Mapped[str | None] = mapped_column(String(40))
    last_commit_message: Mapped[str | None] = mapped_column(Text)
    last_commit_author: Mapped[str | None] = mapped_column(String(255))
    last_deployed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    project: Mapped["Project"] = relationship(back_populates="branches")
    builds: Mapped[list["Build"]] = relationship(back_populates="branch", cascade="all, delete-orphan")
    cloned_from_branch: Mapped["Branch | None"] = relationship(
        "Branch", remote_side="Branch.id", foreign_keys=[cloned_from_branch_id]
    )

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_branch_project"),
    )


# ──────────────────────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────────────────────

class Build(Base):
    __tablename__ = "builds"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))

    # Trigger info
    commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    commit_message: Mapped[str | None] = mapped_column(Text)
    commit_author: Mapped[str | None] = mapped_column(String(255))
    commit_author_avatar: Mapped[str | None] = mapped_column(String(512))
    triggered_by: Mapped[str] = mapped_column(String(50), default="push")  # push / manual / api

    # Status
    status: Mapped[BuildStatus] = mapped_column(
        Enum(BuildStatus), default=BuildStatus.PENDING, nullable=False, index=True
    )

    # Timing
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)

    # Results
    test_passed: Mapped[bool | None] = mapped_column(Boolean)
    test_count: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)

    # Log (stored in Redis as stream, small summary here)
    log_key: Mapped[str | None] = mapped_column(String(255))  # Redis key for full log
    task_id: Mapped[str | None] = mapped_column(String(100))  # Celery Task ID

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # Relationships
    branch: Mapped["Branch"] = relationship(back_populates="builds")


# ──────────────────────────────────────────────────────────────
# Backup
# ──────────────────────────────────────────────────────────────

class Backup(Base):
    __tablename__ = "backups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id", ondelete="CASCADE"))

    backup_type: Mapped[str] = mapped_column(String(20))  # daily/weekly/monthly/manual
    storage_path: Mapped[str] = mapped_column(String(512))  # MinIO path
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/completed/failed
    error_message: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
