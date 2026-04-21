export type GitProvider = "github" | "gitlab" | "gitea";
export type EnvironmentType = "development" | "staging" | "production";
export type BuildStatus = "pending" | "building" | "success" | "failed" | "cancelled";
export type UserRole = "owner" | "developer" | "viewer";

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
}

export interface ProjectDetail extends Project {
  webhook_id: string | null;
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
}
