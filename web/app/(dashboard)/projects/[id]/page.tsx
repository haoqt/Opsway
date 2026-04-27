"use client";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { projectsApi, branchesApi, domainsApi, monitoringApi, membersApi, authApi } from "@/lib/api";
import { ProjectDetail, Branch, DomainVerification, ProjectMember } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, EnvironmentBadge, OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import {
  GitBranch, ExternalLink, Rocket, RefreshCw,
  GitCommit, Terminal, Layers, Play, Copy,
  CheckCircle2, AlertCircle, ChevronRight, Database, Database as DatabaseIcon,
  Globe, Shield, ShieldCheck, Mail, Download, Trash2, Link2, Loader2, Users, UserPlus, Crown
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = React.useState<"pipeline" | "history" | "team" | "settings">("pipeline");
  const [draggingBranch, setDraggingBranch] = React.useState<Branch | null>(null);
  const [overEnv, setOverEnv] = React.useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const { mutate: promoteBranch } = useMutation({
    mutationFn: ({ branchId, targetEnv }: { branchId: string; targetEnv: string }) =>
      branchesApi.promote(id, branchId, targetEnv),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", id] }),
    onError: (err: any) => alert(err.response?.data?.detail || "Promotion failed"),
  });

  function handleDragStart(event: DragStartEvent) {
    const branch = project?.branches?.find((b) => b.id === event.active.id);
    setDraggingBranch(branch ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverEnv(event.over ? (event.over.id as string) : null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingBranch(null);
    setOverEnv(null);
    const { active, over } = event;
    if (!over) return;
    const targetEnv = over.id as string;
    const branch = project?.branches?.find((b) => b.id === active.id);
    if (!branch || branch.environment === targetEnv) return;
    promoteBranch({ branchId: branch.id, targetEnv });
  }

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
                <OdooVersionBadge version={project.odoo_version} />
                <span className="text-xs text-[hsl(var(--muted-foreground))]">
                  {project.branch_count} branches · Created {formatTimeAgo(project.created_at)}
                </span>
              </div>

              {/* Branches pipeline — 3 columns with drag-and-drop */}
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start h-full">
                  <BranchColumn
                    title="Development"
                    description="Active features & sandboxes"
                    environment="development"
                    branches={devBranches}
                    allBranches={project.branches ?? []}
                    projectId={id}
                    projectSlug={project.slug}
                    isDropTarget={overEnv === "development"}
                    onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                  />
                  <BranchColumn
                    title="Staging"
                    description="Testing with production data"
                    environment="staging"
                    branches={stagingBranches}
                    allBranches={project.branches ?? []}
                    projectId={id}
                    projectSlug={project.slug}
                    isDropTarget={overEnv === "staging"}
                    onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                  />
                  <BranchColumn
                    title="Production"
                    description="Live customer environments"
                    environment="production"
                    branches={prodBranches}
                    allBranches={project.branches ?? []}
                    projectId={id}
                    projectSlug={project.slug}
                    isDropTarget={overEnv === "production"}
                    onRefresh={() => qc.invalidateQueries({ queryKey: ["project", id] })}
                  />
                </div>
                <DragOverlay>
                  {draggingBranch && (
                    <div className="rounded-xl border border-[hsl(var(--primary)/0.5)] bg-[hsl(var(--card))] p-3 shadow-2xl opacity-90 w-64">
                      <div className="flex items-center gap-2">
                        <GitBranch size={14} className="text-[hsl(var(--primary))]" />
                        <span className="text-sm font-bold truncate">{draggingBranch.name}</span>
                      </div>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
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

              {/* Notifications */}
              <NotificationSettings project={project} projectId={id} />

              {/* Custom Domains */}
              <CustomDomainsSettings project={project} projectId={id} />
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
  title, description, environment, branches, allBranches, projectId, projectSlug, isDropTarget, onRefresh,
}: {
  title: string;
  description: string;
  environment: "development" | "staging" | "production";
  branches: Branch[];
  allBranches: Branch[];
  projectId: string;
  projectSlug: string;
  isDropTarget: boolean;
  onRefresh: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: environment });
  const envThemes = {
    development: {
      border: "border-violet-500/30",
      bg: "bg-violet-500/[0.02] dark:bg-violet-500/[0.03]",
      headerBg: "bg-violet-500/10",
      accent: "bg-violet-500",
      text: "text-violet-600 dark:text-violet-400",
      glow: "shadow-[0_0_15px_rgba(139,92,246,0.1)]"
    },
    staging: {
      border: "border-amber-500/30",
      bg: "bg-amber-500/[0.02] dark:bg-amber-500/[0.03]",
      headerBg: "bg-amber-500/10",
      accent: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      glow: "shadow-[0_0_15px_rgba(245,158,11,0.1)]"
    },
    production: {
      border: "border-emerald-500/30",
      bg: "bg-emerald-500/[0.02] dark:bg-emerald-500/[0.03]",
      headerBg: "bg-emerald-500/10",
      accent: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      glow: "shadow-[0_0_15px_rgba(16,185,129,0.1)]"
    },
  };

  const theme = envThemes[environment];

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col h-full rounded-2xl border transition-all duration-300",
        theme.border,
        theme.bg,
        theme.glow,
        isDropTarget && "ring-2 ring-[hsl(var(--primary)/0.6)] ring-offset-1 ring-offset-background scale-[1.01]"
      )}
    >
      {/* Column Header */}
      <div className={cn("p-4 border-b border-inherit rounded-t-2xl", theme.headerBg)}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={cn("h-2 w-2 rounded-full", theme.accent)} />
            <h3 className={cn("text-xs font-black uppercase tracking-widest", theme.text)}>
              {title}
            </h3>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary text-[hsl(var(--foreground))] border border-[hsl(var(--border))]">
            {branches.length}
          </span>
        </div>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))] font-medium leading-tight opacity-80">
          {description}
        </p>
      </div>

      {/* Column Body */}
      <div className="flex-1 p-3 space-y-4 overflow-y-auto max-h-[calc(100vh-280px)] custom-scrollbar">
        {branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 opacity-30">
            <div className={cn("p-3 rounded-full bg-black/10 mb-3", theme.text)}>
              <Layers size={24} className="stroke-1" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-tighter">No {title} Branches</p>
          </div>
        ) : (
          branches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              projectId={projectId}
              projectSlug={projectSlug}
              allBranches={allBranches}
              onRefresh={onRefresh}
              themeColor={theme.accent}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Branch Card ────────────────────────────────────────────────

function BranchCard({
  branch, projectId, projectSlug, allBranches, onRefresh, themeColor,
}: {
  branch: Branch;
  projectId: string;
  projectSlug: string;
  allBranches: Branch[];
  onRefresh: () => void;
  themeColor: string;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: branch.id });
  const [showCloneMenu, setShowCloneMenu] = React.useState(false);
  const [cloneSourceId, setCloneSourceId] = React.useState("");

  // Resource metrics polling (only when running)
  const { data: metrics } = useQuery({
    queryKey: ["branch-metrics", branch.id],
    queryFn: () => monitoringApi.getBranchMetrics(projectId, branch.id).then(r => r.data),
    refetchInterval: 15_000,
    enabled: branch.container_status === "running",
  });

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
  const isBusy = branch.current_task_status === "running" || branch.current_task_status === "pending";
  const isFailed = branch.current_task_status === "failed";
  
  return (
    <div
      ref={setDragRef}
      {...listeners}
      {...attributes}
      className={cn(
        "group relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden hover:border-[hsl(var(--primary)/0.4)] hover:shadow-xl hover:shadow-[hsl(var(--primary)/0.05)] transition-all duration-300",
        isDragging && "opacity-40 scale-95"
      )}
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      {/* Left Accent Bar */}
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", themeColor)} />

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
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden">
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
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden">
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
              {/* Mail Catcher — dev/staging only */}
              {(branch.environment === "development" || branch.environment === "staging") && (
                <a
                  href={`${process.env.NEXT_PUBLIC_MAILHOG_URL || "http://localhost:8025"}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View Intercepted Emails (MailHog)"
                >
                  <Button variant="outline" size="sm" className="h-8 w-8 p-0 hover:border-amber-500/40 hover:text-amber-400">
                    <Mail size={13} />
                  </Button>
                </a>
              )}
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
                    <option key={b.id} value={b.id}>{b.name} ({b.environment})</option>
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

          {/* Quick Promotion */}
          <div className="grid grid-cols-2 gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
             {branch.environment === "development" && (
               <Button
                 variant="ghost"
                 size="sm"
                 className="h-7 text-[10px] gap-1 text-[hsl(var(--muted-foreground))] hover:text-amber-400 hover:bg-amber-400/10"
                 loading={isPromoting}
                 disabled={isBusy}
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
                 disabled={isBusy}
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
                 disabled={isBusy}
                 onClick={() => promote("development")}
               >
                 <ChevronRight size={10} /> Back to Dev
               </Button>
             )}
          </div>

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


// ── Custom Domains Settings ────────────────────────────────────

function CustomDomainsSettings({ project, projectId }: { project: ProjectDetail; projectId: string }) {
  const qc = useQueryClient();
  const [domainInput, setDomainInput] = React.useState(project.custom_domain || "");
  const [isEditing, setIsEditing] = React.useState(!project.custom_domain);

  const cnameTarget = `${project.slug}.${process.env.NEXT_PUBLIC_TRAEFIK_DOMAIN || "localhost"}`;

  const { mutate: setDomain, isPending: isSetting } = useMutation({
    mutationFn: () => domainsApi.set(projectId, domainInput.trim()),
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setIsEditing(false); 
    },
    onError: (err: any) => alert(err.response?.data?.detail || "Failed to set domain"),
  });

  const { mutate: verifyDomain, isPending: isVerifying } = useMutation({
    mutationFn: () => domainsApi.verify(projectId),
    onSuccess: (res) => {
      if (res.data.verified) {
        qc.invalidateQueries({ queryKey: ["project", projectId] });
      } else {
        alert(`Verification failed: ${res.data.message}`);
      }
    },
    onError: (err: any) => alert(err.response?.data?.detail || "Verification failed"),
  });

  const { mutate: removeDomain, isPending: isRemoving } = useMutation({
    mutationFn: () => domainsApi.remove(projectId),
    onSuccess: () => { 
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setDomainInput(""); 
      setIsEditing(true); 
    },
    onError: (err: any) => alert(err.response?.data?.detail || "Failed to remove domain"),
  });

  return (
    <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <Globe size={12} />
          Project Custom Domain
        </h3>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-bold">
          Wildcard & TLS Auto
        </span>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Set a root domain for your project. Branches will automatically receive subdomains (e.g., <code>branch-name.yourdomain.com</code>). 
        Production branches will also be accessible at the root domain.
      </p>

      <div className="rounded-lg bg-[hsl(var(--secondary)/0.3)] p-3 border border-[hsl(var(--border))] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))]">Current Domain</span>
          {project.custom_domain && (
            <div className="flex items-center gap-1">
              {project.custom_domain_verified ? (
                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400">
                  <CheckCircle2 size={10} /> Verified
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400">
                  <AlertCircle size={10} /> Pending Verification
                </span>
              )}
            </div>
          )}
        </div>

        {project.custom_domain && !isEditing ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Globe size={12} className="text-blue-400 shrink-0" />
              <code className="text-[11px] font-mono bg-black/20 px-2 py-1 rounded truncate flex-1">
                {project.custom_domain}
              </code>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {!project.custom_domain_verified && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[10px] text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                  loading={isVerifying}
                  onClick={() => verifyDomain()}
                >
                  Verify
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] hover:text-red-400"
                loading={isRemoving}
                onClick={() => {
                  if (confirm(`Remove domain "${project.custom_domain}"? This will disable custom subdomains for all branches.`)) {
                    removeDomain();
                  }
                }}
              >
                <Trash2 size={12} />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsEditing(true)}>
                <RefreshCw size={12} />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. mycompany.com"
              className="flex-1 bg-black/20 border border-[hsl(var(--border))] rounded px-3 py-1 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
            />
            <Button
              size="sm"
              className="h-8 text-[11px] font-bold px-4"
              loading={isSetting}
              onClick={() => setDomain()}
            >
              Set Domain
            </Button>
            {project.custom_domain && (
               <Button variant="ghost" size="sm" className="h-8" onClick={() => { setIsEditing(false); setDomainInput(project.custom_domain || ""); }}>
                 Cancel
               </Button>
            )}
          </div>
        )}

        {project.custom_domain && (
          <div className="pt-2 space-y-1">
            <p className="text-[9px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Example Routing:</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-black/10 p-1.5 rounded border border-[hsl(var(--border))]">
                <p className="text-[8px] text-[hsl(var(--muted-foreground))] uppercase">Main Branch</p>
                <p className="text-[10px] font-mono text-emerald-400 truncate">https://{project.custom_domain}</p>
              </div>
              <div className="bg-black/10 p-1.5 rounded border border-[hsl(var(--border))]">
                <p className="text-[8px] text-[hsl(var(--muted-foreground))] uppercase">Staging Branch</p>
                <p className="text-[10px] font-mono text-amber-400 truncate">https://staging.{project.custom_domain}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* DNS Instructions */}
      <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1.5">
          <Link2 size={10} />
          DNS Setup Instructions
        </h4>
        <div className="rounded-lg bg-[hsl(var(--secondary)/0.5)] p-3 border border-[hsl(var(--border))] space-y-2">
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold text-[hsl(var(--primary))] mt-0.5 shrink-0">1.</span>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              Go to your DNS provider (Cloudflare, Route53, etc.)
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold text-[hsl(var(--primary))] mt-0.5 shrink-0">2.</span>
            <div className="text-[10px] text-[hsl(var(--muted-foreground))] space-y-1">
              <p>Add the following records:</p>
              <div className="bg-black/20 p-2 rounded font-mono text-[9px] space-y-1">
                <div className="flex justify-between">
                  <span>Type: <code className="text-blue-400">CNAME</code></span>
                  <span>Name: <code className="text-blue-400">@</code> (or root)</span>
                </div>
                <div className="flex justify-between">
                  <span>Target:</span>
                  <code className="text-emerald-400">{cnameTarget}</code>
                </div>
                <div className="border-t border-white/5 my-1" />
                <div className="flex justify-between">
                  <span>Type: <code className="text-blue-400">CNAME</code></span>
                  <span>Name: <code className="text-blue-400">*</code> (wildcard)</span>
                </div>
                <div className="flex justify-between">
                  <span>Target:</span>
                  <code className="text-emerald-400">{cnameTarget}</code>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold text-[hsl(var(--primary))] mt-0.5 shrink-0">3.</span>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
              Click <strong>Verify</strong>. Once verified, TLS (Let&apos;s Encrypt) will be automatically provisioned for all subdomains.
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}


// ── Notification Settings ──────────────────────────────────────

function NotificationSettings({ project, projectId }: { project: ProjectDetail; projectId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = React.useState(project.notification_email || "");
  const [webhookUrl, setWebhookUrl] = React.useState(project.notification_webhook_url || "");
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    projectsApi.update(projectId, {
      notification_email: email.trim() || null,
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
          <Mail size={12} />
          Notifications
        </h3>
        <span className="text-[9px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-bold">
          Build Events
        </span>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))] leading-relaxed">
        Get notified when builds start, succeed, or fail. Supports email and/or custom webhooks (Slack, Discord, etc).
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))] block mb-1">
            Notification Email
          </label>
          <input
            type="email"
            placeholder="team@yourcompany.com"
            className="w-full bg-black/20 border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))] block mb-1">
            Webhook URL <span className="text-[8px] normal-case font-normal">(Slack, Discord, or any HTTP endpoint)</span>
          </label>
          <input
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            className="w-full bg-black/20 border border-[hsl(var(--border))] rounded px-3 py-1.5 text-xs focus:outline-none focus:border-[hsl(var(--primary)/0.5)]"
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
            {saved ? <><CheckCircle2 size={12} className="mr-1.5" /> Saved!</> : "Save Notifications"}
          </Button>
          {(email || webhookUrl) && (
            <p className="text-[9px] text-[hsl(var(--muted-foreground))]">
              Notifications active for: {[email && "Email", webhookUrl && "Webhook"].filter(Boolean).join(", ")}
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

