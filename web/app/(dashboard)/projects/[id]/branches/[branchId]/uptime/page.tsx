"use client";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { uptimeApi, branchesApi } from "@/lib/api";
import { UptimeCheck, Branch } from "@/lib/types";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Skeleton, EmptyState } from "@/components/ui/primitives";
import { formatTimeAgo } from "@/lib/utils";
import { Activity } from "lucide-react";

function UptimeDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    up: "bg-emerald-400",
    down: "bg-red-500",
    unknown: "bg-zinc-500",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] ?? "bg-zinc-500"}`} />;
}

export default function BranchUptimePage() {
  const { id: projectId, branchId } = useParams<{ id: string; branchId: string }>();

  const { data: branch } = useQuery<Branch>({
    queryKey: ["branch", projectId, branchId],
    queryFn: () => branchesApi.get(projectId, branchId).then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: history, isLoading } = useQuery<UptimeCheck[]>({
    queryKey: ["uptime-history", branchId],
    queryFn: () => uptimeApi.getBranchHistory(branchId).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const upCount = history?.filter((c) => c.status === "up").length ?? 0;
  const total = history?.length ?? 0;
  const uptimePct = total > 0 ? ((upCount / total) * 100).toFixed(1) : null;

  return (
    <>
      <Topbar title="Uptime Monitor" backHref={`/projects/${projectId}`} />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Summary */}
        {branch && (
          <Card className="p-4 flex items-center gap-6">
            <div className="flex items-center gap-3">
              <UptimeDot status={branch.uptime_status} />
              <div>
                <p className="text-sm font-bold capitalize">{branch.uptime_status}</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                  {branch.uptime_last_checked_at ? `Last checked ${formatTimeAgo(branch.uptime_last_checked_at)}` : "Not yet checked"}
                </p>
              </div>
            </div>
            {branch.uptime_response_ms !== null && (
              <div className="border-l border-[hsl(var(--border))] pl-6">
                <p className="text-sm font-bold">{branch.uptime_response_ms}ms</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Response time</p>
              </div>
            )}
            {uptimePct !== null && (
              <div className="border-l border-[hsl(var(--border))] pl-6">
                <p className="text-sm font-bold">{uptimePct}%</p>
                <p className="text-[10px] text-[hsl(var(--muted-foreground))]">Uptime (last {total} checks)</p>
              </div>
            )}
          </Card>
        )}

        {/* Sparkline */}
        {history && history.length > 0 && (
          <Card className="p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase text-[hsl(var(--muted-foreground))] tracking-wider">Check History</p>
            <div className="flex items-end gap-0.5 h-10 overflow-hidden">
              {[...history].reverse().map((c) => (
                <div
                  key={c.id}
                  title={`${c.status} · ${c.response_ms != null ? c.response_ms + "ms" : "timeout"} · ${formatTimeAgo(c.checked_at)}`}
                  className={`flex-1 min-w-[2px] rounded-sm transition-all ${
                    c.status === "up" ? "bg-emerald-400" :
                    c.status === "down" ? "bg-red-500" : "bg-zinc-600"
                  }`}
                  style={{
                    height: c.response_ms
                      ? `${Math.min(100, Math.max(20, 100 - (c.response_ms / 5000) * 80))}%`
                      : "15%",
                  }}
                />
              ))}
            </div>
            <p className="text-[9px] text-[hsl(var(--muted-foreground))]">
              Bar height reflects response time (taller = faster). Red = down, green = up.
            </p>
          </Card>
        )}

        {/* History table */}
        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !history?.length ? (
          <EmptyState icon={Activity} title="No uptime data yet" description="Checks run every 60 seconds for running containers." />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] text-[10px] uppercase">
                  <th className="text-left p-3 font-bold">Status</th>
                  <th className="text-left p-3 font-bold">Response</th>
                  <th className="text-left p-3 font-bold">Error</th>
                  <th className="text-left p-3 font-bold">Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--secondary)/0.3)]">
                    <td className="p-3">
                      <span className="flex items-center gap-2">
                        <UptimeDot status={c.status} />
                        <span className={`font-bold ${c.status === "up" ? "text-emerald-400" : c.status === "down" ? "text-red-400" : "text-zinc-400"}`}>
                          {c.status.toUpperCase()}
                        </span>
                      </span>
                    </td>
                    <td className="p-3 font-mono">{c.response_ms != null ? `${c.response_ms}ms` : "—"}</td>
                    <td className="p-3 text-[hsl(var(--muted-foreground))] max-w-[200px] truncate">{c.error || "—"}</td>
                    <td className="p-3 text-[hsl(var(--muted-foreground))]">{formatTimeAgo(c.checked_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
