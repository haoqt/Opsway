"use client";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import { Project, Build } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, CardHeader, CardTitle, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, EnvironmentBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import {
  Rocket, FolderGit2, CheckCircle2, XCircle,
  GitCommit, ExternalLink, Activity, Zap, TrendingUp
} from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data as Project[]),
    refetchInterval: 15_000,
  });

  const totalProjects = projects?.length ?? 0;
  const activeBuilds = projects?.reduce((acc, p) => acc + (p.active_builds || 0), 0) ?? 0;

  return (
    <>
      <Topbar title="Overview" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={FolderGit2}
            label="Projects"
            value={isLoading ? "—" : String(totalProjects)}
            sub="connected repos"
            color="violet"
          />
          <StatCard
            icon={Rocket}
            label="Active Builds"
            value={isLoading ? "—" : String(activeBuilds)}
            sub="running now"
            color="blue"
          />
          <StatCard
            icon={CheckCircle2}
            label="Deployments Today"
            value="—"
            sub="success rate"
            color="emerald"
          />
          <StatCard
            icon={Activity}
            label="Containers"
            value="—"
            sub="instances running"
            color="amber"
          />
        </div>

        {/* Projects grid */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">Projects</h2>
            <Link
              href="/projects/new"
              className="flex items-center gap-1.5 rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Zap size={11} /> New Project
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40" />)}
            </div>
          ) : !projects?.length ? (
            <EmptyState
              icon={FolderGit2}
              title="No projects yet"
              description="Connect a GitHub repository to get started"
              action={
                <Link href="/projects/new" className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity">
                  Connect Repository
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </section>

      </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function StatCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: string; sub: string;
  color: "violet" | "blue" | "emerald" | "amber";
}) {
  const colors = {
    violet: "from-violet-500/20 to-violet-500/5 text-violet-400 border-violet-500/20",
    blue:   "from-blue-500/20 to-blue-500/5 text-blue-400 border-blue-500/20",
    emerald:"from-emerald-500/20 to-emerald-500/5 text-emerald-400 border-emerald-500/20",
    amber:  "from-amber-500/20 to-amber-500/5 text-amber-400 border-amber-500/20",
  };
  return (
    <div className={`rounded-xl border bg-gradient-to-br p-4 ${colors[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wider">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-[hsl(var(--foreground))]">{value}</p>
          <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</p>
        </div>
        <Icon size={18} className="opacity-70" />
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-[hsl(var(--primary)/0.4)] transition-all duration-200 cursor-pointer group">
        <div className="flex items-start gap-3">
          {/* Repo icon */}
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] group-hover:bg-[hsl(var(--primary)/0.1)] group-hover:text-[hsl(var(--primary))] transition-colors">
            <FolderGit2 size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">{project.name}</p>
              {project.odoo_version && (
                <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                  v{project.odoo_version}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
              {project.repo_full_name}
            </p>
          </div>
          <ExternalLink size={12} className="shrink-0 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[hsl(var(--border))] pt-4">
          <div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Branches</p>
            <p className="text-lg font-bold text-[hsl(var(--foreground))]">{project.branch_count}</p>
          </div>
          <div>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Active Builds</p>
            <p className={`text-lg font-bold ${project.active_builds > 0 ? "text-blue-400" : "text-[hsl(var(--foreground))]"}`}>
              {project.active_builds}
            </p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
