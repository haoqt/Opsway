"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import { Button, Input, Select } from "@/components/ui/primitives";
import { X, FolderGit2 } from "lucide-react";

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function GitlabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function NewProjectModal({ onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    repo_full_name: "",
    odoo_version: "17",
    description: "",
    git_provider: "github",
    gitlab_token: "",
    gitlab_url: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = {
        name: form.name,
        repo_full_name: form.repo_full_name,
        odoo_version: form.odoo_version,
        git_provider: form.git_provider,
      };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.git_provider === "gitlab") {
        if (form.gitlab_token.trim()) payload.gitlab_token = form.gitlab_token.trim();
        if (form.gitlab_url.trim()) payload.gitlab_url = form.gitlab_url.trim();
      }
      return projectsApi.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onCreated();
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      setErrors({ general: typeof detail === "string" ? detail : "Failed to create project" });
    },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // When user pastes a full GitLab URL, auto-extract base URL and repo path
  const handleRepoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (form.git_provider === "gitlab" && (val.startsWith("http://") || val.startsWith("https://"))) {
      try {
        const url = new URL(val);
        const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "");
        if (path.includes("/")) {
          setForm((f) => ({
            ...f,
            repo_full_name: path,
            gitlab_url: url.origin,
          }));
          return;
        }
      } catch {}
    }
    setForm((f) => ({ ...f, repo_full_name: val }));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Project name is required";
    if (!form.repo_full_name.trim()) errs.repo_full_name = "Repository is required";
    else if (!form.repo_full_name.includes("/")) errs.repo_full_name = "Must include at least owner/repo";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) mutate();
  };

  const providers = [
    { value: "github", label: "GitHub", icon: <GithubIcon size={13} /> },
    { value: "gitlab", label: "GitLab", icon: <GitlabIcon size={13} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
              <FolderGit2 size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">New Project</h2>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Connect a Git repository</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <Input
            label="Project Name"
            placeholder="My Odoo Project"
            value={form.name}
            onChange={set("name")}
            error={errors.name}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Git Provider</label>
            <div className="grid grid-cols-2 gap-2">
              {providers.map(({ value, label, icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, git_provider: value, gitlab_token: "", gitlab_url: "" }))}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-all ${
                    form.git_provider === value
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--muted-foreground))]"
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Repository"
            placeholder={form.git_provider === "gitlab" ? "group/subgroup/repo or paste full URL" : "owner/repository-name"}
            value={form.repo_full_name}
            onChange={handleRepoChange}
            error={errors.repo_full_name}
            hint={form.git_provider === "gitlab"
              ? "Paste full URL to auto-fill (e.g. https://gitlab.company.com/group/project)"
              : "Format: owner/repo (e.g. mycompany/odoo-custom)"}
          />

          {form.git_provider === "gitlab" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  GitLab URL <span className="text-[10px] font-normal opacity-60">(leave blank for gitlab.com)</span>
                </label>
                <input
                  type="url"
                  placeholder="https://gitlab.mycompany.com"
                  className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  value={form.gitlab_url}
                  onChange={set("gitlab_url")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                  GitLab API Token <span className="text-[10px] font-normal opacity-60">(for webhook auto-registration)</span>
                </label>
                <input
                  type="password"
                  placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
                  className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  value={form.gitlab_token}
                  onChange={set("gitlab_token")}
                />
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  Requires <code className="text-xs">api</code> scope. Optional — webhook can be added manually.
                </p>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Odoo Version</label>
            <Select value={form.odoo_version} onChange={set("odoo_version")} className="w-full">
              <option value="16">Odoo 16.0</option>
              <option value="17">Odoo 17.0</option>
              <option value="18">Odoo 18.0</option>
            </Select>
          </div>

          <Input
            label="Description (optional)"
            placeholder="Brief project description"
            value={form.description}
            onChange={set("description")}
          />

          {errors.general && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {errors.general}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" className="flex-1" type="submit" loading={isPending}>
              Create Project
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
