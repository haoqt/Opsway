"use client";
import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { branchesApi } from "@/lib/api";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Skeleton, EmptyState } from "@/components/ui/primitives";
import { formatTimeAgo } from "@/lib/utils";
import { Database, Download, Rocket, Clock, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

type Backup = {
  id: string;
  project_id: string;
  branch_id: string;
  backup_type: string;
  storage_path: string | null;
  size_bytes: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export default function BranchBackupsPage() {
  const { id: projectId, branchId } = useParams<{ id: string; branchId: string }>();
  const qc = useQueryClient();

  const { data: backups, isLoading } = useQuery({
    queryKey: ["backups", projectId, branchId],
    queryFn: () => branchesApi.listBackups(projectId, branchId).then((r) => r.data as Backup[]),
    refetchInterval: 10_000,
  });

  const { mutate: createBackup, isPending: isCreating } = useMutation({
    mutationFn: () => branchesApi.createBackup(projectId, branchId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backups", projectId, branchId] });
    },
    onError: (err: any) => {
      alert(err.response?.data?.detail || "Failed to create backup");
    },
  });

  const handleDownload = (backupId: string) => {
    const token = localStorage.getItem("opsway_token");
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const downloadUrl = `${apiUrl}/api/projects/${projectId}/branches/${branchId}/backups/${backupId}/download?token=${token}`;
    window.open(downloadUrl, "_blank");
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--background))]">
      <Topbar title="Backups">
        <Button
          size="sm"
          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={() => createBackup()}
          loading={isCreating}
        >
          <Database size={14} className="mr-2" />
          Create Backup
        </Button>
      </Topbar>
      
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : !backups?.length ? (
          <EmptyState
            icon={Database}
            title="No backups yet"
            description="Create a manual backup or trigger a deployment to create one."
          />
        ) : (
          <div className="space-y-3 max-w-5xl">
            {backups.map((backup) => (
              <Card key={backup.id} className="p-4 flex items-center justify-between border-[hsl(var(--border))] group hover:border-[hsl(var(--primary)/0.3)] transition-all">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg shrink-0 ${
                    backup.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' :
                    backup.status === 'running' || backup.status === 'pending' ? 'bg-blue-500/10 text-blue-500' :
                    'bg-red-500/10 text-red-500'
                  }`}>
                    {backup.status === 'completed' ? <CheckCircle2 size={20} /> :
                     backup.status === 'running' || backup.status === 'pending' ? <RefreshCw size={20} className="animate-spin" /> :
                     <AlertCircle size={20} />}
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-[hsl(var(--foreground))] capitalize">
                        {backup.backup_type} Backup
                      </p>
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        • {formatBytes(backup.size_bytes)}
                      </span>
                    </div>
                    
                    <div className="mt-1 flex items-center gap-3 text-xs text-[hsl(var(--muted-foreground))]">
                      <span className="flex items-center gap-1">
                        <Clock size={12} /> {formatTimeAgo(backup.created_at)}
                      </span>
                      {backup.status === 'failed' && backup.error_message && (
                        <span className="text-red-400 truncate max-w-[200px]" title={backup.error_message}>
                          {backup.error_message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={backup.status !== "completed"}
                    onClick={() => handleDownload(backup.id)}
                  >
                    <Download size={14} className="mr-2" />
                    Download
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
