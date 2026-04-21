"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/primitives";
import { AlertCircle, RefreshCcw, Home } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard Error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[400px] w-full flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center animate-in fade-in zoom-in duration-300">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        <AlertCircle size={32} />
      </div>
      
      <h2 className="mb-2 text-xl font-bold text-red-400">Something went wrong</h2>
      <p className="mb-6 max-w-md text-sm text-[hsl(var(--muted-foreground))]">
        {error.message || "An unexpected error occurred in the dashboard."}
        {error.digest && (
          <code className="mt-2 block text-[10px] opacity-50">Error ID: {error.digest}</code>
        )}
      </p>

      <div className="flex items-center gap-3">
        <Button
          onClick={() => reset()}
          className="flex items-center gap-2"
        >
          <RefreshCcw size={14} /> Try again
        </Button>
        <Button
          variant="outline"
          onClick={() => window.location.href = "/"}
          className="flex items-center gap-2"
        >
          <Home size={14} /> Back to Home
        </Button>
      </div>
      
      <div className="mt-8 text-left max-w-full overflow-hidden">
        <details className="cursor-pointer group">
          <summary className="text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))] group-hover:text-[hsl(var(--foreground))] transition-colors">
            Technical Details
          </summary>
          <pre className="mt-4 p-4 rounded bg-[#0d1117] border border-[hsl(var(--border))] text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-[200px]">
            {error.stack}
          </pre>
        </details>
      </div>
    </div>
  );
}
