import { type BuildStatus, type EnvironmentType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  CheckCircle2, XCircle, Clock, Loader2,
  Ban, GitBranch, Layers, Zap
} from "lucide-react";

// ── Build Status Badge ─────────────────────────────────────────

const STATUS_CONFIG: Record<BuildStatus, { label: string; icon: React.ElementType; class: string }> = {
  pending:   { label: "Pending",   icon: Clock,      class: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20" },
  building:  { label: "Building",  icon: Loader2,    class: "text-blue-400 bg-blue-400/10 border-blue-400/20 animate-pulse" },
  success:   { label: "Success",   icon: CheckCircle2, class: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  failed:    { label: "Failed",    icon: XCircle,    class: "text-red-400 bg-red-400/10 border-red-400/20" },
  cancelled: { label: "Cancelled", icon: Ban,        class: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20" },
};

export function BuildStatusBadge({ status, size = "sm" }: { status: BuildStatus; size?: "xs" | "sm" | "md" }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const sizeClass = size === "xs" ? "text-[11px] px-1.5 py-0.5 gap-1" : size === "md" ? "text-sm px-3 py-1 gap-1.5" : "text-xs px-2 py-0.5 gap-1";
  const iconSize = size === "xs" ? 10 : size === "md" ? 15 : 12;
  return (
    <span className={cn("inline-flex items-center rounded-full border font-medium", sizeClass, cfg.class)}>
      <Icon size={iconSize} className={status === "building" ? "animate-spin" : ""} />
      {cfg.label}
    </span>
  );
}

// ── Environment Badge ──────────────────────────────────────────

const ENV_CONFIG: Record<EnvironmentType, { label: string; class: string }> = {
  development: { label: "Dev",     class: "text-violet-400 bg-violet-400/10 border-violet-400/20" },
  staging:     { label: "Staging", class: "text-amber-400 bg-amber-400/10 border-amber-400/20" },
  production:  { label: "Prod",    class: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
};

export function EnvironmentBadge({ env }: { env: EnvironmentType }) {
  const cfg = ENV_CONFIG[env] || ENV_CONFIG.development;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", cfg.class)}>
      <Layers size={10} />
      {cfg.label}
    </span>
  );
}

// ── Odoo Version Badge ─────────────────────────────────────────

export function OdooVersionBadge({ version }: { version: string | null }) {
  if (!version) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-400">
      <Zap size={10} />
      Odoo {version}
    </span>
  );
}

// ── Status Dot (minimal) ───────────────────────────────────────

export function StatusDot({ status }: { status: BuildStatus }) {
  const colors: Record<BuildStatus, string> = {
    pending:   "bg-yellow-400",
    building:  "bg-blue-400 animate-pulse-dot",
    success:   "bg-emerald-400",
    failed:    "bg-red-400",
    cancelled: "bg-zinc-500",
  };
  return (
    <span className={cn("inline-block h-2 w-2 rounded-full", colors[status] || colors.pending)} />
  );
}
