"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Rocket } from "lucide-react";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      localStorage.setItem("opsway_token", token);
      router.push("/dashboard");
    } else {
      router.push("/login?error=oauth_failed");
    }
  }, [params, router]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))]">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500">
          <Rocket size={20} className="text-white" />
        </div>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Completing sign in…</p>
        <Suspense fallback={null}>
          <CallbackHandler />
        </Suspense>
      </div>
    </div>
  );
}
