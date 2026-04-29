"use client";
import { cn } from "@/lib/utils";
import { BuildStatus } from "@/lib/types";
import {
  CheckCircle2, Loader2, XCircle, AlertTriangle,
  ShieldCheck, Rocket, TestTube, Wrench,
  Container, Terminal, SkipForward,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

type StepStatus = "pending" | "running" | "success" | "warning" | "error" | "skipped";

interface JobState {
  name: string;
  type: "docker" | "opsway" | "exec" | "unknown";
  status: StepStatus;
  detail?: string;
}

interface StageState {
  name: string;
  status: StepStatus;
  jobs: JobState[];
}

// ── Parsing ──────────────────────────────────────────────────────

function parseJobStatus(logs: string[], jobName: string): StepStatus | null {
  for (const line of logs) {
    if (line.includes(`✅ [${jobName}]`)) return "success";
    if (line.includes(`⚠️`) && line.includes(`[${jobName}]`)) return "warning";
    if (line.includes(`❌`) && line.includes(`[${jobName}]`)) return "error";
  }
  return null;
}

// Heuristic: which stage was active when this job started?
function stageNameForJob(jobName: string, logs: string[]): string | null {
  let currentStage: string | null = null;
  for (const line of logs) {
    const sm = line.match(/▶\s*Stage:\s*(\S+)/);
    if (sm) currentStage = sm[1];
    if (
      line.includes(`[${jobName}]`) &&
      (line.includes("🐳") || line.includes("🚀") || line.includes("🔧") || line.includes("when=manual"))
    ) {
      return currentStage;
    }
  }
  return null;
}

function parsePipeline(
  logs: string[],
  buildStatus: BuildStatus,
  isStreaming: boolean,
): StageState[] {
  // 1. Extract stage order from "📋 Pipeline: a → b → c"
  const pipelineLine = logs.find((l) => l.includes("Pipeline:"));
  if (!pipelineLine) return [];
  const m = pipelineLine.match(/Pipeline:\s*(.+)/);
  if (!m) return [];
  const stageNames = m[1].split("→").map((s) => s.trim()).filter(Boolean);
  if (stageNames.length === 0) return [];

  // 2. Collect started stages in order
  const startedStages: string[] = [];
  for (const line of logs) {
    const sm = line.match(/▶\s*Stage:\s*(\S+)/);
    if (sm && !startedStages.includes(sm[1])) startedStages.push(sm[1]);
  }

  // 3. Skipped stages
  const skippedStages = new Set<string>();
  for (const line of logs) {
    const sk = line.match(/⏭.*\[([^\]]+)\].*skipped/);
    if (sk) skippedStages.add(sk[1]);
  }

  // 4. Collect jobs per stage
  const stageJobs: Record<string, JobState[]> = {};

  function addJob(stage: string | null, job: JobState) {
    if (!stage) return;
    stageJobs[stage] = stageJobs[stage] || [];
    if (!stageJobs[stage].find((j) => j.name === job.name)) {
      stageJobs[stage].push(job);
    }
  }

  for (const line of logs) {
    const docker = line.match(/🐳 \[([^\]]+)\] image=(\S+)/);
    if (docker) {
      const [, name, image] = docker;
      addJob(stageNameForJob(name, logs), { name, type: "docker", status: "running", detail: image });
      continue;
    }
    const opsway = line.match(/🚀 \[([^\]]+)\] Deploying to ([^.]+)/);
    if (opsway) {
      const [, name, env] = opsway;
      addJob(stageNameForJob(name, logs), { name, type: "opsway", status: "running", detail: `env: ${env.trim()}` });
      continue;
    }
    const exec = line.match(/🔧 \[([^\]]+)\] \$/);
    if (exec) {
      const [, name] = exec;
      addJob(stageNameForJob(name, logs), { name, type: "exec", status: "running", detail: "exec: odoo" });
      continue;
    }
    const manual = line.match(/\[([^\]]+)\] when=manual/);
    if (manual) {
      const [, name] = manual;
      addJob(stageNameForJob(name, logs), { name, type: "unknown", status: "skipped", detail: "manual" });
    }
  }

  // 5. Resolve job statuses from completion lines
  for (const jobs of Object.values(stageJobs)) {
    for (const job of jobs) {
      if (job.status === "skipped") continue;
      const resolved = parseJobStatus(logs, job.name);
      if (resolved) job.status = resolved;
    }
  }

  // 6. Determine if build is still live
  const isFinalStatus = buildStatus === "success" || buildStatus === "failed" || buildStatus === "cancelled";
  const isLive = isStreaming || (!isFinalStatus);

  // 7. Build stage status — key logic:
  //    A stage is DONE when ALL its non-skipped jobs have a final status.
  //    A stage is RUNNING when it has started but is not yet done and build is live.
  function stageIsDone(jobs: JobState[]): boolean {
    const active = jobs.filter((j) => j.status !== "skipped");
    if (active.length === 0) return false; // no jobs detected yet → still running
    return active.every((j) => j.status !== "running");
  }

  return stageNames.map((name, i) => {
    if (skippedStages.has(name)) return { name, status: "skipped" as StepStatus, jobs: [] };
    if (!startedStages.includes(name)) return { name, status: "pending" as StepStatus, jobs: [] };

    const jobs = stageJobs[name] || [];
    const hasWarning = jobs.some((j) => j.status === "warning");
    const hasError = jobs.some((j) => j.status === "error");
    const nextHasStarted = stageNames.slice(i + 1).some((n) => startedStages.includes(n));

    // Stage is done if: next stage started, OR all jobs resolved, OR build finished
    const done = nextHasStarted || stageIsDone(jobs) || isFinalStatus;

    if (!done && isLive) {
      return { name, status: "running" as StepStatus, jobs };
    }

    // Final status
    if (buildStatus === "failed" && !nextHasStarted && !stageIsDone(jobs)) {
      return { name, status: "error" as StepStatus, jobs };
    }
    return {
      name,
      status: (hasError ? "error" : hasWarning ? "warning" : "success") as StepStatus,
      jobs,
    };
  });
}

