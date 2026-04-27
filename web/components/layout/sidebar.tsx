"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, FolderGit2, Rocket, Settings,
  ChevronRight, Activity, Users, Shield,
  LogOut, Bell, Search, ChevronLeft, Sun, Moon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authApi } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard",  label: "Overview",   icon: LayoutDashboard },
  { href: "/projects",   label: "Projects",   icon: FolderGit2 },
  { href: "/builds",     label: "Builds",     icon: Rocket },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/settings",   label: "Settings",   icon: Settings },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;

  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all active:scale-95"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

function logout() {
  localStorage.removeItem("opsway_token");
  window.location.href = "/login";
}

export function Sidebar() {
  const pathname = usePathname();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => authApi.me().then((r) => r.data),
    staleTime: 60_000,
  });

  const navItem = (href: string, label: string, Icon: React.ElementType) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-150",
          active
            ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-medium"
            : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
        )}
      >
        <Icon size={16} className={cn("shrink-0", active && "text-[hsl(var(--primary))]")} />
        {label}
        {active && <ChevronRight size={12} className="ml-auto opacity-60" />}
      </Link>
    );
  };

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-[hsl(var(--border))] px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 shadow-lg">
          <Rocket size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight text-[hsl(var(--foreground))]">
          Opsway
        </span>
        <span className="ml-auto rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-400 border border-violet-500/20">
          v0.1
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => navItem(href, label, Icon))}

        {/* Admin section — superuser only */}
        {me?.is_superuser && (
          <>
            <div className="my-2 h-px bg-[hsl(var(--border))]" />
            <p className="px-3 pb-1 text-[9px] font-bold uppercase tracking-widest text-[hsl(var(--muted-foreground))] opacity-60">
              Admin
            </p>
            {navItem("/settings/users", "Users", Users)}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="border-t border-[hsl(var(--border))] p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-[10px] font-bold text-white">
            {me?.username?.slice(0, 2).toUpperCase() ?? "—"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]">
                {me?.username ?? "…"}
              </p>
              {me?.is_superuser && (
                <Shield size={9} className="text-violet-400 shrink-0" />
              )}
            </div>
            <p className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">
              {me?.email ?? ""}
            </p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="text-[hsl(var(--muted-foreground))] hover:text-red-400 transition-colors"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({ title, backHref, children }: { title: string; backHref?: string; children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6">
      {backHref && (
        <Link
          href={backHref}
          className="mr-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all active:scale-95"
          title="Go Back"
        >
          <ChevronLeft size={16} />
        </Link>
      )}
      <h1 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <ThemeToggle />
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all">
          <Bell size={15} />
        </button>
        <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] transition-all">
          <Search size={15} />
        </button>
      </div>
    </header>
  );
}
