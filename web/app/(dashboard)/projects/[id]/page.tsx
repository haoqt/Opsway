"use client";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { projectsApi, branchesApi } from "@/lib/api";
import { ProjectDetail, Branch } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, EnvironmentBadge, OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import {
  GitBranch, ExternalLink, Rocket, RefreshCw,
  GitCommit, Terminal, Layers, Play, Copy,
  CheckCircle2, AlertCircle, ChevronRight
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<"pipeline" | "history" | "settings">("pipeline");

  const { data: project, isLoading, refetch } = useQuery({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id).then((r) => r.data as ProjectDetail),
    refetchInterval: 10_000,
  });

  const { mutate: testConnection, isPending: isTesting } = useMutation({
    mutationFn: () => projectsApi.testConnection(id),
    onSuccess: (res) => {
      alert(res.data.message);
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || "Connection test failed");
    },
  });

  const { mutate: syncRepo, isPending: isSyncing } = useMutation({
    mutationFn: () => projectsApi.sync(id),
    onSuccess: () => {
      alert("Repository synchronization started!");
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || "Sync failed");
    },
  });

  if (isLoading) return <LoadingSkeleton />;
  if (!project) return <div className="p-6 text-sm text-red-400">Project not found</div>;

  const devBranches = project.branches?.filter((b) => b.environment === "development") ?? [];
  const stagingBranches = project.branches?.filter((b) => b.environment === "staging") ?? [];
  const prodBranches = project.branches?.filter((b) => b.environment === "production") ?? [];

  return (
    <>
      <Topbar title={project.name}>
        <div className="flex items-center gap-4">
          <a
            href={`https://github.com/${project.repo_full_name}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ExternalLink size={12} /> {project.repo_full_name}
          </a>
        </div>
      </Topbar>

      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Tabs Navigation */}
        <div className="px-6 pt-6 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-6">
            <TabButton 
              active={activeTab === "pipeline"} 
              onClick={() => setActiveTab("pipeline")}
              icon={<Layers size={14} />}
              label="Pipeline"
            />
            <TabButton 
              active={activeTab === "history"} 
              onClick={() => setActiveTab("history")}
              icon={<RefreshCw size={14} />}
              label="History"
            />
            <TabButton 
              active={activeTab === "settings"} 
              onClick={() => setActiveTab("settings")}
              icon={<Play size={14} />}
              label="Settings"
            />
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {activeTab === "pipeline" && (
            <>
              {/* Project info */}
              <div className="flex items-center gap-3 flex-wrap">
                <OdooVersionBadge version={project.odoo_version} />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {project.branch_count} branches · Created {formatTimeAgo(project.created_at)}
                </span>
              </div>

              {/* Branches pipeline — 3 columns */}
              <div className="grid grid-cols-3 gap-4 items-start">
                <BranchColumn
                  title="Development"
                  environment="development"
                  branches={devBranches}
                  projectId={id}
                  projectSlug={project.slug}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                />
                <BranchColumn
                  title="Staging"
                  environment="staging"
                  branches={stagingBranches}
                  projectId={id}
                  projectSlug={project.slug}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                />
                <BranchColumn
                  title="Production"
                  environment="production"
                  branches={prodBranches}
                  projectId={id}
                  projectSlug={project.slug}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                />
              </div>
            </>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-4">Branch Activity & History</h3>
              {project.branches?.length === 0 ? (
                <EmptyState title="No activity yet" description="History will appear here once branches are created." />
              ) : (
                <div className="space-y-3">
                  {project.branches?.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).map(branch => (
                    <Card key={branch.id} className="p-4 flex items-center justify-between gap-4 group">
                      <div className="flex items-center gap-4">
                        <div className="h-8 w-8 rounded-full bg-[hsl(var(--primary)/0.1)] flex items-center justify-center text-[hsl(var(--primary))]">
                          <GitBranch size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{branch.name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <EnvironmentBadge env={branch.environment} />
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                              Updated {formatTimeAgo(branch.updated_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                         {branch.last_commit_sha && (
                          <div className="hidden md:flex flex-col items-end">
                            <p className="text-[11px] font-mono text-[hsl(var(--muted-foreground))]">{shortSha(branch.last_commit_sha)}</p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate max-w-[200px]">{branch.last_commit_message}</p>
                          </div>
                        )}
                        <Link href={`/projects/${id}/branches/${branch.id}/builds`}>
                          <Button variant="outline" size="sm" className="h-8 text-xs">View History</Button>
                        </Link>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "settings" && (
            <div className="max-w-4xl space-y-6">
              {/* Git Integration & Manual Webhook */}
              <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
                    <RefreshCw size={12} className={isTesting ? "animate-spin" : ""} />
                    Git Integration & Webhooks
                  </h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => syncRepo()}
                      loading={isSyncing}
                    >
                      <RefreshCw size={10} className={isSyncing ? "animate-spin" : ""} />
                      Sync Repository
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => testConnection()}
                      loading={isTesting}
                    >
                      Test Connection
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Webhook Info */}
                  <div className="space-y-3 rounded-lg bg-[hsl(var(--secondary)/0.5)] p-3 border border-[hsl(var(--border))]">
                    <div>
                      <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-tight mb-1">Payload URL</p>
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono bg-black/20 px-1.5 py-0.5 rounded flex-1 truncate">
                          {project.webhook_url}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigator.clipboard.writeText(project.webhook_url || "")}>
                          <Copy size={10} />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-tight mb-1">Secret</p>
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] font-mono bg-black/20 px-1.5 py-0.5 rounded flex-1 truncate">
                          {project.webhook_secret}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigator.clipboard.writeText(project.webhook_secret || "")}>
                          <Copy size={10} />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Deploy Key */}
                  {project.deploy_key_public && (
                    <div className="space-y-2 rounded-lg bg-[hsl(var(--secondary)/0.5)] p-3 border border-[hsl(var(--border))]">
                      <p className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Public Deploy Key (SSH)</p>
                      <div className="flex items-start gap-2">
                        <code className="text-[10px] font-mono bg-black/20 p-2 rounded flex-1 break-all line-clamp-3 overflow-hidden">
                          {project.deploy_key_public}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => navigator.clipboard.writeText(project.deploy_key_public || "")}>
                          <Copy size={10} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-[hsl(var(--border))] space-y-4">
                  <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Build Limits (Automated Cleanup)</h4>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase">Development</label>
                      <input
                        type="number"
                        defaultValue={project.build_limit_dev}
                        className="w-full mt-1 bg-black/20 border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) projectsApi.update(id, { build_limit_dev: val }).then(() => qc.invalidateQueries({ queryKey: ["project", id] }));
                        }}
                      />
                      <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-1">Oldest builds auto-deleted.</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase">Staging</label>
                      <input
                        type="number"
                        defaultValue={project.build_limit_staging}
                        className="w-full mt-1 bg-black/20 border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) projectsApi.update(id, { build_limit_staging: val }).then(() => qc.invalidateQueries({ queryKey: ["project", id] }));
                        }}
                      />
                      <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-1">Manual cleanup required.</p>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase">Production</label>
                      <input
                        type="number"
                        defaultValue={project.build_limit_production}
                        className="w-full mt-1 bg-black/20 border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
                        onBlur={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) projectsApi.update(id, { build_limit_production: val }).then(() => qc.invalidateQueries({ queryKey: ["project", id] }));
                        }}
                      />
                      <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-1">Manual cleanup required.</p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-1 pb-4 text-xs font-semibold border-b-2 transition-all",
        active 
          ? "text-[hsl(var(--primary))] border-[hsl(var(--primary))]" 
          : "text-[hsl(var(--muted-foreground))] border-transparent hover:text-[hsl(var(--foreground))]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Branch Column ──────────────────────────────────────────────

function BranchColumn({
  title, environment, branches, projectId, projectSlug, onRefresh,
}: {
  title: string;
  environment: "development" | "staging" | "production";
  branches: Branch[];
  projectId: string;
  projectSlug: string;
  onRefresh: () => void;
}) {
  const envColors = {
    development: "border-violet-500/30 bg-violet-500/5",
    staging:     "border-amber-500/30 bg-amber-500/5",
    production:  "border-emerald-500/30 bg-emerald-500/5",
  };

  return (
    <div className={`rounded-xl border-2 border-dashed p-4 space-y-3 ${envColors[environment]}`}>
      <div className="flex items-center gap-2">
        <EnvironmentBadge env={environment} />
        <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{branches.length}</span>
      </div>

      {branches.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[hsl(var(--border))] py-8 text-center">
          <GitBranch size={14} className="mx-auto text-[hsl(var(--muted-foreground))] mb-1.5" />
          <p className="text-xs text-[hsl(var(--muted-foreground))]">No {title} branches</p>
        </div>
      ) : (
        branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            projectId={projectId}
            projectSlug={projectSlug}
            onRefresh={onRefresh}
          />
        ))
      )}
    </div>
  );
}

// ── Branch Card ────────────────────────────────────────────────

function BranchCard({
  branch, projectId, projectSlug, onRefresh,
}: {
  branch: Branch;
  projectId: string;
  projectSlug: string;
  onRefresh: () => void;
}) {
  const qc = useQueryClient();

  const { mutate: deploy, isPending } = useMutation({
    mutationFn: () => branchesApi.deploy(projectId, branch.id),
    onSuccess: onRefresh,
  });

  const { mutate: promote, isPending: isPromoting } = useMutation({
    mutationFn: (targetEnv: string) => branchesApi.promote(projectId, branch.id, targetEnv),
    onSuccess: () => {
      onRefresh();
      // Optionally show a toast/alert
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || "Promotion failed");
    },
  });

  const isRunning = branch.container_status === "running";
  const subdomain = `${branch.name.replace(/\//g, "-").replace(/_/g, "-")}--${projectSlug}`;
  const instanceUrl = `http://${subdomain}.localhost`;

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 group hover:border-[hsl(var(--primary)/0.3)] transition-all">
      {/* Branch name + status */}
      <div className="flex items-start gap-2">
        <GitBranch size={12} className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-[hsl(var(--foreground))]">{branch.name}</span>
            {isRunning ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
            ) : (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" />
            )}
          </div>
          {branch.last_commit_sha && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))]">
              <GitCommit size={9} />
              <span className="font-mono">{shortSha(branch.last_commit_sha)}</span>
              <span className="truncate">{branch.last_commit_message?.slice(0, 30)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Instance URL */}
      {isRunning && branch.container_url && (
        <a
          href={branch.container_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink size={9} />
          Open Instance
        </a>
      )}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1.5 border-t border-[hsl(var(--border))] pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] flex-1"
          loading={isPending}
          onClick={() => deploy()}
        >
          <Rocket size={9} /> Deploy
        </Button>

        <Link href={`/projects/${projectId}/branches/${branch.id}/builds`}>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]">
            <Layers size={9} /> Builds
          </Button>
        </Link>

        {isRunning && (
          <Link href={`/projects/${projectId}/branches/${branch.id}/terminal`}>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]">
              <Terminal size={9} className="mr-1" /> Terminal
            </Button>
          </Link>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {["development", "staging", "production"].filter(env => env !== branch.environment).map(env => (
            <Button
              key={env}
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary)/0.1)] transition-all"
              loading={isPromoting}
              onClick={() => {
                const action = (env === "production" || (env === "staging" && branch.environment === "development")) ? "Promote" : "Demote";
                if (confirm(`${action} ${branch.name} to ${env}?`)) {
                  promote(env);
                }
              }}
            >
              <ChevronRight size={9} className="mr-0.5" /> {env === "development" ? "Dev" : env === "staging" ? "Staging" : "Prod"}
            </Button>
          ))}
        </div>
      </div>

      {branch.last_deployed_at && (
        <p className="mt-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
          Deployed {formatTimeAgo(branch.last_deployed_at)}
        </p>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <Topbar title="Loading..." />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-60 rounded-xl skeleton" />
          ))}
        </div>
      </div>
    </>
  );
}
