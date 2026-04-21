"use client";
import { useState, useEffect, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import { projectsApi } from "@/lib/api";
import { Project } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Input, EmptyState, Skeleton } from "@/components/ui/primitives";
import { OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo } from "@/lib/utils";
import {
  FolderGit2, Plus, ExternalLink, GitBranch,
  MoreHorizontal, Search, Rocket
} from "lucide-react";
import Link from "next/link";
import { NewProjectModal } from "@/components/projects/new-project-modal";

function ProjectsPageInner() {
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowNew(true);
      router.replace("/projects"); // clean URL
    }
  }, [searchParams, router]);

  const { data: projects, isLoading, refetch } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list().then((r) => r.data as Project[]),
    refetchInterval: 20_000,
  });

  const filtered = projects?.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.repo_full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <Topbar title="Projects">
        <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
          <Plus size={13} /> New Project
        </Button>
      </Topbar>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Search */}
        <div className="mb-5 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] pl-8 pr-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : !filtered?.length ? (
          <EmptyState
            icon={FolderGit2}
            title={search ? "No projects match your search" : "No projects yet"}
            description="Connect a GitHub repository to start deploying Odoo instances"
            action={
              !search && (
                <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
                  <Plus size={13} /> Connect Repository
                </Button>
              )
            }
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); refetch(); }} />}
    </>
  );
}

function ProjectRow({ project }: { project: Project }) {
  return (
    <Link href={`/projects/${project.id}`}>
      <Card className="hover:border-[hsl(var(--primary)/0.3)] transition-all duration-200 cursor-pointer group">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-cyan-500/20 text-violet-400">
            <FolderGit2 size={18} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{project.name}</span>
              <OdooVersionBadge version={project.odoo_version} />
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))]">
              <span className="flex items-center gap-1">
                <ExternalLink size={9} />
                {project.repo_full_name}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <GitBranch size={9} />
                {project.branch_count} branch{project.branch_count !== 1 ? "es" : ""}
              </span>
              <span>·</span>
              <span>Updated {formatTimeAgo(project.updated_at)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {project.active_builds > 0 && (
              <span className="flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-400">
                <Rocket size={9} className="animate-pulse" />
                {project.active_builds} building
              </span>
            )}
            <ExternalLink size={13} className="text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsPageInner />
    </Suspense>
  );
}
