"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { branchesApi } from "@/lib/api";
import { Build } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import { Rocket, GitCommit, Clock, User, ChevronRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { buildsApi } from "@/lib/api";

export default function BranchBuildsPage() {
  const { id: projectId, branchId } = useParams<{ id: string; branchId: string }>();

  const { data: builds, isLoading } = useQuery({
    queryKey: ["builds", projectId, branchId],
    queryFn: () => branchesApi.listBuilds(projectId, branchId).then((r) => r.data as Build[]),
    refetchInterval: 10_000,
  });

  return (
    <>
      <Topbar title="Build History" />
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : !builds?.length ? (
          <EmptyState
            icon={Rocket}
            title="No builds yet"
            description="Push a commit or trigger a manual deploy to start"
          />
        ) : (
          <div className="space-y-2">
            {builds.map((build) => {
              const isCancellable = build.status === "pending" || build.status === "building";
              
              const handleCancel = async (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm("Are you sure you want to stop this build?")) {
                  try {
                    await buildsApi.cancel(build.id);
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
                <Link key={build.id} href={`/builds/${build.id}`}>
                  <Card className="hover:border-[hsl(var(--primary)/0.3)] transition-all cursor-pointer px-4 py-3 group">
                    <div className="flex items-center gap-4">
                      <BuildStatusBadge status={build.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <GitCommit size={11} className="text-[hsl(var(--muted-foreground))]" />
                          <code className="font-mono text-[hsl(var(--foreground))]">{shortSha(build.commit_sha)}</code>
                          <span className="truncate text-[hsl(var(--muted-foreground))]">{build.commit_message?.slice(0, 60)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-[hsl(var(--muted-foreground))]">
                          <span className="flex items-center gap-1">
                            <User size={8} /> {build.commit_author}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={8} /> {formatDuration(build.duration_seconds)}
                          </span>
                          <span>{formatTimeAgo(build.created_at)}</span>
                          <span className="capitalize">via {build.triggered_by}</span>
                        </div>
                      </div>
                      
                      {build.test_passed !== null && (
                        <span className={`text-xs ${build.test_passed ? "text-emerald-400" : "text-red-400"}`}>
                          {build.test_passed ? `✅ ${build.test_count ?? 0} tests` : "❌ Tests failed"}
                        </span>
                      )}

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
            })}
          </div>
        )}
      </div>
    </>
  );
}
