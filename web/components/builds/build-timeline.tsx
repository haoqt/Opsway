"use client";
import { cn } from "@/lib/utils";
import { BuildStatus } from "@/lib/types";
import { 
  CheckCircle2, Clock, Loader2, XCircle, 
  ChevronRight, GitPullRequest, Container, TestTube
} from "lucide-react";

interface Step {
  id: string;
  label: string;
  status: "pending" | "current" | "success" | "error";
  icon: any;
}

interface Props {
  status: BuildStatus;
  className?: string;
}

export function BuildTimeline({ status, className }: Props) {
  const steps: Step[] = [
    {
      id: "clone",
      label: "Git Checkout",
      status: status === "pending" ? "pending" : (status === "building" ? "current" : (status === "failed" ? "error" : "success")),
      icon: GitPullRequest,
    },
    {
      id: "provision",
      label: "Provisioning",
      status: ["success", "failed", "cancelled"].includes(status) ? "success" : (status === "building" ? "current" : "pending"),
      icon: Container,
    },
    {
      id: "test",
      label: "Unit Tests",
      status: ["success"].includes(status) ? "success" : (status === "failed" ? "error" : "pending"),
      icon: TestTube,
    },
    {
      id: "finish",
      label: "Ready",
      status: status === "success" ? "success" : (status === "failed" ? "error" : "pending"),
      icon: CheckCircle2,
    },
  ];

  return (
    <div className={cn("flex items-center justify-between gap-2 py-4", className)}>
      {steps.map((step, i) => (
        <div key={step.id} className="flex flex-1 items-center last:flex-none">
          <div className="flex flex-col items-center gap-1.5 relative">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                step.status === "success" && "border-emerald-500 bg-emerald-500/10 text-emerald-500",
                step.status === "current" && "border-blue-500 bg-blue-500/10 text-blue-500 animate-pulse",
                step.status === "error" && "border-red-500 bg-red-500/10 text-red-500",
                step.status === "pending" && "border-[hsl(var(--border))] bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]"
              )}
            >
              {step.status === "current" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : step.status === "success" ? (
                <CheckCircle2 size={16} />
              ) : step.status === "error" ? (
                <XCircle size={16} />
              ) : (
                <step.icon size={16} />
              )}
            </div>
            <span
              className={cn(
                "text-[10px] font-medium whitespace-nowrap",
                step.status === "current" ? "text-blue-400" : "text-[hsl(var(--muted-foreground))]"
              )}
            >
              {step.label}
            </span>
          </div>

          {i < steps.length - 1 && (
            <div className="mx-2 h-[2px] flex-1 bg-[hsl(var(--border))] mb-4">
              <div
                className={cn(
                  "h-full bg-emerald-500 transition-all duration-500",
                  step.status === "success" ? "w-full" : "w-0"
                )}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
