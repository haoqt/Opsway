import axios from "axios";

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
  register: (data: { email: string; username: string; password: string; full_name?: string }) =>
    api.post("/auth/register", data),
  me: () => api.get("/auth/me"),
  githubUrl: () => `${API_URL}/api/auth/github`,
};

export const projectsApi = {
  list: () => api.get("/projects"),
  get: (id: string) => api.get(`/projects/${id}`),
  create: (data: {
    name: string;
    repo_full_name: string;
    git_provider?: string;
    odoo_version?: string;
    description?: string;
  }) => api.post("/projects", data),
  update: (id: string, data: object) => api.patch(`/projects/${id}`, data),
  delete: (id: string) => api.delete(`/projects/${id}`),
  testConnection: (id: string) => api.post(`/projects/${id}/test-connection`),
  sync: (id: string) => api.post(`/projects/${id}/sync`),
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
};

export const buildsApi = {
  listAll: (params?: { skip?: number; limit?: number }) => api.get("/builds", { params }),
  get: (buildId: string) => api.get(`/builds/${buildId}`),
  cancel: (buildId: string) => api.post(`/builds/${buildId}/cancel`),
  retry: (buildId: string) => api.post(`/builds/${buildId}/retry`),
  logsUrl: (buildId: string) => `${API_URL}/api/builds/${buildId}/logs`,
};

export const monitoringApi = {
  getStats: () => api.get("/monitoring/stats"),
};

export const statsApi = {
  get: () => api.get("/stats").then((r) => r.data as GlobalStats),
};
