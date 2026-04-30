"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { buildsApi } from "@/lib/api";
import { BuildDetail } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { BuildStatusBadge, OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Rocket, GitBranch, GitCommit, ChevronRight,
  Clock, User, RotateCcw, ChevronDown, Hash, Square,
} from "lucide-react";

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
            {builds.map((build) => <BuildRow key={build.id} build={build} />)}
          </div>
        )}
      </div>
    </>
  );
}

function BuildRow({ build }: { build: BuildDetail }) {
  const router = useRouter();
  const [commitOpen, setCommitOpen] = useState(false);
  const isCancellable = build.status === "pending" || build.status === "building";

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to stop this build?")) {
      try { await buildsApi.cancel(build.id); } catch { alert("Failed to cancel build"); }
    }
  };

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to retry this build?")) {
      try {
        const res = await buildsApi.retry(build.id);
        router.push(`/builds/${res.data.id}`);
      } catch { alert("Failed to retry build"); }
    }
  };

  const toggleCommit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCommitOpen((v) => !v);
  };

  return (
    <Card className="overflow-hidden transition-all duration-200 hover:border-[hsl(var(--primary)/0.3)]">
      {/* Main row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer group"
        onClick={() => router.push(`/builds/${build.id}`)}
      >
        {/* Status icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--secondary))]">
          <Rocket
            size={18}
            className={build.status === "building" ? "text-blue-400 animate-pulse" : "text-[hsl(var(--muted-foreground))]"}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[hsl(var(--foreground))] truncate max-w-sm">
              {build.commit_message || "Manual trigger"}
            </span>
          </div>

          {/* Meta row */}
          <div className="mt-1 flex items-center gap-3 text-[11px] text-[hsl(var(--muted-foreground))] flex-wrap">
            {/* Build ID */}
            <span className="flex items-center gap-1 font-mono text-zinc-500">
              <Hash size={9} />
              {shortSha(build.id)}
            </span>
            <span>·</span>
            {build.branch.odoo_version && (
              <>
                <OdooVersionBadge version={build.branch.odoo_version} />
                <span>·</span>
              </>
            )}
            <span className="flex items-center gap-1 font-medium">
              <GitBranch size={10} />
              {build.branch.name}
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

        {/* Project tag */}
        <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-wider font-bold text-[hsl(var(--foreground))] bg-[hsl(var(--primary)/0.1)] px-2 py-1 rounded shrink-0">
          {build.project_name || "Unknown Project"}
        </div>

        {/* Commit dropdown toggle */}
        <button
          onClick={toggleCommit}
          title="View commit details"
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-mono transition-colors shrink-0",
            "border border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.4)] hover:bg-[hsl(var(--secondary))]",
            commitOpen
              ? "text-[hsl(var(--primary))] border-[hsl(var(--primary)/0.4)]"
              : "text-[hsl(var(--muted-foreground))]"
          )}
        >
          <GitCommit size={11} />
          {shortSha(build.commit_sha)}
          <ChevronDown
            size={11}
            className={cn("transition-transform duration-200", commitOpen && "rotate-180")}
          />
        </button>

        {/* Status badge */}
        <BuildStatusBadge status={build.status} />

        {/* Actions */}
        {isCancellable ? (
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-red-500/10 hover:text-red-500 rounded-lg transition-colors text-[hsl(var(--muted-foreground))] shrink-0"
            title="Stop Build"
          >
            <Square size={13} className="fill-current" />
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleRetry}
              className="p-2 hover:bg-blue-500/10 hover:text-blue-500 rounded-lg transition-colors text-[hsl(var(--muted-foreground))]"
              title="Retry Build"
            >
              <RotateCcw size={14} />
            </button>
            <ChevronRight
              size={14}
              className="text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        )}
      </div>

      {/* Commit detail dropdown */}
      {commitOpen && (
        <div
          className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.5)] px-4 py-3 mx-0"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11px]">
            <CommitField label="Commit SHA" value={build.commit_sha} mono />
            <CommitField label="Author" value={build.commit_author || "—"} icon={<User size={10} />} />
            <CommitField
              label="Message"
              value={build.commit_message || "—"}
              className="col-span-2"
            />
            <CommitField
              label="Triggered by"
              value={build.triggered_by}
              className="capitalize"
            />
            <CommitField label="Build ID" value={build.id} mono />
          </div>
        </div>
      )}
    </Card>
  );
}

function CommitField({
  label, value, mono, icon, className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span className={cn(
        "text-[hsl(var(--foreground))] break-all",
        mono && "font-mono text-[10px]"
      )}>
        {icon && <span className="inline mr-1 opacity-60">{icon}</span>}
        {value}
      </span>
    </div>
  );
}
