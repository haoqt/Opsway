"""
Pydantic Schemas for API request/response validation
"""
import uuid
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, EmailStr, Field

from app.models import GitProvider, EnvironmentType, BuildStatus, UserRole, UptimeStatus


# ──────────────────────────────────────────────────────────────
# Auth
# ──────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: str | None = None


class UserLogin(BaseModel):
    email: str
    password: str


class UserRegister(BaseModel):
    email: str
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    full_name: str | None = None


# ──────────────────────────────────────────────────────────────
# User
# ──────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    full_name: str | None
    avatar_url: str | None
    github_login: str | None
    is_active: bool
    is_superuser: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberUser(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    full_name: str | None
    avatar_url: str | None

    model_config = {"from_attributes": True}


class MemberOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    role: UserRole
    created_at: datetime
    user: MemberUser

    model_config = {"from_attributes": True}


class MemberAdd(BaseModel):
    user_id: uuid.UUID
    role: UserRole = UserRole.DEVELOPER


class MemberUpdate(BaseModel):
    role: UserRole


# ──────────────────────────────────────────────────────────────
# Project
# ──────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    git_provider: GitProvider = GitProvider.GITHUB
    repo_full_name: str = Field(..., description="owner/repo format")
    odoo_version: str | None = Field(None, description="16, 17, or 18")
    custom_addons_path: str = "custom_addons"
    build_limit_dev: int = 5
    build_limit_staging: int = 2
    build_limit_production: int = 1
    gitlab_token: str | None = None
    gitlab_url: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    odoo_version: str | None = None
    custom_addons_path: str | None = None
    build_limit_dev: int | None = None
    build_limit_staging: int | None = None
    build_limit_production: int | None = None
    custom_domain: str | None = None
    backup_schedule: str | None = None
    backup_retention_daily: int | None = None
    backup_retention_weekly: int | None = None
    backup_retention_monthly: int | None = None
    notification_email: str | None = None
    notification_webhook_url: str | None = None
    notification_slack_url: str | None = None
    notification_telegram_bot_token: str | None = None
    notification_telegram_chat_id: str | None = None
    gitlab_token: str | None = None
    gitlab_url: str | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str | None
    git_provider: GitProvider
    repo_owner: str
    repo_name: str
    repo_full_name: str
    repo_url: str | None
    odoo_version: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    branch_count: int = 0
    active_builds: int = 0
    build_limit_dev: int
    build_limit_staging: int
    build_limit_production: int
    custom_domain: str | None = None
    custom_domain_verified: bool = False
    backup_schedule: str = "daily"
    backup_retention_daily: int = 7
    backup_retention_weekly: int = 4
    backup_retention_monthly: int = 3
    notification_email: str | None = None
    notification_webhook_url: str | None = None
    notification_slack_url: str | None = None
    notification_telegram_bot_token: str | None = None
    notification_telegram_chat_id: str | None = None
    gitlab_url: str | None = None

    model_config = {"from_attributes": True}


class ProjectDetail(ProjectOut):
    webhook_id: str | None
    webhook_url: str | None
    webhook_secret: str | None
    deploy_key_public: str | None
    branches: list["BranchOut"] = []


# ──────────────────────────────────────────────────────────────
# Branch
# ──────────────────────────────────────────────────────────────

class BranchCreate(BaseModel):
    name: str
    environment: EnvironmentType = EnvironmentType.DEVELOPMENT
    odoo_version: str | None = None
    auto_deploy: bool = True
    run_tests: bool = True
    env_vars: dict[str, str] = {}


class BranchUpdate(BaseModel):
    environment: EnvironmentType | None = None
    auto_deploy: bool | None = None
    run_tests: bool | None = None
    env_vars: dict[str, str] | None = None

class BranchOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    environment: EnvironmentType
    container_id: str | None
    container_url: str | None
    container_status: str | None
    odoo_version: str | None
    is_active: bool
    auto_deploy: bool
    run_tests: bool
    is_neutralized: bool = False
    neutralized_at: datetime | None = None
    cloned_from_branch_id: uuid.UUID | None = None
    current_task: str | None = None
    current_task_status: str | None = None
    uptime_status: UptimeStatus = UptimeStatus.UNKNOWN
    uptime_last_checked_at: datetime | None = None
    uptime_response_ms: int | None = None
    last_commit_sha: str | None
    last_commit_message: str | None
    last_commit_author: str | None
    last_deployed_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ──────────────────────────────────────────────────────────────
# Build
# ──────────────────────────────────────────────────────────────

class BuildTrigger(BaseModel):
    """Manually trigger a build for a branch."""
    branch_id: uuid.UUID


class BuildOut(BaseModel):
    id: uuid.UUID
    branch_id: uuid.UUID
    commit_sha: str
    commit_message: str | None
    commit_author: str | None
    commit_author_avatar: str | None
    triggered_by: str
    status: BuildStatus
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: int | None
    test_passed: bool | None
    test_count: int | None
    error_message: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class BuildDetail(BuildOut):
    branch: BranchOut
    project_name: str | None = None


# ──────────────────────────────────────────────────────────────
# Webhook
# ──────────────────────────────────────────────────────────────

class GithubPushPayload(BaseModel):
    ref: str  # refs/heads/<branch>
    after: str  # commit SHA
    before: str  # prev SHA
    commits: list[dict[str, Any]] = []
    repository: dict[str, Any]
    pusher: dict[str, Any] = {}


# ──────────────────────────────────────────────────────────────
# Common
# ──────────────────────────────────────────────────────────────

class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int
    pages: int


class MessageResponse(BaseModel):
    message: str
    detail: str | None = None

class GlobalStats(BaseModel):
    active_builds: int
    deployments_today: int
    containers: int
    projects: int


class SetDomainRequest(BaseModel):
    domain: str


class DomainVerification(BaseModel):
    domain: str
    verified: bool
    cname_target: str  # e.g. "branch--project.localhost"
    message: str | None = None


class UptimeCheckOut(BaseModel):
    id: uuid.UUID
    branch_id: uuid.UUID
    status: UptimeStatus
    response_ms: int | None
    error: str | None
    checked_at: datetime

    model_config = {"from_attributes": True}


class TransferOwnershipRequest(BaseModel):
    new_owner_user_id: uuid.UUID


class CIFilesOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    files: dict  # {filename: content_string}
    updated_at: datetime

    model_config = {"from_attributes": True}


class CIFileUpdate(BaseModel):
    content: str
