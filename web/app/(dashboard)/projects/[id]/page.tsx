"use client";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
} from "@dnd-kit/core";
import { projectsApi, branchesApi, monitoringApi, membersApi, authApi, ciConfigApi } from "@/lib/api";
import { DeleteProjectSettings } from "@/components/projects/delete-project-settings";
import { PipelineSettings } from "@/components/projects/pipeline-settings";
import { ProjectDetail, Branch, ProjectMember } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import {
  GitBranch, ExternalLink, Rocket, RefreshCw,
  GitCommit, Terminal, Layers, Play, Copy,
  CheckCircle2, AlertCircle, ChevronRight, Database, Database as DatabaseIcon,
  Globe, Shield, ShieldCheck, Mail, Download, Trash2, Link2, Loader2, Users, UserPlus, Crown, Activity,
  KeyRound, Plus, X, Server, Wrench, Bell
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<"pipeline" | "history" | "team" | "settings">("pipeline");

  const { data: project, isLoading, refetch } = useQuery({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id).then((r) => r.data as ProjectDetail),
    refetchInterval: 10_000,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: ["members", id],
    queryFn: () => membersApi.list(id).then((r) => r.data),
    enabled: !!project,
    staleTime: 30_000,
  });

  // Derive current user's role in this project
  const currentMember = members.find((m) => m.user_id === me?.id);
  const isOwner = currentMember?.role === "owner" || !!me?.is_superuser;

  // Drop back to pipeline if user lost owner access while on settings tab
  React.useEffect(() => {
    if (!isOwner && activeTab === "settings") setActiveTab("pipeline");
  }, [isOwner, activeTab]);

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

  const branches = project.branches ?? [];

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
              active={activeTab === "team"}
              onClick={() => setActiveTab("team")}
              icon={<Users size={14} />}
              label="Team"
            />
            {isOwner && (
              <TabButton
                active={activeTab === "settings"}
                onClick={() => setActiveTab("settings")}
                icon={<Play size={14} />}
                label="Settings"
              />
            )}
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {activeTab === "pipeline" && (
            <>
              {/* Project info */}
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      <Server size={10} /> Odoo Project
                    </span>
                    <OdooVersionBadge version={project.odoo_version} />
                  </>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {project.branch_count} branches · Created {formatTimeAgo(project.created_at)}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                {branches.length === 0 ? (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center border border-dashed border-zinc-700/50 rounded-2xl bg-black/5">
                    <GitBranch size={40} className="text-zinc-600 mb-4" />
                    <p className="text-zinc-400 text-sm">No branches found. Push code to your repository to see them here.</p>
                  </div>
                ) : (
                  branches.map((branch) => (
                    <BranchCard
                      key={branch.id}
                      branch={branch}
                      projectSlug={project.slug}
                      projectId={id}
                      allBranches={project.branches ?? []}
                      onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                    />
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-4">Branch Activity & History</h3>
              {project.branches?.length === 0 ? (
                <EmptyState icon={GitCommit} title="No activity yet" description="History will appear here once branches are created." />
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

          {activeTab === "team" && (
            <TeamTab projectId={id} />
          )}

          {activeTab === "settings" && isOwner && (
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
                        <code className="text-[11px] font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded flex-1 truncate">
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
                        <code className="text-[11px] font-mono bg-[hsl(var(--secondary))] px-1.5 py-0.5 rounded flex-1 truncate">
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
                        <code className="text-[10px] font-mono bg-[hsl(var(--secondary))] p-2 rounded flex-1 break-all line-clamp-3 overflow-hidden">
                          {project.deploy_key_public}
                        </code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => navigator.clipboard.writeText(project.deploy_key_public || "")}>
                          <Copy size={10} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* GitLab token update */}
                {project.git_provider === "gitlab" && (
                  <GitLabTokenSettings project={project} projectId={id} />
                )}

                <div className="pt-4 mt-4 border-t border-[hsl(var(--border))] space-y-4">
                  <h4 className="text-xs font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Build Limits (Automated Cleanup)</h4>
                  <div className="grid grid-cols-3 gap-6">
                    <div>
                      <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] uppercase">Development</label>
                      <input
                        type="number"
                        defaultValue={project.build_limit_dev}
                        className="w-full mt-1 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
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
                        className="w-full mt-1 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
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
                        className="w-full mt-1 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1 text-xs"
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

              {/* Notifications */}
              <NotificationSettings project={project} projectId={id} />

              {/* Project Config: Pipeline Settings */}
              <PipelineSettings project={project} />

              {/* Transfer Ownership */}
              <TransferOwnershipSettings projectId={id} members={members} currentUserId={me?.id} />

              {/* Delete Project */}
              <DeleteProjectSettings projectId={id} projectName={project.name} />
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

// ── Components ────────────────────────────────────────────────



// ── Branch Card ────────────────────────────────────────────────

function BranchCard({
  branch, projectId, projectSlug, allBranches, onRefresh,
}: {
  branch: Branch;
  projectId: string;
  projectSlug: string;
  allBranches: Branch[];
  onRefresh: () => void;
}) {
  const [showCloneMenu, setShowCloneMenu] = React.useState(false);
  const [cloneSourceId, setCloneSourceId] = React.useState("");



  // Resource metrics polling (only when running)
  const { data: metrics } = useQuery({
    queryKey: ["branch-metrics", branch.id],
    queryFn: () => monitoringApi.getBranchMetrics(projectId, branch.id).then(r => r.data),
    refetchInterval: 15_000,
    enabled: branch.container_status === "running",
  });

  const { mutate: deploy, isPending: isDeploying } = useMutation({
    mutationFn: () => branchesApi.deploy(projectId, branch.id),
    onSuccess: onRefresh,
  });

  const isRunning = branch.container_status === "running";
  const isBusy = branch.current_task_status === "running" || branch.current_task_status === "pending";
  const isFailed = branch.current_task_status === "failed";
  
  return (
    <div
      className={cn(
        "group relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden hover:border-[hsl(var(--primary)/0.4)] hover:shadow-xl hover:shadow-[hsl(var(--primary)/0.05)] transition-all duration-300"
      )}
    >
      <div className="p-4">
        {/* Status Dot (Absolute) */}
        <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
          {isBusy ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Loader2 size={10} className="animate-spin text-blue-400" />
              <span className="text-[9px] font-bold text-blue-400 uppercase tracking-tighter">{branch.current_task}</span>
            </div>
          ) : isFailed ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20" title="Task failed">
              <AlertCircle size={10} className="text-red-400" />
              <span className="text-[9px] font-bold text-red-400 uppercase tracking-tighter">Failed</span>
            </div>
          ) : isRunning ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-tighter">Running</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-500/10 border border-zinc-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter">Offline</span>
            </div>
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
            {/* Resource metrics */}
            {metrics && branch.container_status === "running" && (
              <>
                <div className="h-6 w-[1px] bg-[hsl(var(--border))]" />
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-[hsl(var(--muted-foreground))] uppercase font-bold">CPU</span>
                    <span className="text-[9px] font-mono">{metrics.cpu}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-[hsl(var(--border))] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(metrics.cpu, 100)}%`,
                        background: metrics.cpu > 80 ? "hsl(0 72% 51%)" : metrics.cpu > 50 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)"
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[8px] text-[hsl(var(--muted-foreground))] uppercase font-bold">RAM</span>
                    <span className="text-[9px] font-mono">{metrics.memory}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-[hsl(var(--border))] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(metrics.memory, 100)}%`,
                        background: metrics.memory > 85 ? "hsl(0 72% 51%)" : metrics.memory > 60 ? "hsl(38 92% 50%)" : "hsl(217 91% 60%)"
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Actions - Primary Row */}
          <div className="flex items-center gap-2 pt-1">
            {isRunning && branch.container_url ? (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className={cn("h-8 flex-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 border-none text-[11px] font-bold", isBusy && "opacity-50 pointer-events-none")}
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
                loading={isDeploying || isBusy}
                disabled={isBusy}
                onClick={() => deploy()}
              >
                <Rocket size={12} className="mr-1.5" />
                Deploy Now
              </Button>
            )}

            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={isBusy}
                className={cn("h-8 px-2 flex items-center gap-1.5 transition-colors", showCloneMenu && "bg-blue-500/10 border-blue-500/30 text-blue-400")} 
                title="Clone From"
                onClick={() => setShowCloneMenu(!showCloneMenu)}
              >
                <Copy size={13} />
              </Button>
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

          {/* Clone Menu */}
          {showCloneMenu && (
            <div className="mt-2 p-2 rounded bg-secondary/50 border border-[hsl(var(--border))] space-y-2 animate-in fade-in slide-in-from-top-2">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Select a source branch to clone data into <strong>{branch.name}</strong>. This will overwrite existing data.</p>
              <div className="flex gap-2">
                <select
                  className="flex-1 bg-background border border-[hsl(var(--border))] rounded px-2 py-1 text-[11px] text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
                  value={cloneSourceId}
                  onChange={(e) => setCloneSourceId(e.target.value)}
                >
                  <option value="" disabled>Select source branch...</option>
                  {allBranches.filter(b => b.id !== branch.id).map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="h-7 text-[10px] px-3 bg-blue-500 hover:bg-blue-600 text-white"
                  disabled={!cloneSourceId}
                  onClick={() => {
                    if (confirm(`Are you sure you want to OVERWRITE ${branch.name} with data from the selected branch?`)) {
                      branchesApi.cloneFrom(projectId, branch.id, cloneSourceId)
                        .then(() => {
                          setShowCloneMenu(false);
                          onRefresh();
                          alert("Clone task has been queued.");
                        })
                        .catch((err: any) => alert(err.response?.data?.detail || "Cloning failed"));
                    }
                  }}
                >
                  Clone
                </Button>
              </div>
            </div>
          )}



          {/* Neutralization badge */}
          {branch.is_neutralized && (
            <div className="flex items-center gap-1.5 mt-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
              <ShieldCheck size={11} className="text-amber-600 dark:text-amber-400" />
              <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Neutralized</span>
              {branch.neutralized_at && (
                <span className="text-[9px] text-[hsl(var(--muted-foreground))] ml-auto">{formatTimeAgo(branch.neutralized_at)}</span>
              )}
            </div>
          )}

          {/* Bottom Link */}
          <Link 
            href={`/projects/${projectId}/branches/${branch.id}/builds`}
            className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-black text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors border-t border-[hsl(var(--border))] pt-3"
          >
            <Layers size={10} />
            VIEW BUILD HISTORY
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Team Tab ───────────────────────────────────────────────────

const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  owner:     { label: "Owner",     color: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  developer: { label: "Developer", color: "text-violet-400 bg-violet-500/10 border-violet-500/20" },
  viewer:    { label: "Viewer",    color: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
};

function TeamTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = React.useState(false);
  const [addUserId, setAddUserId] = React.useState("");
  const [addRole, setAddRole] = React.useState("developer");
  const [addError, setAddError] = React.useState("");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me().then((r) => r.data),
  });

  const { data: members = [], isLoading } = useQuery<ProjectMember[]>({
    queryKey: ["members", projectId],
    queryFn: () => membersApi.list(projectId).then((r) => r.data),
  });

  const { data: allUsers = [] } = useQuery<{ id: string; username: string; email: string }[]>({
    queryKey: ["users"],
    queryFn: () => authApi.listUsers().then((r) => r.data),
    enabled: showAdd,
  });

  const currentMember = members.find((m) => m.user_id === me?.id);
  const isOwner = currentMember?.role === "owner" || me?.is_superuser;

  const availableUsers = allUsers.filter(
    (u) => !members.some((m) => m.user_id === u.id)
  );

  const { mutate: addMember, isPending: isAdding } = useMutation({
    mutationFn: () => membersApi.add(projectId, { user_id: addUserId, role: addRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", projectId] });
      setShowAdd(false);
      setAddUserId("");
      setAddRole("developer");
      setAddError("");
    },
    onError: (err: any) => setAddError(err.response?.data?.detail || "Failed to add member"),
  });

  const { mutate: updateRole } = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      membersApi.updateRole(projectId, memberId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
    onError: (err: any) => alert(err.response?.data?.detail || "Failed to update role"),
  });

  const { mutate: removeMember } = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(projectId, memberId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
    onError: (err: any) => alert(err.response?.data?.detail || "Failed to remove member"),
  });

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[hsl(var(--foreground))]">Project Team</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {members.length} member{members.length !== 1 ? "s" : ""} · Permissions apply to all branches and data
          </p>
        </div>
        {isOwner && (
          <Button
            variant="primary"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => { setShowAdd(!showAdd); setAddError(""); }}
          >
            <UserPlus size={13} /> Add Member
          </Button>
        )}
      </div>

      {/* Role legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(ROLE_LABELS).map(([key, { label, color }]) => (
          <div key={key} className={cn("flex items-center gap-1.5 text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border", color)}>
            {key === "owner" && <Crown size={9} />}
            {key === "developer" && <Shield size={9} />}
            {label}
            <span className="font-normal text-[hsl(var(--muted-foreground))] ml-0.5">
              {key === "owner" && "· full access"}
              {key === "developer" && "· deploy & backup"}
              {key === "viewer" && "· read-only"}
            </span>
          </div>
        ))}
      </div>

      {/* Add member form */}
      {showAdd && isOwner && (
        <Card className="p-4 space-y-3 border-violet-500/20 bg-violet-500/[0.02]">
          <p className="text-xs font-bold text-[hsl(var(--foreground))] uppercase tracking-wider flex items-center gap-1.5">
            <UserPlus size={12} className="text-violet-400" /> Add Member
          </p>
          <div className="flex gap-2">
            <select
              className="flex-1 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg px-3 py-2 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
            >
              <option value="" disabled>Select user to add...</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
              ))}
            </select>
            <select
              className="w-36 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg px-3 py-2 text-xs text-[hsl(var(--foreground))] focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
            >
              <option value="developer">Developer</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          {addError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle size={11} /> {addError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => { setShowAdd(false); setAddError(""); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-7 text-[10px] gap-1"
              loading={isAdding}
              disabled={!addUserId}
              onClick={() => addMember()}
            >
              <UserPlus size={11} /> Add
            </Button>
          </div>
        </Card>
      )}

      {/* Members list */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Loading…</div>
        ) : members.length === 0 ? (
          <div className="p-8 text-center opacity-40">
            <Users size={24} className="mx-auto mb-2 stroke-1" />
            <p className="text-xs font-bold uppercase tracking-tight">No members yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))]">
            {members.map((m) => {
              const roleInfo = ROLE_LABELS[m.role] ?? ROLE_LABELS.viewer;
              const isSelf = m.user_id === me?.id;
              return (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--secondary)/0.3)] transition-colors">
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center text-xs font-bold shrink-0 border border-[hsl(var(--border))]">
                    {m.user.username.slice(0, 2).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{m.user.username}</span>
                      {isSelf && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">You</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{m.user.email}</p>
                  </div>
                  {/* Role selector or badge */}
                  {isOwner && !isSelf && m.role !== "owner" ? (
                    <select
                      value={m.role}
                      onChange={(e) => updateRole({ memberId: m.id, role: e.target.value })}
                      className={cn(
                        "text-[10px] font-bold uppercase px-2 py-1 rounded-full border bg-transparent cursor-pointer focus:outline-none",
                        roleInfo.color
                      )}
                    >
                      <option value="developer">Developer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  ) : (
                    <span className={cn("text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border flex items-center gap-1", roleInfo.color)}>
                      {m.role === "owner" && <Crown size={8} />}
                      {roleInfo.label}
                    </span>
                  )}
                  {/* Remove */}
                  {isOwner && !isSelf && m.role !== "owner" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] hover:text-red-400 hover:bg-red-400/10 shrink-0"
                      title="Remove from project"
                      onClick={() => {
                        if (confirm(`Remove ${m.user.username} from this project?`)) removeMember(m.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Permission matrix */}
      <Card className="p-4 space-y-3">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Permission Matrix</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                <th className="text-left py-1.5 pr-4 font-bold">Action</th>
                <th className="text-center px-3 py-1.5 font-bold text-amber-400">Owner</th>
                <th className="text-center px-3 py-1.5 font-bold text-violet-400">Developer</th>
                <th className="text-center px-3 py-1.5 font-bold text-slate-400">Viewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border)/0.5)]">
              {[
                { action: "View branches & builds",   owner: true,  dev: true,  viewer: true  },
                { action: "Trigger manual deploy",     owner: true,  dev: true,  viewer: false },
                { action: "Create / delete branch",    owner: true,  dev: true,  viewer: false },
                { action: "Clone database",            owner: true,  dev: true,  viewer: false },
                { action: "Restore backup",            owner: true,  dev: true,  viewer: false },
                { action: "Neutralize database",       owner: true,  dev: true,  viewer: false },
                { action: "Create manual backup",      owner: true,  dev: true,  viewer: false },
                { action: "Promote branch (env)",      owner: true,  dev: true,  viewer: false },
                { action: "Edit project settings",     owner: true,  dev: false, viewer: false },
                { action: "Manage team members",       owner: true,  dev: false, viewer: false },
                { action: "Delete project",            owner: true,  dev: false, viewer: false },
              ].map(({ action, owner, dev, viewer }) => (
                <tr key={action} className="hover:bg-[hsl(var(--secondary)/0.2)]">
                  <td className="py-1.5 pr-4 text-[hsl(var(--foreground))]">{action}</td>
                  <td className="text-center px-3 py-1.5">{owner ? <CheckCircle2 size={13} className="mx-auto text-emerald-400" /> : <span className="text-[hsl(var(--muted-foreground))] text-[10px]">—</span>}</td>
                  <td className="text-center px-3 py-1.5">{dev ? <CheckCircle2 size={13} className="mx-auto text-emerald-400" /> : <span className="text-[hsl(var(--muted-foreground))] text-[10px]">—</span>}</td>
                  <td className="text-center px-3 py-1.5">{viewer ? <CheckCircle2 size={13} className="mx-auto text-emerald-400" /> : <span className="text-[hsl(var(--muted-foreground))] text-[10px]">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
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


// ── Environment Variables Settings ────────────────────────────

function EnvironmentVariablesSettings({ projectId, branches }: { projectId: string; branches: Branch[] }) {
  const qc = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = React.useState<string>(branches[0]?.id ?? "");
  const [pairs, setPairs] = React.useState<{ key: string; value: string }[]>([]);
  const [saved, setSaved] = React.useState(false);

  const selectedBranch = branches.find((b) => b.id === selectedBranchId);

  React.useEffect(() => {
    const env = selectedBranch?.env_vars ?? {};
    setPairs(Object.entries(env).map(([key, value]) => ({ key, value })));
    setSaved(false);
  }, [selectedBranchId, selectedBranch]);

  const { mutate: saveVars, isPending: isSaving } = useMutation({
    mutationFn: () => {
      const env_vars: Record<string, string> = {};
      for (const { key, value } of pairs) {
        if (key.trim()) env_vars[key.trim()] = value;
      }
      return branchesApi.update(projectId, selectedBranchId, { env_vars });
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const addRow = () => setPairs((prev) => [...prev, { key: "", value: "" }]);
  const removeRow = (i: number) => setPairs((prev) => prev.filter((_, idx) => idx !== i));
  const setKey = (i: number, key: string) => setPairs((prev) => prev.map((p, idx) => idx === i ? { ...p, key } : p));
  const setValue = (i: number, value: string) => setPairs((prev) => prev.map((p, idx) => idx === i ? { ...p, value } : p));

  if (branches.length === 0) return null;

  return (
    <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <KeyRound size={12} />
          Environment Variables
        </h3>
        <select
          value={selectedBranchId}
          onChange={(e) => setSelectedBranchId(e.target.value)}
          className="text-[11px] bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1 text-[hsl(var(--foreground))]"
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name} ({b.environment})</option>
          ))}
        </select>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        Variables available as <code className="font-mono bg-[hsl(var(--secondary))] px-1 rounded">{"${VAR}"}</code> in{" "}
        <code className="font-mono">.opsway.yml</code> service blocks.
      </p>

      <div className="space-y-2">
        {pairs.map((pair, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="KEY"
              value={pair.key}
              onChange={(e) => setKey(i, e.target.value)}
              className="flex-1 font-mono text-xs bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1.5 text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
            />
            <span className="text-[hsl(var(--muted-foreground))] text-xs">=</span>
            <input
              type="text"
              placeholder="value"
              value={pair.value}
              onChange={(e) => setValue(i, e.target.value)}
              className="flex-[2] font-mono text-xs bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-2 py-1.5 text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]"
            />
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] hover:text-red-400" onClick={() => removeRow(i)}>
              <X size={12} />
            </Button>
          </div>
        ))}
        {pairs.length === 0 && (
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] italic">No variables yet.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1" onClick={addRow}>
          <Plus size={10} />
          Add Variable
        </Button>
        <Button
          size="sm"
          className="h-7 text-[10px]"
          onClick={() => saveVars()}
          loading={isSaving}
          disabled={isSaving}
        >
          {saved ? <><CheckCircle2 size={11} className="mr-1" />Saved!</> : "Save Variables"}
        </Button>
      </div>
    </Card>
  );
}




function NotificationSettings({ project, projectId }: { project: ProjectDetail; projectId: string }) {
  const qc = useQueryClient();
  const [webhookUrl, setWebhookUrl] = React.useState(project.notification_webhook_url || "");
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    projectsApi.update(projectId, {
      notification_webhook_url: webhookUrl.trim() || null,
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <Bell size={12} />
          Notifications
        </h3>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-bold">
          Build Events
        </span>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Get notified on build events via a webhook URL. Opsway will POST a JSON payload on each build status change.
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))] block mb-1">
            Webhook URL <span className="text-[8px] normal-case font-normal">(any HTTP endpoint)</span>
          </label>
          <input
            type="url"
            placeholder="https://example.com/hooks/opsway"
            className="w-full bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="h-8 text-[11px] font-bold px-4"
            onClick={handleSave}
          >
            {saved ? <><CheckCircle2 size={12} className="mr-1.5" /> Saved!</> : "Save Webhook"}
          </Button>
          {webhookUrl && (
            <p className="text-[9px] text-[hsl(var(--muted-foreground))]">
              Active: Webhook
            </p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-[hsl(var(--secondary)/0.3)] p-3 border border-[hsl(var(--border))]">
        <p className="text-[9px] font-bold uppercase text-[hsl(var(--muted-foreground))] mb-1.5">Events Triggered</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "🚀 Build Started", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
            { label: "✅ Build Succeeded", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
            { label: "❌ Build Failed", color: "text-red-400 bg-red-500/10 border-red-500/20" },
          ].map(({ label, color }) => (
            <span key={label} className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${color}`}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ── GitLab Token Settings ──────────────────────────────────────

function GitLabTokenSettings({ project, projectId }: { project: ProjectDetail; projectId: string }) {
  const qc = useQueryClient();
  const [token, setToken] = React.useState("");
  const [gitlabUrl, setGitlabUrl] = React.useState(project.gitlab_url ?? "");
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    const payload: Record<string, string | null> = {
      gitlab_url: gitlabUrl.trim() || null,
    };
    if (token.trim()) payload.gitlab_token = token.trim();
    projectsApi.update(projectId, payload).then(() => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="pt-4 mt-4 border-t border-[hsl(var(--border))] space-y-3">
      <h4 className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))] tracking-wider flex items-center gap-1.5">
        <Shield size={10} />
        GitLab Configuration
      </h4>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-[hsl(var(--muted-foreground))]">
          GitLab URL <span className="opacity-60">(leave blank for gitlab.com)</span>
        </label>
        <input
          type="url"
          placeholder="https://gitlab.mycompany.com"
          className="w-full bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
          value={gitlabUrl}
          onChange={(e) => setGitlabUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-[hsl(var(--muted-foreground))]">
          API Token <span className="opacity-60">(fill to update — requires <code className="text-[10px]">api</code> scope)</span>
        </label>
        <input
          type="password"
          placeholder="glpat-xxxxxxxxxxxxxxxxxxxx"
          className="w-full bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <Button size="sm" className="h-8 text-[11px] font-bold px-4" onClick={handleSave}>
        {saved ? <><CheckCircle2 size={12} className="mr-1" /> Saved!</> : "Save GitLab Settings"}
      </Button>
    </div>
  );
}


// ── Transfer Ownership ─────────────────────────────────────────

function DeleteProjectSettings({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [confirmName, setConfirmName] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => projectsApi.delete(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.push("/");
    },
  });

  return (
    <Card className="border-red-500/30 bg-red-500/5 p-4 mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase text-red-400 tracking-wider flex items-center gap-1.5">
          <Trash2 size={10} />
          Delete Project
        </h4>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold border border-red-500/20">
          Irreversible
        </span>
      </div>
      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        Permanently deletes the project, all branches, builds, and backups. This cannot be undone.
      </p>

      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[11px] text-red-400 border-red-500/30 hover:bg-red-500/10"
          onClick={() => setOpen(true)}
        >
          <Trash2 size={12} className="mr-1.5" /> Delete Project…
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-red-400">
            Type <span className="font-bold font-mono">{projectName}</span> to confirm:
          </p>
          <input
            autoFocus
            className="w-full bg-[hsl(var(--secondary))] border border-red-500/40 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-red-500"
            placeholder={projectName}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-[10px] bg-red-600 hover:bg-red-700 text-white"
              disabled={confirmName !== projectName}
              loading={isPending}
              onClick={() => mutate()}
            >
              Delete Project
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => { setOpen(false); setConfirmName(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}


function TransferOwnershipSettings({
  projectId, members, currentUserId,
}: { projectId: string; members: ProjectMember[]; currentUserId?: string }) {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const nonOwnerMembers = members.filter((m) => m.role !== "owner" && m.user_id !== currentUserId);

  const { mutate: transfer, isPending } = useMutation({
    mutationFn: () => membersApi.transferOwnership(projectId, selectedUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", projectId] });
      qc.invalidateQueries({ queryKey: ["me"] });
      setConfirming(false);
      setSelectedUserId("");
    },
    onError: (err: any) => alert(err.response?.data?.detail || "Transfer failed"),
  });

  return (
    <Card className="p-4 space-y-4 shadow-sm border-red-500/20">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <Crown size={12} />
          Transfer Ownership
        </h3>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold border border-red-500/20">
          Danger Zone
        </span>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Transfer project ownership to another member. You will become a Developer and lose owner privileges.
      </p>

      {nonOwnerMembers.length === 0 ? (
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] italic">No other members to transfer ownership to. Add a member first.</p>
      ) : (
        <div className="space-y-3">
          <select
            className="w-full bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
            value={selectedUserId}
            onChange={(e) => { setSelectedUserId(e.target.value); setConfirming(false); }}
          >
            <option value="">Select new owner…</option>
            {nonOwnerMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.user.full_name || m.user.username} ({m.user.email}) — {m.role}
              </option>
            ))}
          </select>

          {selectedUserId && !confirming && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[11px] text-red-400 border-red-500/30 hover:bg-red-500/10"
              onClick={() => setConfirming(true)}
            >
              Transfer Ownership
            </Button>
          )}

          {confirming && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-red-400">
                Transfer to <strong>{nonOwnerMembers.find((m) => m.user_id === selectedUserId)?.user.username}</strong>?
                You will become a Developer and cannot undo this without their help.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-[10px] bg-red-600 hover:bg-red-700 text-white"
                  loading={isPending}
                  onClick={() => transfer()}
                >
                  Confirm Transfer
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
