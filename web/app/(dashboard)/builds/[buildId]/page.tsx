"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { buildsApi } from "@/lib/api";
import { BuildDetail } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button } from "@/components/ui/primitives";
import { BuildStatusBadge, EnvironmentBadge } from "@/components/ui/badges";
import { formatDuration, formatTimeAgo, shortSha } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  Terminal, GitCommit, Clock, CheckCircle2,
  XCircle, AlertCircle, Download, Maximize2, Square, RotateCcw
} from "lucide-react";
import { BuildTimeline } from "@/components/builds/build-timeline";

export default function BuildDetailPage() {
  const { buildId } = useParams<{ buildId: string }>();
  const logRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const { data: build, refetch } = useQuery({
    queryKey: ["build", buildId],
    queryFn: () => buildsApi.get(buildId).then((r) => r.data as BuildDetail),
    refetchInterval: 5000,
  });

  // SSE log streaming — reset logs on every buildId change
  useEffect(() => {
    if (!buildId) return;
    setLogs([]);
    const url = buildsApi.logsUrl(buildId);
    const source = new EventSource(url);
    setIsStreaming(true);

    source.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "log") {
          setLogs((prev) => [...prev, msg.line]);
        } else if (msg.type === "done") {
          setIsStreaming(false);
          refetch();
          source.close();
        }
      } catch {}
    };

    source.onerror = () => {
      setIsStreaming(false);
      source.close();
    };

    return () => source.close();
  }, [buildId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const downloadLogs = () => {
    const blob = new Blob([logs.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `build-${buildId?.slice(0, 8)}.log`;
    a.click();
  };

  const handleCancel = async () => {
    if (confirm("Are you sure you want to stop this build?")) {
      try {
        await buildsApi.cancel(buildId);
        refetch();
      } catch (err) {
        alert("Failed to cancel build");
      }
    }
  };

  const handleRetry = async () => {
    if (confirm("Are you sure you want to retry this build?")) {
      try {
        const res = await buildsApi.retry(buildId);
        window.location.href = `/builds/${res.data.id}`;
      } catch (err) {
        alert("Failed to retry build");
      }
    }
  };

  const isCancellable = build?.status === "pending" || build?.status === "building";

  if (!build) {
    return (
      <>
        <Topbar title="Build" backHref="/builds" />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar 
        title={`Build #${shortSha(build.id)}`} 
        backHref={build ? `/projects/${build.branch.project_id}/branches/${build.branch_id}/builds` : "/builds"}
      >
        <div className="flex items-center gap-3">
          <BuildStatusBadge status={build.status} size="md" />
          {isCancellable ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-400"
              onClick={handleCancel}
            >
              <Square size={12} className="fill-current" />
              Stop Build
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-blue-500/20 text-blue-400 hover:bg-blue-500/10 hover:text-blue-400"
              onClick={handleRetry}
            >
              <RotateCcw size={12} />
              Retry Build
            </Button>
          )}
        </div>
      </Topbar>

      <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4">
        {/* Meta row */}
        <div className="grid grid-cols-4 gap-3">
          <MetaCard icon={GitCommit} label="Commit">
            <span className="font-mono text-xs">{shortSha(build.commit_sha)}</span>
            <span className="ml-2 truncate text-[11px] text-[hsl(var(--muted-foreground))]">
              {build.commit_message?.slice(0, 40)}
            </span>
          </MetaCard>
          <MetaCard icon={Clock} label="Duration">
            {formatDuration(build.duration_seconds)}
            {isStreaming && (
              <span className="ml-2 text-[10px] text-blue-400 animate-pulse">running…</span>
            )}
          </MetaCard>
          <MetaCard icon={CheckCircle2} label="Tests">
            {build.test_passed === null ? (
              <span className="text-[hsl(var(--muted-foreground))]">—</span>
            ) : build.test_passed ? (
              <span className="text-emerald-400">✅ {build.test_count ?? 0} passed</span>
            ) : (
              <span className="text-red-400">❌ Failed</span>
            )}
          </MetaCard>
          <MetaCard icon={Terminal} label="Triggered by">
            <span className="capitalize">{build.triggered_by}</span>
            {build.commit_author && (
              <span className="ml-1 text-[11px] text-[hsl(var(--muted-foreground))]">
                by {build.commit_author}
              </span>
            )}
          </MetaCard>
        </div>

        {/* Error banner */}
        {build.error_message && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="font-mono text-xs">{build.error_message}</span>
          </div>
        )}

        {/* Main content: log (2/3) + pipeline (1/3) */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Build Output — 2/3 */}
          <div className="flex-[2] min-w-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[#0d1117] overflow-hidden">
            {/* Log toolbar */}
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] bg-[#161b22] px-4 py-2">
              <Terminal size={13} className="text-[hsl(var(--muted-foreground))]" />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Build Output</span>
              {isStreaming && (
                <span className="flex items-center gap-1.5 text-[11px] text-blue-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                  Live
                </span>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-[hsl(var(--muted-foreground))]">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="h-3 w-3 accent-[hsl(var(--primary))]"
                  />
                  Auto-scroll
                </label>
                <button
                  onClick={downloadLogs}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))] transition-colors"
                >
                  <Download size={10} /> Download
                </button>
              </div>
            </div>

            {/* Log content */}
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5"
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
                setAutoScroll(atBottom);
              }}
            >
              {logs.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-zinc-600">
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border border-zinc-600 border-t-zinc-400" />
                  Waiting for build output…
                </div>
              ) : (
                logs.map((line, i) => (
                  <LogLine key={i} line={line} index={i} />
                ))
              )}
            </div>
          </div>

          {/* Pipeline — 1/3 */}
          <div className="flex-[1] min-w-0 flex flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-4 py-2">
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Pipeline</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <BuildTimeline status={build.status} logs={logs} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Log line renderer ──────────────────────────────────────────

function LogLine({ line, index }: { line: string; index: number }) {
  const trimmed = line.trimEnd();

  const color =
    trimmed.includes("💥") || trimmed.includes("FAILED") || trimmed.toLowerCase().includes("error")
      ? "text-red-400"
      : trimmed.includes("✅") || trimmed.includes("SUCCESS") || trimmed.includes("success")
      ? "text-emerald-400"
      : trimmed.includes("❌") || trimmed.includes("failed")
      ? "text-red-400"
      : trimmed.includes("⚠️") || trimmed.toLowerCase().includes("warning")
      ? "text-yellow-400"
      : trimmed.includes("🚀") || trimmed.includes("🎉") || trimmed.includes("📥")
      ? "text-violet-400"
      : "text-zinc-300";

  return (
    <div className="flex items-start gap-3 font-mono text-[12px] leading-relaxed hover:bg-white/5 rounded px-1 -mx-1">
      <span className="shrink-0 select-none text-[10px] text-zinc-700 w-8 text-right pt-0.5">
        {index + 1}
      </span>
      <span className={cn("flex-1 whitespace-pre-wrap break-all", color)}>{trimmed || " "}</span>
    </div>
  );
}

// ── Meta card ─────────────────────────────────────────────────

function MetaCard({
  icon: Icon, label, children,
}: {
  icon: React.ElementType; label: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-1.5">
        <Icon size={10} />
        {label}
      </div>
      <div className="flex items-center text-sm font-medium text-[hsl(var(--foreground))]">
        {children}
      </div>
    </div>
  );
}
