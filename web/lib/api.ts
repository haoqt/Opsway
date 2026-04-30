import axios from "axios";
import { GlobalStats, DomainVerification } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("opsway_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("opsway_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── API helpers ────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ access_token: string }>("/auth/token", { email, password }),
  me: () => api.get("/auth/me"),
  listUsers: () => api.get("/auth/users"),
  createUser: (data: { email: string; username: string; password: string; full_name?: string; is_superuser?: boolean }) =>
    api.post("/auth/admin/create-user", data),
  deleteUser: (userId: string) => api.delete(`/auth/admin/users/${userId}`),
};

export const projectsApi = {
  list: () => api.get("/projects"),
  get: (id: string) => api.get(`/projects/${id}`),
  create: (data: {
    name: string;
    repo_full_name: string;
    project_type?: string;
    git_provider?: string;
    odoo_version?: string;
    postgres_version?: string;
    odoo_workers?: number;
    description?: string;
    gitlab_token?: string;
    gitlab_url?: string;
  }) => api.post("/projects", data),
  update: (id: string, data: object) => api.patch(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  testConnection: (id: string) => api.post(`/projects/${id}/test-connection`),
  sync: (id: string) => api.post(`/projects/${id}/sync`),
};

export const membersApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/members`),
  add: (projectId: string, data: { user_id: string; role: string }) =>
    api.post(`/projects/${projectId}/members`, data),
  updateRole: (projectId: string, memberId: string, role: string) =>
    api.patch(`/projects/${projectId}/members/${memberId}`, { role }),
  remove: (projectId: string, memberId: string) =>
    api.delete(`/projects/${projectId}/members/${memberId}`),
  transferOwnership: (projectId: string, newOwnerUserId: string) =>
    api.post(`/projects/${projectId}/members/transfer-ownership`, { new_owner_user_id: newOwnerUserId }),
};

export const uptimeApi = {
  getProjectUptime: (projectId: string) => api.get(`/uptime/projects/${projectId}`),
  getBranchHistory: (branchId: string) => api.get(`/uptime/branches/${branchId}/history`),
};

export const ciConfigApi = {
  getAll: (projectId: string) => api.get(`/projects/${projectId}/ci-config`),
  saveFile: (projectId: string, filename: string, content: string) =>
    api.put(`/projects/${projectId}/ci-config/files/${encodeURIComponent(filename)}`, { content }),
  resetFile: (projectId: string, filename: string) =>
    api.delete(`/projects/${projectId}/ci-config/files/${encodeURIComponent(filename)}`),
  downloadFile: (projectId: string, filename: string) =>
    api.get(`/projects/${projectId}/ci-config/files/${encodeURIComponent(filename)}`, {
      responseType: "text",
    }),
};

export const branchesApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/branches`),
  get: (projectId: string, branchId: string) =>
    api.get(`/projects/${projectId}/branches/${branchId}`),
  create: (projectId: string, data: object) =>
    api.post(`/projects/${projectId}/branches`, data),
  update: (projectId: string, branchId: string, data: object) =>
    api.patch(`/projects/${projectId}/branches/${branchId}`, data),
  delete: (projectId: string, branchId: string) =>
    api.delete(`/projects/${projectId}/branches/${branchId}`),
  deploy: (projectId: string, branchId: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/deploy`),
  promote: (projectId: string, branchId: string, targetEnv: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/switch-environment?target_env=${targetEnv}`),
  listBuilds: (projectId: string, branchId: string) =>
    api.get(`/projects/${projectId}/branches/${branchId}/builds`),
  listBackups: (projectId: string, branchId: string) =>
    api.get(`/projects/${projectId}/branches/${branchId}/backups`),
  createBackup: (projectId: string, branchId: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/backups`),
  getBackupDownloadUrl: (projectId: string, branchId: string, backupId: string) =>
    api.get(`/projects/${projectId}/branches/${branchId}/backups/${backupId}/download`),
  restoreBackup: (projectId: string, branchId: string, backupId: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/backups/${backupId}/restore`),
  restoreUpload: (projectId: string, branchId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post(`/projects/${projectId}/branches/${branchId}/backups/restore-upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  cloneFrom: (projectId: string, branchId: string, sourceBranchId: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/clone-from/${sourceBranchId}`),
  neutralize: (projectId: string, branchId: string) =>
    api.post(`/projects/${projectId}/branches/${branchId}/neutralize`),
};

export const buildsApi = {
  listAll: (params?: { skip?: number; limit?: number }) => api.get("/builds", { params }),
  get: (buildId: string) => api.get(`/builds/${buildId}`),
  cancel: (buildId: string) => api.post(`/builds/${buildId}/cancel`),
  retry: (buildId: string) => api.post(`/builds/${buildId}/retry`),
  logsUrl: (buildId: string) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("opsway_token") : "";
    return `${API_URL}/api/builds/${buildId}/logs${token ? `?token=${token}` : ""}`;
  },
};

export const monitoringApi = {
  getStats: () => api.get("/monitoring/stats"),
  getBranchMetrics: (projectId: string, branchId: string) =>
    api.get(`/monitoring/projects/${projectId}/branches/${branchId}/metrics`),
};

export const statsApi = {
  get: () => api.get("/stats").then((r) => r.data as GlobalStats),
};

export const domainsApi = {
  set: (projectId: string, domain: string) =>
    api.post(`/projects/${projectId}/domain`, { domain }),
  verify: (projectId: string) =>
    api.post<DomainVerification>(`/projects/${projectId}/domain/verify`),
  remove: (projectId: string) =>
    api.delete(`/projects/${projectId}/domain`),
  get: (projectId: string) =>
    api.get<DomainVerification>(`/projects/${projectId}/domain`),
};
