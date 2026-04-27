"use client";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@/lib/api";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Input } from "@/components/ui/primitives";
import { Users, Plus, Trash2, Shield, AlertCircle } from "lucide-react";
import { formatTimeAgo } from "@/lib/utils";

type UserRecord = {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  is_superuser: boolean;
  is_active: boolean;
  created_at: string;
};

export default function UsersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: "", username: "", password: "", full_name: "", is_superuser: false });
  const [formError, setFormError] = useState("");

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me().then((r) => r.data),
  });

  const { data: users = [], isLoading, isError } = useQuery<UserRecord[]>({
    queryKey: ["users"],
    queryFn: () => authApi.listUsers().then((r) => r.data),
  });

  const { mutate: createUser, isPending: isCreating } = useMutation({
    mutationFn: () =>
      authApi.createUser({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
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

  const canManage = me?.is_superuser;

  return (
    <>
      <Topbar title="Users" backHref="/settings" />
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[hsl(var(--foreground))]">System Users</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{users.length} account{users.length !== 1 ? "s" : ""} registered</p>
          </div>
          {canManage && (
            <Button
              variant="primary"
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => { setShowForm(!showForm); setFormError(""); }}
            >
              <Plus size={13} /> New User
            </Button>
          )}
        </div>

        {/* Not admin warning */}
        {!canManage && !isLoading && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <AlertCircle size={15} className="text-amber-400 shrink-0" />
            <p className="text-xs text-amber-400">Admin role required to manage users.</p>
          </div>
        )}

        {/* Create form */}
        {showForm && canManage && (
          <Card className="p-5 space-y-4 border-violet-500/20 bg-violet-500/[0.02]">
            <h3 className="text-xs font-bold text-[hsl(var(--foreground))] uppercase tracking-wider flex items-center gap-2">
              <Plus size={12} className="text-violet-400" /> Create New Account
            </h3>

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
                <label className="text-[10px] font-bold text-[hsl(var(--muted-foreground))] uppercase tracking-tight">Password * (min 8 chars)</label>
                <Input value={form.password} onChange={set("password")} placeholder="••••••••" type="password" />
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={form.is_superuser}
                onChange={set("is_superuser")}
                className="h-4 w-4 rounded border border-[hsl(var(--border))] accent-violet-500"
              />
              <span className="text-xs text-[hsl(var(--foreground))]">
                Admin role
                <span className="text-[hsl(var(--muted-foreground))] ml-1">— can create/manage users and access all projects</span>
              </span>
            </label>

            {formError && (
              <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle size={12} /> {formError}
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setShowForm(false); setFormError(""); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="h-8 text-xs gap-1.5"
                loading={isCreating}
                disabled={!form.email || !form.username || form.password.length < 8}
                onClick={() => createUser()}
              >
                <Plus size={12} /> Create Account
              </Button>
            </div>
          </Card>
        )}

        {/* Users list */}
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Loading users…</div>
          ) : isError ? (
            <div className="p-6 text-center text-xs text-red-400">Failed to load users.</div>
          ) : users.length === 0 ? (
            <div className="p-10 flex flex-col items-center gap-2 opacity-40">
              <Users size={28} className="stroke-1" />
              <p className="text-xs font-bold uppercase tracking-tight">No users yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[hsl(var(--border))]">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--secondary)/0.3)] transition-colors">
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center text-xs font-bold text-[hsl(var(--foreground))] shrink-0 border border-[hsl(var(--border))]">
                    {u.username.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[hsl(var(--foreground))]">{u.username}</span>
                      {u.full_name && (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">({u.full_name})</span>
                      )}
                      {u.is_superuser && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400">
                          <Shield size={8} /> Admin
                        </span>
                      )}
                      {!u.is_active && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400">
                          Inactive
                        </span>
                      )}
                      {u.id === me?.id && (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{u.email}</p>
                  </div>

                  {/* Created at */}
                  <span className="hidden md:block text-[10px] text-[hsl(var(--muted-foreground))] shrink-0">
                    {formatTimeAgo(u.created_at)}
                  </span>

                  {/* Delete */}
                  {canManage && u.id !== me?.id && u.is_active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-[hsl(var(--muted-foreground))] hover:text-red-400 hover:bg-red-400/10 shrink-0"
                      title="Deactivate user"
                      onClick={() => {
                        if (confirm(`Deactivate "${u.username}"? They will no longer be able to log in.`)) {
                          deleteUser(u.id);
                        }
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

      </div>
    </>
  );
}