// ── Icon helpers ─────────────────────────────────────────────────

function stageIcon(name: string) {
  if (name.includes("quality") || name.includes("lint")) return ShieldCheck;
  if (name.includes("deploy")) return Rocket;
  if (name.includes("test")) return TestTube;
  return Wrench;
}

function jobTypeIcon(type: JobState["type"]) {
  if (type === "docker") return Container;
  if (type === "opsway") return Rocket;
  if (type === "exec") return Terminal;
  return Wrench;
}

// ── Status indicator ─────────────────────────────────────────────

function StatusIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  if (status === "success") return <CheckCircle2 size={size} className="text-emerald-500" />;
  if (status === "warning") return <AlertTriangle size={size} className="text-yellow-400" />;
  if (status === "error") return <XCircle size={size} className="text-red-500" />;
  if (status === "running") return <Loader2 size={size} className="text-blue-400 animate-spin" />;
  if (status === "skipped") return <SkipForward size={size} className="text-zinc-600" />;
  return <div style={{ width: size, height: size }} className="rounded-full border border-zinc-700" />;
}

// ── Component ────────────────────────────────────────────────────

interface Props {
  status: BuildStatus;
  isStreaming: boolean;
  logs: string[];
  className?: string;
}

export function BuildTimeline({ status, isStreaming, logs, className }: Props) {
  const stages = parsePipeline(logs, status, isStreaming);
  if (stages.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {stages.map((stage, si) => {
        const SIcon = stageIcon(stage.name);
        const isLast = si === stages.length - 1;

        return (
          <div key={stage.name} className="flex gap-3">
            {/* Connector column */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                  stage.status === "success" && "border-emerald-500 bg-emerald-500/10 text-emerald-500",
                  stage.status === "warning" && "border-yellow-500 bg-yellow-500/10 text-yellow-400",
                  stage.status === "error" && "border-red-500 bg-red-500/10 text-red-500",
                  stage.status === "running" && "border-blue-500 bg-blue-500/10 text-blue-400",
                  stage.status === "skipped" && "border-zinc-700 bg-zinc-800 text-zinc-600",
                  stage.status === "pending" && "border-zinc-700 bg-zinc-900 text-zinc-600",
                )}
              >
                {stage.status === "running" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <SIcon size={13} />
                )}
              </div>
              {!isLast && (
                <div
                  className={cn(
                    "w-[2px] flex-1 mt-1",
                    stage.status === "success" && "bg-emerald-500/40",
                    stage.status === "warning" && "bg-yellow-500/40",
                    stage.status === "error" && "bg-red-500/40",
                    (stage.status === "running" || stage.status === "pending" || stage.status === "skipped") && "bg-zinc-700",
                  )}
                />
              )}
            </div>

            {/* Stage header + jobs */}
            <div className={cn("flex flex-col pb-3 flex-1", isLast && "pb-0")}>
              <div className="flex items-center gap-2 h-7">
                <span
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wider",
                    stage.status === "success" && "text-emerald-400",
                    stage.status === "warning" && "text-yellow-400",
                    stage.status === "error" && "text-red-400",
                    stage.status === "running" && "text-blue-400",
                    (stage.status === "pending" || stage.status === "skipped") && "text-zinc-500",
                  )}
                >
                  {stage.name.replace(/_/g, " ")}
                </span>
                {stage.status === "skipped" && (
                  <span className="text-[10px] text-zinc-600 italic">skipped</span>
                )}
              </div>

              {stage.jobs.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  {stage.jobs.map((job, ji) => {
                    const JIcon = jobTypeIcon(job.type);
                    return (
                      <div
                        key={`${job.name}-${ji}`}
                        className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-1.5"
                      >
                        <JIcon size={12} className="shrink-0 text-zinc-500" />
                        <span className="text-[11px] font-mono text-zinc-300 flex-1">{job.name}</span>
                        {job.detail && (
                          <span className="text-[10px] text-zinc-600 font-mono">{job.detail}</span>
                        )}
                        <StatusIcon status={job.status} size={13} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
