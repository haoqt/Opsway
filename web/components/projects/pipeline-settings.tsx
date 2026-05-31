"use client";
import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPipelineConfig, updatePipelineConfig, projectsApi } from "@/lib/api";
import { PipelineConfig, PipelineStage, PipelineJob, Project } from "@/lib/types";
import { Card, Button, Input, Select } from "@/components/ui/primitives";
import {
  Settings, CheckCircle2, Plus, Trash2, GripVertical,
  Server, Database, Package, Settings2, ChevronDown, ChevronUp
} from "lucide-react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";

export function PipelineSettings({ project }: { project: Project }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["pipeline-config", project.id],
    queryFn: () => getPipelineConfig(project.id).then((r) => r.data as { config: PipelineConfig }),
  });

  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [odooForm, setOdooForm] = useState({
    odoo_version: project.odoo_version || "17",
    postgres_version: project.postgres_version || "postgres:16-alpine",
    custom_addons_path: project.custom_addons_path || "custom_addons",
    odoo_workers: project.odoo_workers || 2,
    odoo_image_override: project.odoo_image_override || "",
  });

  const isOdooDirty =
    odooForm.odoo_version !== (project.odoo_version || "17") ||
    odooForm.postgres_version !== (project.postgres_version || "postgres:16-alpine") ||
    odooForm.custom_addons_path !== (project.custom_addons_path || "custom_addons") ||
    odooForm.odoo_workers !== (project.odoo_workers || 2) ||
    odooForm.odoo_image_override !== (project.odoo_image_override || "");

  useEffect(() => {
    if (data?.config && !isDirty && !isOdooDirty) {
      const stages = data.config.stages ? [...data.config.stages] : [];
      if (!stages.some((s) => s.name === "deploy")) {
        stages.push({ name: "deploy", jobs: [] });
      }
      setConfig({ stages });
    }
  }, [data, isDirty, isOdooDirty]);

  // Sync Odoo form when project prop changes from backend reload
  useEffect(() => {
    if (!isOdooDirty) {
      setOdooForm({
        odoo_version: project.odoo_version || "17",
        postgres_version: project.postgres_version || "postgres:16-alpine",
        custom_addons_path: project.custom_addons_path || "custom_addons",
        odoo_workers: project.odoo_workers || 2,
        odoo_image_override: project.odoo_image_override || "",
      });
    }
  }, [project, isOdooDirty]);

  const { mutate: saveConfig, isPending: saving } = useMutation({
    mutationFn: async (newConfig: PipelineConfig) => {
      await Promise.all([
        updatePipelineConfig(project.id, newConfig),
        projectsApi.update(project.id, {
          odoo_version: odooForm.odoo_version,
          postgres_version: odooForm.postgres_version,
          custom_addons_path: odooForm.custom_addons_path,
          odoo_workers: odooForm.odoo_workers,
          odoo_image_override: odooForm.odoo_image_override || null,
        }),
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-config", project.id] });
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      setIsDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination || !config) return;
    const items = Array.from(config.stages);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setConfig({ ...config, stages: items });
    setIsDirty(true);
  };

  const addStage = () => {
    if (!config) return;
    const newStageName = `Stage ${config.stages.length + 1}`;
    setConfig({ ...config, stages: [...config.stages, { name: newStageName, jobs: [] }] });
    setIsDirty(true);
  };

  const updateStageName = (index: number, name: string) => {
    if (!config) return;
    const newStages = [...config.stages];
    newStages[index].name = name;
    setConfig({ ...config, stages: newStages });
    setIsDirty(true);
  };

  const removeStage = (index: number) => {
    if (!config) return;
    const newStages = [...config.stages];
    newStages.splice(index, 1);
    setConfig({ ...config, stages: newStages });
    setIsDirty(true);
  };

  const addJob = (stageIndex: number) => {
    if (!config) return;
    const newStages = [...config.stages];
    newStages[stageIndex].jobs.push({
      name: `job_${Date.now().toString().slice(-4)}`,
      image: "python:3.10-slim",
      script: ["echo 'Hello Opsway'"],
      allow_failure: false,
      when: "auto",
      exec_in: null,
    });
    setConfig({ ...config, stages: newStages });
    setIsDirty(true);
  };

  const updateJob = (stageIndex: number, jobIndex: number, field: keyof PipelineJob, value: any) => {
    if (!config) return;
    const newStages = [...config.stages];
    newStages[stageIndex].jobs[jobIndex] = { ...newStages[stageIndex].jobs[jobIndex], [field]: value };
    setConfig({ ...config, stages: newStages });
    setIsDirty(true);
  };

  const removeJob = (stageIndex: number, jobIndex: number) => {
    if (!config) return;
    const newStages = [...config.stages];
    newStages[stageIndex].jobs.splice(jobIndex, 1);
    setConfig({ ...config, stages: newStages });
    setIsDirty(true);
  };

  const setOdoo = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setOdooForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const setOdooNum = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setOdooForm((f) => ({ ...f, [k]: parseInt(e.target.value) || 0 }));
  };

  if (isLoading || !config) return <div className="p-4 text-xs">Loading pipeline config...</div>;

  const totalDirty = isDirty || isOdooDirty;

  return (
    <Card className="p-4 space-y-4 shadow-sm border-[hsl(var(--border))]">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
            <Settings size={12} />
            Pipeline Editor
          </h3>
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
            Drag and drop to reorder stages. Configure scripts or environment settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalDirty && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
              Unsaved changes
            </span>
          )}
          <Button
            size="sm"
            onClick={() => saveConfig(config)}
            disabled={!totalDirty || saving}
            loading={saving}
          >
            {saved ? <><CheckCircle2 size={12} className="mr-1" /> Saved!</> : "Save Pipeline"}
          </Button>
        </div>
      </div>

      <div className="bg-black/10 rounded-md p-3 border border-[hsl(var(--border))]">
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="pipeline-stages">
            {(provided) => (
              <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-3">
                {config.stages.length === 0 && (
                  <div className="text-[11px] text-center text-zinc-500 py-8 italic border border-dashed border-zinc-700/50 rounded">
                    No stages defined. Add a stage to begin (e.g. code_quality).
                  </div>
                )}
                
                {config.stages.map((stage, sIdx) => {
                  const isDeploy = stage.name.toLowerCase() === "deploy";
                  return (
                    <Draggable key={`stage-${sIdx}`} draggableId={`stage-${sIdx}`} index={sIdx}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-md overflow-hidden shadow-sm ${isDeploy ? "ring-1 ring-violet-500/30" : ""}`}
                        >
                          {/* Stage Header */}
                          <div className={`flex items-center gap-2 p-2 border-b border-[hsl(var(--border))] ${isDeploy ? "bg-violet-500/5" : "bg-black/20"}`}>
                            <div {...provided.dragHandleProps} className="cursor-grab hover:text-white text-zinc-500">
                              <GripVertical size={14} />
                            </div>
                            <Input
                              value={stage.name}
                              onChange={(e) => updateStageName(sIdx, e.target.value)}
                              disabled={isDeploy}
                              className={`h-6 w-48 text-[11px] font-mono ${isDeploy ? "border-none bg-transparent shadow-none px-0 text-violet-300 font-bold opacity-100" : ""}`}
                              placeholder="Stage Name"
                            />
                            {isDeploy && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-medium">System Stage</span>
                            )}
                            <div className="flex-1" />
                            {!isDeploy && (
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400/70 hover:text-red-400 hover:bg-red-400/10" onClick={() => removeStage(sIdx)}>
                                <Trash2 size={12} />
                              </Button>
                            )}
                          </div>

                          {/* Jobs or Odoo Settings List */}
                          <div className="p-2 space-y-2">
                            {isDeploy ? (
                              <div className="p-2 bg-black/10 rounded border border-[hsl(var(--border))] space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                  {/* Odoo Version */}
                                  <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                                      <Package size={10} className="text-violet-400" /> Odoo Version
                                    </label>
                                    <Select value={odooForm.odoo_version} onChange={setOdoo("odoo_version")} className="w-full h-8 text-[11px]">
                                      <option value="15">Odoo 15.0</option>
                                      <option value="16">Odoo 16.0</option>
                                      <option value="17">Odoo 17.0</option>
                                      <option value="18">Odoo 18.0</option>
                                    </Select>
                                  </div>

                                  {/* PostgreSQL Version */}
                                  <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))] flex items-center gap-1.5">
                                      <Database size={10} className="text-sky-400" /> PostgreSQL Version
                                    </label>
                                    <Select value={odooForm.postgres_version} onChange={setOdoo("postgres_version")} className="w-full h-8 text-[11px]">
                                      <option value="postgres:14-alpine">PostgreSQL 14</option>
                                      <option value="postgres:15-alpine">PostgreSQL 15</option>
                                      <option value="postgres:16-alpine">PostgreSQL 16</option>
                                      <option value="postgres:17-alpine">PostgreSQL 17</option>
                                    </Select>
                                  </div>

                                  {/* Custom Addons Path */}
                                  <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                                      Custom Addons Path
                                    </label>
                                    <input
                                      type="text"
                                      placeholder="custom_addons"
                                      className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-2 text-[11px] text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                      value={odooForm.custom_addons_path}
                                      onChange={setOdoo("custom_addons_path")}
                                    />
                                  </div>

                                  {/* Workers */}
                                  <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                                      Workers
                                    </label>
                                    <input
                                      type="number"
                                      min={0}
                                      max={16}
                                      className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-2 text-[11px] text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                      value={odooForm.odoo_workers}
                                      onChange={setOdooNum("odoo_workers")}
                                    />
                                  </div>
                                </div>

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
                                        <label className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
                                          Custom Odoo Image
                                        </label>
                                        <input
                                          type="text"
                                          placeholder="e.g. myregistry.io/odoo:17.0-custom (leave empty for official)"
                                          className="h-8 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-2 text-[11px] font-mono text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                                          value={odooForm.odoo_image_override}
                                          onChange={setOdoo("odoo_image_override")}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <>
                                {stage.jobs.map((job, jIdx) => (
                                  <div key={`job-${sIdx}-${jIdx}`} className="border border-zinc-700/50 rounded bg-black/10 p-2 flex gap-3">
                                    <div className="flex-1 space-y-2">
                                      <div className="flex items-center gap-2">
                                        <Input 
                                          value={job.name} 
                                          onChange={(e) => updateJob(sIdx, jIdx, "name", e.target.value)} 
                                          className="h-6 w-32 text-[10px] font-mono bg-black/20" 
                                          placeholder="Job Name" 
                                        />
                                        <select 
                                          className="h-6 text-[10px] bg-black/20 border border-zinc-700 rounded px-1 text-zinc-300 focus:outline-none"
                                          value={job.exec_in || "docker"}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === "odoo") {
                                              updateJob(sIdx, jIdx, "exec_in", "odoo");
                                              updateJob(sIdx, jIdx, "image", null);
                                            } else {
                                              updateJob(sIdx, jIdx, "exec_in", null);
                                              updateJob(sIdx, jIdx, "image", "python:3.10-slim");
                                            }
                                          }}
                                        >
                                          <option value="docker">New Docker Container</option>
                                          <option value="odoo">Exec in Odoo Container</option>
                                        </select>
                                        {!job.exec_in && (
                                          <Input 
                                            value={job.image || ""} 
                                            onChange={(e) => updateJob(sIdx, jIdx, "image", e.target.value)} 
                                            className="h-6 w-48 text-[10px] font-mono bg-black/20" 
                                            placeholder="Image (e.g. python:3.10-slim)" 
                                          />
                                        )}
                                        <label className="flex items-center gap-1 text-[10px] text-zinc-400 cursor-pointer ml-2">
                                          <input 
                                            type="checkbox" 
                                            checked={job.allow_failure} 
                                            onChange={(e) => updateJob(sIdx, jIdx, "allow_failure", e.target.checked)}
                                            className="rounded bg-black/20 border-zinc-700"
                                          />
                                          Allow failure
                                        </label>
                                      </div>
                                      <textarea
                                        className="w-full font-mono text-[10px] bg-black/30 text-[hsl(var(--foreground)/0.85)] p-2 rounded border border-zinc-700/50 focus:outline-none focus:border-[hsl(var(--primary)/0.5)] resize-y min-h-[60px]"
                                        value={(job.script || []).join("\n")}
                                        onChange={(e) => updateJob(sIdx, jIdx, "script", e.target.value.split("\n"))}
                                        placeholder="Commands to execute..."
                                        spellCheck={false}
                                      />
                                    </div>
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-zinc-500 hover:text-red-400 mt-1" onClick={() => removeJob(sIdx, jIdx)}>
                                      <Trash2 size={12} />
                                    </Button>
                                  </div>
                                ))}
                                <Button variant="outline" size="sm" className="h-6 text-[10px] border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-200" onClick={() => addJob(sIdx)}>
                                  <Plus size={10} className="mr-1" /> Add Job
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={addStage}>
            <Plus size={12} className="mr-1" /> Add Stage
          </Button>
        </div>
      </div>
    </Card>
  );
}
