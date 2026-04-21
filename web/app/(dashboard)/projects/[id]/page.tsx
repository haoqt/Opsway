"use client";
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

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => projectsApi.get(id).then((r) => r.data as ProjectDetail),
    refetchInterval: 10_000,
  });

  if (isLoading) return <LoadingSkeleton />;
  if (!project) return <div className="p-6 text-sm text-red-400">Project not found</div>;

  const devBranches = project.branches?.filter((b) => b.environment === "development") ?? [];
  const stagingBranches = project.branches?.filter((b) => b.environment === "staging") ?? [];
  const prodBranches = project.branches?.filter((b) => b.environment === "production") ?? [];

  return (
    <>
      <Topbar title={project.name}>
        <a
          href={`https://github.com/${project.repo_full_name}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ExternalLink size={12} /> {project.repo_full_name}
        </a>
      </Topbar>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Project info */}
        <div className="flex items-center gap-3 flex-wrap">
          <OdooVersionBadge version={project.odoo_version} />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {project.branches?.length ?? 0} branches · Created {formatTimeAgo(project.created_at)}
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

        {/* Settings strip */}
        <Card className="flex items-center gap-4 flex-wrap">
          <div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Webhook Secret</p>
            <code className="mt-0.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
              {project.webhook_id ? `#${project.webhook_id}` : "Not registered"}
            </code>
          </div>
          {project.deploy_key_public && (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider">Deploy Key</p>
              <code className="block truncate text-xs font-mono text-[hsl(var(--muted-foreground))] mt-0.5">
                {project.deploy_key_public.slice(0, 60)}…
              </code>
            </div>
          )}
        </Card>
      </div>
    </>
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
          <a
            href={`http://terminal.localhost`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <Terminal size={9} />
            </Button>
          </a>
        )}
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
