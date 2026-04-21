"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Input, Button } from "@/components/ui/primitives";
import { Rocket, LogIn } from "lucide-react";

function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  const { mutate, isPending } = useMutation({
    mutationFn: () => authApi.login(form.email, form.password),
    onSuccess: (res) => {
      localStorage.setItem("opsway_token", res.data.access_token);
      router.push("/dashboard");
    },
    onError: () => setError("Invalid email or password"),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-4">
      {/* Gradient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute left-2/3 top-2/3 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-600/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 shadow-xl shadow-violet-500/25">
            <Rocket size={24} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-[hsl(var(--foreground))]">Welcome to Opsway</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">CI/CD Platform for Odoo</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-2xl">
          {/* GitHub OAuth */}
          <a
            href={authApi.githubUrl()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] py-2.5 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors mb-4"
          >
            <GithubIcon size={16} />
            Continue with GitHub
          </a>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[hsl(var(--border))]" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-[hsl(var(--card))] px-2 text-[11px] text-[hsl(var(--muted-foreground))]">
                or sign in with email
              </span>
            </div>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); setError(""); mutate(); }}
            className="space-y-3"
          >
            <Input
              id="login-email"
              label="Email"
              type="email"
              placeholder="admin@opsway.io"
              value={form.email}
              onChange={set("email")}
              autoComplete="email"
            />
            <Input
              id="login-password"
              label="Password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={set("password")}
              autoComplete="current-password"
            />

            {error && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {error}
              </p>
            )}

            <Button variant="primary" className="w-full" type="submit" loading={isPending}>
              <LogIn size={14} /> Sign In
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-[hsl(var(--muted-foreground))]">
          Opsway v0.1 — Self-hosted CI/CD for Odoo
        </p>
      </div>
    </div>
  );
}
