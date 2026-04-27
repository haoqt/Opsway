"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Input, Button } from "@/components/ui/primitives";
import { Rocket, LogIn } from "lucide-react";

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
