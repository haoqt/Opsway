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
  CheckCircle2, AlertCircle, ChevronRight, Database, Database as DatabaseIcon
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
      <Topbar title={project.name} backHref="/projects">
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
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <OdooVersionBadge version={project.odoo_version} />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {project.branch_count} branches · Created {formatTimeAgo(project.created_at)}
                </span>
              </div>

              {/* Branches pipeline — 3 columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start h-full">
                <BranchColumn
                  title="Development"
                  description="Active features & sandboxes"
                  environment="development"
                  branches={devBranches}
                  projectId={id}
                  projectSlug={project.slug}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                />
                <BranchColumn
                  title="Staging"
                  description="Testing with production data"
                  environment="staging"
                  branches={stagingBranches}
                  projectId={id}
                  projectSlug={project.slug}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                />
                <BranchColumn
                  title="Production"
                  description="Live customer environments"
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
        "flex items-center gap-2 px-1 pb-4 text-xs font-semibold border-b-2 transition-all relative",
        active 
          ? "text-[hsl(var(--foreground))] border-[hsl(var(--primary))]" 
          : "text-[hsl(var(--muted-foreground))] border-transparent hover:text-[hsl(var(--foreground))]"
      )}
    >
      {icon}
      {label}
      {active && <span className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-[hsl(var(--primary))] glow-primary" />}
    </button>
  );
}

// ── Branch Column ──────────────────────────────────────────────

function BranchColumn({
  title, description, environment, branches, projectId, projectSlug, onRefresh,
}: {
  title: string;
  description: string;
  environment: "development" | "staging" | "production";
  branches: Branch[];
  projectId: string;
  projectSlug: string;
  onRefresh: () => void;
}) {
  const envThemes = {
    development: {
      border: "border-violet-500/20",
      bg: "bg-violet-500/5",
      accent: "bg-violet-500",
      text: "text-violet-400"
    },
    staging: {
      border: "border-amber-500/20",
      bg: "bg-amber-500/5",
      accent: "bg-amber-500",
      text: "text-amber-400"
    },
    production: {
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/5",
      accent: "bg-emerald-400",
      text: "text-emerald-400"
    },
  };

  const theme = envThemes[environment];

  return (
    <div className={cn(
      "flex flex-col h-full rounded-2xl border border-dashed transition-all duration-300",
      theme.border,
      theme.bg
    )}>
      {/* Column Header */}
      <div className="p-4 border-b border-dashed border-inherit">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 rounded-full", theme.accent)} />
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-white/5 text-[hsl(var(--muted-foreground))]">
            {branches.length}
          </span>
        </div>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">
          {description}
        </p>
      </div>

      {/* Column Body */}
      <div className="flex-1 p-3 space-y-3 overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-hide">
        {branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 opacity-40">
            <Layers size={24} className="mb-2 stroke-1" />
            <p className="text-[10px] font-medium">Empty Tier</p>
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
  const { mutate: promote, isPending: isPromoting } = useMutation({
    mutationFn: (targetEnv: string) => branchesApi.promote(projectId, branch.id, targetEnv),
    onSuccess: onRefresh,
    onError: (err: any) => alert(err.response?.data?.detail || "Promotion failed"),
  });

  const { mutate: deploy, isPending: isDeploying } = useMutation({
    mutationFn: () => branchesApi.deploy(projectId, branch.id),
    onSuccess: onRefresh,
  });

  const isRunning = branch.container_status === "running";
  
  return (
    <div className="group relative rounded-xl border border-[hsl(var(--border))] bg-[var(--gradient-card)] p-4 hover:border-[hsl(var(--primary)/0.4)] hover:shadow-xl hover:shadow-[hsl(var(--primary)/0.05)] transition-all duration-300">
      {/* Status Dot (Absolute) */}
      <div className="absolute top-4 right-4">
        {isRunning ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-medium text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity">Online</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_hsl(var(--success))]" />
          </div>
        ) : (
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
        )}
      </div>

      {/* Main Info */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GitBranch size={14} className="text-[hsl(var(--primary))]" />
            <span className="text-sm font-bold text-[hsl(var(--foreground))] truncate pr-12">
              {branch.name}
            </span>
          </div>
          
          {branch.last_commit_sha ? (
            <div className="flex items-start gap-2 text-[11px] text-[hsl(var(--muted-foreground))]">
              <GitCommit size={12} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="font-mono text-[hsl(var(--foreground))] mr-1.5">{shortSha(branch.last_commit_sha)}</span>
                <span className="truncate block italic">"{branch.last_commit_message}"</span>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] italic">No commits yet</p>
          )}
        </div>

        {/* Stats/Meta row */}
        <div className="flex items-center gap-4 py-1">
          <div className="flex flex-col">
            <span className="text-[9px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-bold">Odoo</span>
            <span className="text-[11px] font-medium">{branch.odoo_version || "17.0"}</span>
          </div>
          <div className="h-6 w-[1px] bg-[hsl(var(--border))]" />
          <div className="flex flex-col">
            <span className="text-[9px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider font-bold">Deployed</span>
            <span className="text-[11px] font-medium">{branch.last_deployed_at ? formatTimeAgo(branch.last_deployed_at) : "Never"}</span>
          </div>
        </div>

        {/* Actions - Primary Row */}
        <div className="flex items-center gap-2 pt-1">
          {isRunning && branch.container_url ? (
            <Button
              asChild
              variant="secondary"
              size="sm"
              className="h-8 flex-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 border-none text-[11px] font-bold"
            >
              <a href={branch.container_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={12} className="mr-1.5" />
                Live Preview
              </a>
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              className="h-8 flex-1 text-[11px] font-bold"
              loading={isDeploying}
              onClick={() => deploy()}
            >
              <Rocket size={12} className="mr-1.5" />
              Deploy Now
            </Button>
          )}

          <div className="flex items-center gap-1">
            <Link href={`/projects/${projectId}/branches/${branch.id}/terminal`}>
               <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Terminal">
                <Terminal size={13} />
               </Button>
            </Link>
            <Link href={`/projects/${projectId}/branches/${branch.id}/backups`}>
               <Button variant="outline" size="sm" className="h-8 w-8 p-0" title="Backups">
                <Database size={13} />
               </Button>
            </Link>
          </div>
        </div>

        {/* Quick Promotion */}
        <div className="grid grid-cols-2 gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
           {branch.environment === "development" && (
             <Button
               variant="ghost"
               size="sm"
               className="h-7 text-[10px] gap-1 text-[hsl(var(--muted-foreground))] hover:text-amber-400 hover:bg-amber-400/10"
               loading={isPromoting}
               onClick={() => promote("staging")}
             >
               <ChevronRight size={10} /> To Staging
             </Button>
           )}
           {(branch.environment === "development" || branch.environment === "staging") && (
             <Button
               variant="ghost"
               size="sm"
               className="h-7 text-[10px] gap-1 text-[hsl(var(--muted-foreground))] hover:text-emerald-400 hover:bg-emerald-400/10"
               loading={isPromoting}
               onClick={() => promote("production")}
             >
               <ChevronRight size={10} /> To Production
             </Button>
           )}
           {branch.environment === "staging" && (
             <Button
               variant="ghost"
               size="sm"
               className="h-7 text-[10px] gap-1 text-[hsl(var(--muted-foreground))] hover:text-violet-400 hover:bg-violet-400/10"
               loading={isPromoting}
               onClick={() => promote("development")}
             >
               <ChevronRight size={10} /> Back to Dev
             </Button>
           )}
        </div>
      </div>
      
      {/* Bottom Link */}
      <Link 
        href={`/projects/${projectId}/branches/${branch.id}/builds`}
        className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors border-t border-[hsl(var(--border))] pt-3"
      >
        <Layers size={10} />
        VIEW BUILD HISTORY
      </Link>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <Topbar title="Loading project..." />
      <div className="p-8 h-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-white/5 p-4 space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
