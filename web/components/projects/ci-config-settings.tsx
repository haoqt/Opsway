"use client";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ciConfigApi } from "@/lib/api";
import { CIFiles, CI_FILENAMES } from "@/lib/types";
import { Card, Button } from "@/components/ui/primitives";
import {
  FileCode2, Copy, CheckCircle2, Upload, RotateCcw, Download, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const FILE_HINTS: Record<string, string> = {
  ".opsway.yml": "Pipeline definition — stages, deploy services (database/web), branch mapping.",
  "odoo.conf.template": "Odoo server config. Use ${ODOO_ADMIN_PASSWD}, ${DB_PASSWORD}, ${DB_USER} for secrets (envsubst).",
  ".flake8": "Flake8 code style configuration.",
  ".pre-commit-config.yml": "Pre-commit hooks — flake8, pylint-odoo. Runs in code_quality stage.",
  ".pylintrc": "Pylint with all optional checks (IDE/informational).",
  ".pylintrc-mandatory": "Pylint mandatory checks — blocks merge if violated.",
};

export function CIConfigSettings({
  projectId,
  odooVersion,
}: {
  projectId: string;
  odooVersion?: string | null;
}) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ci-config", projectId],
    queryFn: () => ciConfigApi.getAll(projectId).then((r) => r.data as CIFiles),
  });

  const [activeFile, setActiveFile] = React.useState<string>(CI_FILENAMES[0]);
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [savedFile, setSavedFile] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const fileContent = edits[activeFile] ?? data?.files?.[activeFile] ?? "";
  const isDirty = edits[activeFile] !== undefined && edits[activeFile] !== (data?.files?.[activeFile] ?? "");
  const isCustom = data?.files && activeFile in (data.files ?? {}) &&
    // A file is "from repo" or "manually saved" if it's present in DB — we track this by checking
    // if it differs from the generated default (we can't easily distinguish repo vs manual here,
    // so we just show "Custom" for any file that was saved)
    true;

  const { mutate: saveFile, isPending: saving } = useMutation({
    mutationFn: (content: string) => ciConfigApi.saveFile(projectId, activeFile, content),
    onSuccess: (r) => {
      const updated = r.data as CIFiles;
      qc.setQueryData(["ci-config", projectId], updated);
      setEdits((prev) => { const n = { ...prev }; delete n[activeFile]; return n; });
      setSavedFile(activeFile);
      setTimeout(() => setSavedFile(null), 2500);
    },
  });

  const { mutate: resetFile, isPending: resetting } = useMutation({
    mutationFn: () => ciConfigApi.resetFile(projectId, activeFile),
    onSuccess: (r) => {
      const updated = r.data as CIFiles;
      qc.setQueryData(["ci-config", projectId], updated);
      setEdits((prev) => { const n = { ...prev }; delete n[activeFile]; return n; });
    },
  });

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setEdits((prev) => ({ ...prev, [activeFile]: text }));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDownload = () => {
    const blob = new Blob([fileContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeFile;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fileContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) return null;

  const dirtyFiles = Object.keys(edits).filter(
    (f) => edits[f] !== (data?.files?.[f] ?? "")
  );

  return (
    <Card className="p-4 space-y-3 shadow-sm border-[hsl(var(--border))]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] flex items-center gap-2">
          <FileCode2 size={12} />
          CI Config Files
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[hsl(var(--muted-foreground))]">
            Auto-synced from repo on each build.
          </span>
          {dirtyFiles.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
              {dirtyFiles.length} unsaved
            </span>
          )}
        </div>
      </div>

      {/* File tabs */}
      <div className="flex flex-wrap gap-1">
        {CI_FILENAMES.map((f) => {
          const hasDraft = edits[f] !== undefined && edits[f] !== (data?.files?.[f] ?? "");
          return (
            <button
              key={f}
              onClick={() => setActiveFile(f)}
              className={cn(
                "relative px-2.5 py-1 rounded text-[10px] font-mono border transition-colors",
                activeFile === f
                  ? "bg-[hsl(var(--primary)/0.15)] border-[hsl(var(--primary)/0.4)] text-[hsl(var(--primary))]"
                  : "bg-black/10 border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              {f}
              {hasDraft && (
                <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* File hint */}
      <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
        {FILE_HINTS[activeFile]}
      </p>

      {/* Editor container */}
      <div className="rounded-md border border-[hsl(var(--border))] overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-[hsl(var(--border))] bg-black/20">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))]">
              {activeFile}
            </span>
            {savedFile === activeFile && (
              <span className="text-[9px] text-emerald-400 flex items-center gap-0.5 font-semibold">
                <CheckCircle2 size={9} /> Saved
              </span>
            )}
            {isDirty && savedFile !== activeFile && (
              <span className="text-[9px] text-amber-400 font-semibold">● unsaved</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleCopy}
              title="Copy to clipboard"
            >
              {copied ? <CheckCircle2 size={10} className="mr-1" /> : <Copy size={10} className="mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleDownload}
              title="Download file"
            >
              <Download size={10} className="mr-1" />
              Download
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".yml,.yaml,.conf,.cfg,.ini,text/*"
              onChange={handleUpload}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => fileInputRef.current?.click()}
              title="Upload file to replace content"
            >
              <Upload size={10} className="mr-1" />
              Upload
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-red-400"
              onClick={() => resetFile()}
              loading={resetting}
              title="Reset to generated default"
            >
              <RotateCcw size={10} className="mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              className="h-6 px-3 text-[10px] font-bold"
              onClick={() => saveFile(edits[activeFile] ?? fileContent)}
              loading={saving}
              disabled={!isDirty}
            >
              {savedFile === activeFile
                ? <><CheckCircle2 size={10} className="mr-1" />Saved!</>
                : "Save"
              }
            </Button>
          </div>
        </div>

        {/* Editor */}
        <textarea
          className="w-full font-mono text-[11px] leading-relaxed bg-black/30 text-[hsl(var(--foreground)/0.85)] p-3 resize-y focus:outline-none"
          style={{ minHeight: "360px", tabSize: 2 }}
          value={fileContent}
          onChange={(e) => setEdits((prev) => ({ ...prev, [activeFile]: e.target.value }))}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>

      {/* Footer info */}
      <p className="text-[9px] text-[hsl(var(--muted-foreground)/0.6)]">
        Place these files in your repo root. Opsway reads them on each build and updates the config above.
        Changes saved here are used until the next repo sync overwrites them.
        Secrets in <code className="font-mono">odoo.conf.template</code> use{" "}
        <code className="font-mono">$&#123;VAR&#125;</code> syntax — resolved via{" "}
        <code className="font-mono">envsubst</code> during deploy.
      </p>
    </Card>
  );
}
