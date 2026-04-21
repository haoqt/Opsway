"use client";
import { useQuery } from "@tanstack/react-query";
import { monitoringApi } from "@/lib/api";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Skeleton } from "@/components/ui/primitives";
import { Activity, Cpu, Database, HardDrive, Server, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MonitoringPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ["monitoring-stats"],
    queryFn: () => monitoringApi.getStats().then((r) => r.data),
    refetchInterval: 5_000,
  });

  return (
    <>
      <Topbar title="System Monitoring" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            title="System Status"
            value="Healthy"
            icon={Activity}
            status="success"
            loading={isLoading}
          />
          <StatCard
            title="Project Instances"
            value={stats?.instances_count ?? 0}
            icon={Server}
            loading={isLoading}
          />
          <StatCard
            title="System Services"
            value={stats?.services_count ?? 0}
            icon={Database}
            loading={isLoading}
          />
          <StatCard
            title="Active Hubs"
            value={stats?.active_containers ?? 0}
            icon={CheckCircle2}
            loading={isLoading}
          />
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2 mb-6">
              <Cpu size={16} /> Resource Usage
            </h3>
            
            <div className="space-y-6">
              <UsageBar label="Opsway CPU" value={stats?.cpu ?? 0} color="bg-blue-500" loading={isLoading} />
              <UsageBar label="Opsway Memory" value={stats?.memory ?? 0} color="bg-violet-500" loading={isLoading} />
              <div className="h-px bg-[hsl(var(--border))] my-1 opacity-50" />
              <UsageBar label="System CPU (Total)" value={stats?.system_cpu ?? 0} color="bg-zinc-600" loading={isLoading} />
              <UsageBar label="System Memory (Total)" value={stats?.system_memory ?? 0} color="bg-zinc-600" loading={isLoading} />
              <UsageBar label="Disk Space" value={stats?.disk_usage ?? 0} color="bg-emerald-500" loading={isLoading} />
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2 mb-6">
              <Database size={16} /> Services Health
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ServiceStatus name="Control Panel (API)" status={stats?.services_health?.api ?? "offline"} />
              <ServiceStatus name="Build Engine (Worker)" status={stats?.services_health?.worker ?? "offline"} />
              <ServiceStatus name="Scheduler (Beat)" status={stats?.services_health?.beat ?? "offline"} />
              <ServiceStatus name="Metadata (Postgres)" status={stats?.services_health?.postgres ?? "offline"} />
              <ServiceStatus name="Broker (Redis)" status={stats?.services_health?.redis ?? "offline"} />
              <ServiceStatus name="Storage (MinIO)" status={stats?.services_health?.minio ?? "offline"} />
              <ServiceStatus name="Inbound (Traefik)" status={stats?.services_health?.traefik ?? "offline"} />
              <ServiceStatus name="Mail Trap (MailHog)" status={stats?.services_health?.mailhog ?? "offline"} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function StatCard({ title, value, icon: Icon, status, loading }: any) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={cn(
        "flex h-12 w-12 items-center justify-center rounded-xl transition-shadow",
        status === "success" ? "bg-emerald-500/10 text-emerald-400 shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]" : "bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]"
      )}>
        <Icon size={24} />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">{title}</p>
        {loading ? <Skeleton className="h-6 w-20 mt-1" /> : <p className="text-xl font-bold text-[hsl(var(--foreground))]">{value}</p>}
      </div>
    </Card>
  );
}

function UsageBar({ label, value, color, loading }: any) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-medium">
        <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
        <span className="text-[hsl(var(--foreground))]">{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
        {loading ? (
           <div className="h-full w-1/3 bg-[hsl(var(--muted-foreground)/0.2)] animate-pulse" />
        ) : (
          <div
            className={cn("h-full transition-all duration-1000 ease-out", color)}
            style={{ width: `${value}%` }}
          />
        )}
      </div>
    </div>
  );
}

function ServiceStatus({ name, status }: { name: string; status: "online" | "offline" }) {
  const isOnline = status === "online";
  return (
    <div className="flex items-center justify-between rounded-lg bg-[hsl(var(--secondary)/0.5)] p-3 border border-[hsl(var(--border))]">
      <span className="text-xs font-medium text-[hsl(var(--foreground))]">{name}</span>
      <div className={cn(
        "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight",
        isOnline ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
      )}>
        <span className={cn("h-1 w-1 rounded-full", isOnline ? "bg-emerald-400 animate-pulse" : "bg-red-400")} />
        {status}
      </div>
    </div>
  );
}
