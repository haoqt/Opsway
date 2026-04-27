"use client";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Input } from "@/components/ui/primitives";
import { Settings, User, Bell, Shield, Palette, Globe, Save, Plus, Trash2, UserCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

type UserRecord = {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  is_superuser: boolean;
  is_active: boolean;
  created_at: string;
};

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const { data: user } = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me().then((r) => r.data),
  });

  return (
    <>
      <Topbar title="System Settings" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl">

        {/* Profile Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <User size={16} />
            <h2 className="text-xs font-bold uppercase tracking-widest">Account Profile</h2>
          </div>

          <Card className="p-6 space-y-6">
            <div className="flex items-center gap-6 pb-6 border-b border-[hsl(var(--border))]">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 shadow-xl border-4 border-black/20" />
              <div>
                <h3 className="text-lg font-bold text-[hsl(var(--foreground))]">{user?.username || "Admin"}</h3>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">{user?.email || "admin@opsway.io"}</p>
                {user?.is_superuser && (
                  <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400">
                    <Shield size={9} /> Admin
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Username</label>
                <Input defaultValue={user?.username} disabled />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Email Address</label>
                <Input defaultValue={user?.email} disabled />
              </div>
            </div>
          </Card>
        </section>

        {/* Appearance */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Palette size={16} />
            <h2 className="text-xs font-bold uppercase tracking-widest">Appearance</h2>
          </div>

          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">Dark Mode</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Toggle between light and dark themes</p>
              </div>
              {mounted && (
                <button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className={cn(
                    "h-6 w-11 rounded-full transition-colors duration-200 p-1 flex items-center",
                    theme === "dark" ? "bg-violet-600 justify-end" : "bg-slate-300 dark:bg-slate-700 justify-start"
                  )}
                >
                  <div className="h-4 w-4 rounded-full bg-white shadow-sm" />
                </button>
              )}
            </div>
          </Card>
        </section>

        {/* System Preferences */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Globe size={16} />
            <h2 className="text-xs font-bold uppercase tracking-widest">System Preferences</h2>
          </div>

          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">Auto-Refresh Dashboards</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Automatically update data every 10 seconds</p>
              </div>
              <div className="h-6 w-11 rounded-full bg-violet-600 p-1 flex justify-end">
                <div className="h-4 w-4 rounded-full bg-white" />
              </div>
            </div>

            <div className="pt-4 border-t border-[hsl(var(--border))] flex justify-end">
              <Button variant="primary" size="sm" className="gap-2">
                <Save size={14} /> Save Changes
              </Button>
            </div>
          </Card>
        </section>

        {/* User Management — superuser only */}
        {user?.is_superuser && <UserManagementSection currentUserId={user.id} />}

      </div>
    </>
  );
}

function UserManagementSection({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", password: "", full_name: "", is_superuser: false });
  const [formError, setFormError] = useState("");

  const { data: users = [] } = useQuery<UserRecord[]>({
    queryKey: ["users"],
    queryFn: () => authApi.listUsers().then((r) => r.data),
  });

  const { mutate: createUser, isPending: isCreating } = useMutation({
    mutationFn: () => authApi.createUser({
      email: form.email,
      username: form.username,
      password: form.password,
      full_name: form.full_name || undefined,
      is_superuser: form.is_superuser,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setForm({ email: "", username: "", password: "", full_name: "", is_superuser: false });
      setShowForm(false);
      setFormError("");
    },
    onError: (err: any) => setFormError(err.response?.data?.detail || "Failed to create user"),
  });

  const { mutate: deleteUser } = useMutation({
    mutationFn: (userId: string) => authApi.deleteUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (err: any) => alert(err.response?.data?.detail || "Failed to deactivate user"),
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
          <UserCheck size={16} />
          <h2 className="text-xs font-bold uppercase tracking-widest">User Management</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[10px] gap-1"
          onClick={() => { setShowForm(!showForm); setFormError(""); }}
        >
          <Plus size={11} /> New User
        </Button>
      </div>

      {/* Create user form */}
      {showForm && (
        <Card className="p-5 space-y-4 border-violet-500/20 bg-violet-500/[0.02]">
          <h3 className="text-xs font-bold text-[hsl(var(--foreground))] uppercase tracking-wider">Create New Account</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Email *</label>
              <Input value={form.email} onChange={set("email")} placeholder="user@company.io" type="email" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Username *</label>
              <Input value={form.username} onChange={set("username")} placeholder="john_dev" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Full Name</label>
              <Input value={form.full_name} onChange={set("full_name")} placeholder="John Doe" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Password *</label>
              <Input value={form.password} onChange={set("password")} placeholder="min 8 chars" type="password" />
            </div>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.is_superuser}
              onChange={set("is_superuser")}
              className="h-4 w-4 rounded border border-[hsl(var(--border))] accent-violet-500"
            />
            <span className="text-xs text-[hsl(var(--foreground))]">Admin role <span className="text-[hsl(var(--muted-foreground))]">— can create users & access all projects</span></span>
          </label>

          {formError && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">{formError}</p>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setShowForm(false); setFormError(""); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-8 text-xs gap-1.5"
              loading={isCreating}
              disabled={!form.email || !form.username || !form.password}
              onClick={() => createUser()}
            >
              <Plus size={12} /> Create Account
            </Button>
          </div>
        </Card>
      )}

      {/* Users list */}
      <Card className="divide-y divide-[hsl(var(--border))]">
        {users.length === 0 ? (
          <div className="p-6 text-center text-xs text-[hsl(var(--muted-foreground))]">No users found</div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-500/40 to-cyan-500/40 flex items-center justify-center text-[11px] font-bold text-[hsl(var(--foreground))] shrink-0">
                  {u.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">{u.username}</p>
                    {u.is_superuser && (
                      <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center gap-0.5">
                        <Shield size={8} /> Admin
                      </span>
                    )}
                    {!u.is_active && (
                      <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{u.email}</p>
                </div>
              </div>

              {u.id !== currentUserId && u.is_active && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] hover:text-red-400 hover:bg-red-400/10 shrink-0"
                  title="Deactivate user"
                  onClick={() => {
                    if (confirm(`Deactivate user "${u.username}"?`)) deleteUser(u.id);
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </div>
          ))
        )}
      </Card>
    </section>
  );
}
