"use client";
import { Topbar } from "@/components/layout/sidebar";
import { Card, Button, Input } from "@/components/ui/primitives";
import { Settings, User, Bell, Shield, Palette, Globe, Save } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/lib/api";

export default function SettingsPage() {
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
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[10px]">Change Avatar</Button>
                  <Button variant="outline" size="sm" className="h-7 text-[10px]">Edit Profile</Button>
                </div>
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

        {/* Global Settings */}
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
              <div className="h-6 w-11 rounded-full bg-violet-600 p-1 flex justify-end">
                <div className="h-4 w-4 rounded-full bg-white" />
              </div>
            </div>
          </Card>
        </section>

        {/* Git Integration Settings */}
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

      </div>
    </>
  );
}
