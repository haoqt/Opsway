"use client";
import { useQuery } from "@tanstack/react-query";
import { buildsApi } from "@/lib/api";
import { BuildDetail } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import { Rocket, GitBranch, GitCommit, ChevronRight, Clock, User, RotateCcw } from "lucide-react";
import Link from "next/link";

export default function GlobalBuildsPage() {
  const { data: builds, isLoading } = useQuery({
    queryKey: ["all-builds"],
    queryFn: () => buildsApi.listAll().then((r) => r.data as BuildDetail[]),
    refetchInterval: 10_000,
  });

  return (
    <>
      <Topbar title="Recent Builds" />
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : !builds?.length ? (
          <EmptyState
            icon={Rocket}
            title="No builds yet"
            description="Trigger a build by pushing to a connected repository or clicking deploy."
          />
        ) : (
          <div className="space-y-3">
            {builds.map((build) => (
              <BuildRow key={build.id} build={build} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function BuildRow({ build }: { build: BuildDetail }) {
  const isCancellable = build.status === "pending" || build.status === "building";

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Are you sure you want to stop this build?")) {
      try {
        await buildsApi.cancel(build.id);
        // Page will refresh due to refetchInterval or manual refresh
      } catch (err) {
        alert("Failed to cancel build");
      }
    }
  };
  const handleRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm("Are you sure you want to retry this build?")) {
      try {
        await buildsApi.retry(build.id);
      } catch (err) {
        alert("Failed to retry build");
      }
    }
  };

  return (
    <Link href={`/builds/${build.id}`}>
      <Card className="hover:border-[hsl(var(--primary)/0.3)] transition-all duration-200 cursor-pointer group px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Status Icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))]">
            <Rocket size={18} className={build.status === "building" ? "text-blue-400 animate-pulse" : "text-[hsl(var(--muted-foreground))]"} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[hsl(var(--foreground))] line-clamp-1">
                {build.commit_message || "Manual trigger"}
              </span>
              <BuildStatusBadge status={build.status} />
            </div>
            
            <div className="mt-1 flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))] flex-wrap">
              {build.branch.odoo_version && <OdooVersionBadge version={build.branch.odoo_version} />}
              <span className="flex items-center gap-1 font-medium text-[hsl(var(--muted-foreground))]">
                <GitBranch size={10} />
                {build.branch.name}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <GitCommit size={10} />
                <span className="font-mono">{shortSha(build.commit_sha)}</span>
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <User size={10} />
                {build.commit_author || "System"}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {formatTimeAgo(build.created_at)}
              </span>
              {build.duration_seconds && (
                <>
                  <span>·</span>
                  <span>{formatDuration(build.duration_seconds)}</span>
                </>
              )}
            </div>
          </div>

          {/* Project Tag */}
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-[hsl(var(--foreground))] bg-[hsl(var(--primary)/0.1)] px-2 py-1 rounded">
             {build.project_name || "Unknown Project"}
          </div>

          {isCancellable ? (
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors text-[hsl(var(--muted-foreground))]"
              title="Stop Build"
            >
              <div className="w-3 h-3 bg-current rounded-[2px]" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={handleRetry}
                className="p-2 hover:bg-blue-500/10 hover:text-blue-500 rounded-lg transition-colors text-[hsl(var(--muted-foreground))]"
                title="Retry Build"
              >
                <RotateCcw size={14} />
              </button>
              <ChevronRight size={14} className="text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
