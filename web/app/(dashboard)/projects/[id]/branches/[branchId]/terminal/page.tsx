"use client";
import React, { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Topbar } from "@/components/layout/sidebar";
import { Terminal as TerminalIcon, Maximize2, AlertCircle } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useQuery } from "@tanstack/react-query";
import { branchesApi } from "@/lib/api";
import { Branch } from "@/lib/types";

export default function TerminalPage() {
  const { id: projectId, branchId } = useParams<{ id: string; branchId: string }>();

  const { data: branch, isLoading } = useQuery({
    queryKey: ["branch", projectId, branchId],
    queryFn: () => branchesApi.get(projectId, branchId).then((r) => r.data as Branch),
  });

  useEffect(() => {
    // Moved to TerminalViewer
  }, []);

  if (isLoading) {
    return (
      <>
        <Topbar title="Terminal" />
        <div className="flex-1 flex items-center justify-center text-xs text-zinc-500 gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
          Connecting...
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <Topbar title={`Terminal: ${branch?.name || "..."}`}>
        <div className="flex items-center gap-2">
           <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
             <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
             Live Session
           </span>
        </div>
      </Topbar>

      <div className="flex-1 p-4 pb-0 flex flex-col min-h-0">
        <TerminalViewer branchId={branchId} />
      </div>
    </div>
  );
}

function TerminalViewer({ branchId }: { branchId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "rgba(88, 166, 255, 0.3)",
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    // Slight delay to ensure parent container is fully rendered before fitting
    setTimeout(() => fitAddon.fit(), 50);

    const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
    const wsUrl = API_URL.replace(/^https?:\/\//, (match) => match === "https://" ? "wss://" : "ws://") + `/api/terminal/${branchId}`;
    
    let token = "";
    if (typeof window !== "undefined") {
      token = localStorage.getItem("opsway_token") || "";
    }

    let isCleaningUp = false;
    const ws = new WebSocket(`${wsUrl}?token=${token}`);

    ws.onopen = () => {
      if (isCleaningUp) return;
      term.writeln("\x1b[32m[Opsway] Connected to container terminal.\x1b[0m");
    };

    ws.onmessage = (event) => {
      if (isCleaningUp) return;
      term.write(event.data);
    };

    ws.onerror = () => {
      if (isCleaningUp) return;
      term.writeln("\x1b[31m[Opsway] Connection error.\x1b[0m");
      setError("Failed to connect to the terminal websocket.");
    };

    ws.onclose = () => {
      if (isCleaningUp) return;
      term.writeln("\r\n\x1b[33m[Opsway] Connection closed.\x1b[0m");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      isCleaningUp = true;
      ws.close();
      term.dispose();
      resizeObserver.disconnect();
    };
  }, [branchId]);

  return (
    <>
      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-400">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="font-mono text-xs">{error}</span>
        </div>
      )}
      <div className="w-full h-full rounded-t-lg overflow-hidden border border-b-0 border-[hsl(var(--border))]">
          <div ref={terminalRef} className="w-full h-full bg-[#0d1117] p-2" />
      </div>
    </>
  );
}
