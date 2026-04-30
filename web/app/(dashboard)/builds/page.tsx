"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { buildsApi } from "@/lib/api";
import { BuildDetail } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Skeleton, EmptyState } from "@/components/ui/primitives";
import { OdooVersionBadge } from "@/components/ui/badges";
import { formatTimeAgo, formatDuration, shortSha } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Rocket, GitBranch, GitCommit, CheckCircle2, XCircle,
  Clock, Loader2, CalendarDays, Timer, RotateCcw, Square, ChevronDown,
  Search, X,
} from "lucide-react";

// ── Status icon ────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === "success")
    return <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />;
  if (status === "failed")
    return <XCircle size={18} className="text-red-500 shrink-0" />;
  if (status === "cancelled")
    return <XCircle size={18} className="text-zinc-400 shrink-0" />;
  if (status === "building")
    return <Loader2 size={18} className="text-blue-500 animate-spin shrink-0" />;
  return <Clock size={18} className="text-zinc-400 shrink-0" />;
}

// ── Filter dropdown ────────────────────────────────────────────────

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isActive = value !== "";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
          isActive
            ? "border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
            : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--border)/0.8)] hover:text-[hsl(var(--foreground))]"
        )}
      >
        {isActive ? value : label}
        {isActive ? (
          <X
            size={11}
            onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }}
            className="ml-0.5 hover:text-red-500"
          />
        ) : (
          <ChevronDown size={11} className={cn("transition-transform", open && "rotate-180")} />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 min-w-[140px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt === value ? "" : opt); setOpen(false); }}
              className={cn(
                "w-full px-3 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--secondary))]",
                opt === value
                  ? "bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))] font-medium"
                  : "text-[hsl(var(--foreground))]"
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────

const STATUS_OPTIONS = ["success", "failed", "building", "pending", "cancelled"];

export default function GlobalBuildsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const { data: builds, isLoading } = useQuery({
    queryKey: ["all-builds"],
    queryFn: () => buildsApi.listAll().then((r) => r.data as BuildDetail[]),
    refetchInterval: 10_000,
  });

  const branches = useMemo(
    () => [...new Set((builds ?? []).map((b) => b.branch.name))].sort(),
    [builds]
  );
  const projects = useMemo(
    () => [...new Set((builds ?? []).map((b) => b.project_name).filter(Boolean))].sort() as string[],
    [builds]
  );

  const filtered = useMemo(() => {
    if (!builds) return [];
    const q = search.toLowerCase();
    return builds.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (branchFilter && b.branch.name !== branchFilter) return false;
      if (projectFilter && b.project_name !== projectFilter) return false;
      if (q) {
        const hay = [
          b.commit_message, b.commit_author, b.branch.name,
          b.project_name, shortSha(b.id), shortSha(b.commit_sha),
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [builds, search, statusFilter, branchFilter, projectFilter]);

  const hasFilters = search || statusFilter || branchFilter || projectFilter;

  const clearAll = () => {
    setSearch("");
    setStatusFilter("");
    setBranchFilter("");
    setProjectFilter("");
  };

  return (
    <>
      <Topbar title="Recent Builds" />
      <div className="flex-1 overflow-y-auto p-6">
        {/* Toolbar */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter runs…"
              className={cn(
                "w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]",
                "pl-7 pr-3 py-1.5 text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))]",
                "focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary)/0.5)] focus:border-[hsl(var(--primary)/0.5)]"
              )}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* Filters */}
          <FilterDropdown label="Status" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
          <FilterDropdown label="Branch" options={branches} value={branchFilter} onChange={setBranchFilter} />
          <FilterDropdown label="Project" options={projects} value={projectFilter} onChange={setProjectFilter} />

          {hasFilters && (
            <button
              onClick={clearAll}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors ml-1"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="rounded-lg border border-[hsl(var(--border))] overflow-hidden divide-y divide-[hsl(var(--border))]">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-[60px] rounded-none" />
            ))}
          </div>
        ) : !builds?.length ? (
          <EmptyState
            icon={Rocket}
            title="No builds yet"
            description="Trigger a build by pushing to a connected repository or clicking deploy."
          />
        ) : (
          <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
            {/* Header */}
            <div className="flex items-center px-4 py-2.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.4)]">
              <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
                {filtered.length}{hasFilters && ` / ${builds.length}`} build run{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-[hsl(var(--muted-foreground))]">
                <Search size={28} className="mb-3 opacity-30" />
                <p className="text-sm">No builds match your filters.</p>
                <button onClick={clearAll} className="mt-2 text-xs text-blue-500 hover:underline">
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border))]">
                {filtered.map((build) => (
                  <BuildRow key={build.id} build={build} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Build row ─────────────────────────────────────────────────────

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

  return (
    <div>
      <div
        className="flex items-center gap-4 px-4 py-3.5 cursor-pointer hover:bg-[hsl(var(--secondary)/0.5)] transition-colors"
        onClick={() => router.push(`/builds/${build.id}`)}
      >
        <StatusIcon status={build.status} />

        {/* Title + subtitle */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[hsl(var(--foreground))] truncate leading-snug">
            {build.commit_message || "Manual trigger"}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[hsl(var(--muted-foreground))] flex-wrap">
            <span className="font-mono">#{shortSha(build.id)}</span>
            <span>·</span>
            <span className="capitalize">{build.triggered_by}</span>
            {build.commit_author && (
              <>
                <span>by</span>
                <span className="font-medium text-[hsl(var(--foreground)/0.7)]">{build.commit_author}</span>
              </>
            )}
            <span>·</span>
            <button
              onClick={(e) => { e.stopPropagation(); setCommitOpen((v) => !v); }}
              className="inline-flex items-center gap-1 font-mono hover:text-[hsl(var(--foreground))] transition-colors"
            >
              <GitCommit size={10} />
              {shortSha(build.commit_sha)}
              <ChevronDown
                size={10}
                className={cn("transition-transform duration-150", commitOpen && "rotate-180")}
              />
            </button>
          </div>
        </div>

        {/* Branch + odoo version */}
        <div className="hidden md:flex items-center gap-1.5 shrink-0">
          {build.branch.odoo_version && <OdooVersionBadge version={build.branch.odoo_version} />}
          <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
            "bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))] border-[hsl(var(--border))]"
          )}>
            <GitBranch size={10} />
            {build.branch.name}
          </span>
        </div>

        {/* Project name */}
        <div className="hidden lg:block text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] shrink-0 w-28 truncate text-right">
          {build.project_name || "—"}
        </div>

        {/* Date + duration */}
        <div className="flex flex-col items-end gap-0.5 text-[11px] text-[hsl(var(--muted-foreground))] shrink-0 w-32">
          <span className="flex items-center gap-1">
            <CalendarDays size={10} />
            {formatTimeAgo(build.created_at)}
          </span>
          <span className="flex items-center gap-1">
            <Timer size={10} />
            {build.duration_seconds ? formatDuration(build.duration_seconds) : "—"}
          </span>
        </div>

        {/* Action */}
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          {isCancellable ? (
            <button
              onClick={handleCancel}
              title="Stop Build"
              className="p-1.5 rounded-md hover:bg-red-500/10 hover:text-red-500 transition-colors text-[hsl(var(--muted-foreground))]"
            >
              <Square size={13} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={handleRetry}
              title="Retry Build"
              className="p-1.5 rounded-md hover:bg-blue-500/10 hover:text-blue-500 transition-colors text-[hsl(var(--muted-foreground))]"
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Commit detail dropdown */}
      {commitOpen && (
        <div
          className="border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.3)] px-4 py-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11px] max-w-2xl">
            <CommitField label="Commit SHA" value={build.commit_sha} mono />
            <CommitField label="Author" value={build.commit_author || "—"} />
            <CommitField label="Message" value={build.commit_message || "—"} className="col-span-2" />
            <CommitField label="Triggered by" value={build.triggered_by} className="capitalize" />
            <CommitField label="Build ID" value={build.id} mono />
          </div>
        </div>
      )}
    </div>
  );
}

function CommitField({
  label, value, mono, className,
}: {
  label: string; value: string; mono?: boolean; className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span className={cn("text-[hsl(var(--foreground))] break-all", mono && "font-mono text-[10px]")}>
        {value}
      </span>
    </div>
  );
}
