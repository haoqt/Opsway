"use client";
import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { projectsApi } from "@/lib/api";
import { Project } from "@/lib/types";
import { Card, Button, Select, Input } from "@/components/ui/primitives";
import {
  Server, Database, Package, Settings2, ChevronDown, ChevronUp,
  CheckCircle2, Save,
} from "lucide-react";

interface Props {
  project: Project;
}

export function OdooProjectSettings({ project }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    odoo_version: project.odoo_version || "17",
    postgres_version: project.postgres_version || "postgres:16-alpine",
    custom_addons_path: project.custom_addons_path || "custom_addons",
    odoo_workers: project.odoo_workers || 2,
    odoo_image_override: project.odoo_image_override || "",
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sync form when project prop changes
  useEffect(() => {
    setForm({
      odoo_version: project.odoo_version || "17",
      postgres_version: project.postgres_version || "postgres:16-alpine",
      custom_addons_path: project.custom_addons_path || "custom_addons",
      odoo_workers: project.odoo_workers || 2,
      odoo_image_override: project.odoo_image_override || "",
    });
  }, [project]);

  const isDirty =
    form.odoo_version !== (project.odoo_version || "17") ||
    form.postgres_version !== (project.postgres_version || "postgres:16-alpine") ||
    form.custom_addons_path !== (project.custom_addons_path || "custom_addons") ||
    form.odoo_workers !== (project.odoo_workers || 2) ||
    form.odoo_image_override !== (project.odoo_image_override || "");

  const { mutate: save, isPending } = useMutation({
    mutationFn: () =>
      projectsApi.update(project.id, {
        odoo_version: form.odoo_version,
        postgres_version: form.postgres_version,
        custom_addons_path: form.custom_addons_path,
        odoo_workers: form.odoo_workers,
        odoo_image_override: form.odoo_image_override || null,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: parseInt(e.target.value) || 0 }));

  return (
    <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <Server size={12} className="text-violet-400" />
          Odoo Settings
        </h3>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
              unsaved changes
            </span>
          )}
          {saved && (
            <span className="text-[9px] text-emerald-400 flex items-center gap-0.5 font-semibold">
              <CheckCircle2 size={9} /> Saved!
            </span>
          )}
        </div>
      </div>

      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        Project-level defaults. Branches can override these settings individually.
      </p>

      {/* Main settings grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Odoo Version */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
            <Package size={10} className="text-violet-400" /> Odoo Version
          </label>
          <Select value={form.odoo_version} onChange={set("odoo_version")} className="w-full">
            <option value="16">Odoo 16.0</option>
            <option value="17">Odoo 17.0</option>
            <option value="18">Odoo 18.0</option>
          </Select>
        </div>

        {/* PostgreSQL Version */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
            <Database size={10} className="text-sky-400" /> PostgreSQL Version
          </label>
          <Select value={form.postgres_version} onChange={set("postgres_version")} className="w-full">
            <option value="postgres:14-alpine">PostgreSQL 14</option>
            <option value="postgres:15-alpine">PostgreSQL 15</option>
            <option value="postgres:16-alpine">PostgreSQL 16</option>
            <option value="postgres:17-alpine">PostgreSQL 17</option>
          </Select>
        </div>

        {/* Custom Addons Path */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
            Custom Addons Path
          </label>
          <input
            type="text"
            placeholder="custom_addons"
            className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            value={form.custom_addons_path}
            onChange={set("custom_addons_path")}
          />
          <p className="text-[9px] text-[hsl(var(--muted-foreground)/0.6)]">Relative path in repo for Odoo addons</p>
        </div>

        {/* Workers */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
            Workers
          </label>
          <input
            type="number"
            min={0}
            max={16}
            className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 text-sm text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            value={form.odoo_workers}
            onChange={setNum("odoo_workers")}
          />
          <p className="text-[9px] text-[hsl(var(--muted-foreground)/0.6)]">0 = multi-threading mode</p>
        </div>
      </div>

      {/* Advanced section */}
      <div className="border-t border-[hsl(var(--border))] pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((s) => !s)}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <Settings2 size={10} />
          Advanced Settings
          {showAdvanced ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>

        {showAdvanced && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">
                Custom Odoo Image
              </label>
              <input
                type="text"
                placeholder="e.g. myregistry.io/odoo:17.0-custom (leave empty for official)"
                className="h-9 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-3 text-sm font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                value={form.odoo_image_override}
                onChange={set("odoo_image_override")}
              />
              <p className="text-[9px] text-[hsl(var(--muted-foreground)/0.6)]">
                Override the default Odoo Docker image for all branches. Branches can further override per-branch.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button
          size="sm"
          className="px-4 text-[11px] font-bold"
          onClick={() => save()}
          loading={isPending}
          disabled={!isDirty}
        >
          {saved ? (
            <>
              <CheckCircle2 size={11} className="mr-1" /> Saved!
            </>
          ) : (
            <>
              <Save size={11} className="mr-1" /> Save Settings
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
