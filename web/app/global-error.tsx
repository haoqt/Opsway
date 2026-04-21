"use client";
import { Inter } from "next/font/google";
import "@/app/globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-[#0d1117] text-[#c9d1d9] flex min-h-screen flex-col items-center justify-center p-4`}>
        <div className="max-w-md w-full text-center space-y-6">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-red-500/10 text-red-500 mb-2">
            <span className="text-4xl">⚠️</span>
          </div>
          
          <h1 className="text-2xl font-bold text-white">System Critical Error</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            The Opsway dashboard encountered a critical error and cannot continue.
          </p>
          
          <div className="p-4 rounded-lg bg-[#161b22] border border-[hsl(var(--border))] text-left overflow-hidden">
            <p className="text-xs font-mono text-red-400 break-words mb-2">
              {error.message}
            </p>
            {error.digest && (
              <p className="text-[10px] text-zinc-500">Digest: {error.digest}</p>
            )}
          </div>

          <button
            onClick={() => reset()}
            className="w-full py-3 px-4 rounded-xl bg-white text-black font-semibold hover:bg-zinc-200 transition-colors"
          >
            Attempt Recovery
          </button>
        </div>
      </body>
    </html>
  );
}
