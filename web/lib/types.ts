export type GitProvider = "github" | "gitlab";
export type EnvironmentType = "development" | "staging" | "production";
export type BuildStatus = "pending" | "building" | "success" | "failed" | "cancelled";
export type UserRole = "owner" | "developer" | "viewer";
export type UptimeStatus = "up" | "down" | "unknown";

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
  user: {
    id: string;
    email: string;
    username: string;
    full_name: string | null;
    avatar_url: string | null;
  };
}

export interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  github_login: string | null;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  git_provider: GitProvider;
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  repo_url: string | null;
  odoo_version: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  branch_count: number;
  active_builds: number;
  build_limit_dev: number;
  build_limit_staging: number;
  build_limit_production: number;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  backup_schedule: string;
  backup_retention_daily: number;
  backup_retention_weekly: number;
  backup_retention_monthly: number;
  notification_email: string | null;
  notification_webhook_url: string | null;
  notification_slack_url: string | null;
  notification_telegram_bot_token: string | null;
  notification_telegram_chat_id: string | null;
  gitlab_url: string | null;
}

export interface ProjectDetail extends Project {
  webhook_id: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  deploy_key_public: string | null;
  branches: Branch[];
}

export interface Branch {
  id: string;
  project_id: string;
  name: string;
  environment: EnvironmentType;
  container_id: string | null;
  container_url: string | null;
  container_status: string | null;
  odoo_version: string | null;
  is_active: boolean;
  auto_deploy: boolean;
  run_tests: boolean;
  is_neutralized: boolean;
  neutralized_at: string | null;
  cloned_from_branch_id: string | null;
  current_task: string | null;
  current_task_status: string | null;
  uptime_status: UptimeStatus;
  uptime_last_checked_at: string | null;
  uptime_response_ms: number | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  last_commit_author: string | null;
  last_deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Build {
  id: string;
  branch_id: string;
  commit_sha: string;
  commit_message: string | null;
  commit_author: string | null;
  commit_author_avatar: string | null;
  triggered_by: string;
  status: BuildStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  test_passed: boolean | null;
  test_count: number | null;
  error_message: string | null;
  created_at: string;
}

export interface BuildDetail extends Build {
  branch: Branch;
  project_name?: string;
}

export interface GlobalStats {
  active_builds: number;
  deployments_today: number;
  containers: number;
  projects: number;
}

export interface DomainVerification {
  domain: string;
  verified: boolean;
  cname_target: string;
  message: string | null;
}

export interface UptimeCheck {
  id: string;
  branch_id: string;
  status: UptimeStatus;
  response_ms: number | null;
  error: string | null;
  checked_at: string;
}

export const CI_FILENAMES = [
  ".opsway.yml",
  "docker-compose.yml",
  "odoo.conf.template",
  ".flake8",
  ".pre-commit-config.yml",
  ".pylintrc",
  ".pylintrc-mandatory",
] as const;

export type CIFilename = typeof CI_FILENAMES[number];

export interface CIFiles {
  id: string;
  project_id: string;
  files: Record<string, string>;
  updated_at: string;
}
