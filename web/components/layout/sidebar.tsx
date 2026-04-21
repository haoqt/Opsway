"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, FolderGit2, Rocket, Settings,
  GitBranch, Terminal, ChevronRight, Activity,
  LogOut, Bell, Search
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard",  label: "Overview",   icon: LayoutDashboard },
  { href: "/projects",   label: "Projects",   icon: FolderGit2 },
  { href: "/builds",     label: "Builds",     icon: Rocket },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/settings",   label: "Settings",   icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

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
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                active
                  ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))] font-medium"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
              )}
            >
              <Icon size={16} className={cn("shrink-0", active && "text-[hsl(var(--primary))]")} />
              {label}
              {active && (
                <ChevronRight size={12} className="ml-auto opacity-60" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div className="border-t border-[hsl(var(--border))] p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-[hsl(var(--foreground))]">Admin</p>
            <p className="truncate text-[10px] text-[hsl(var(--muted-foreground))]">admin@opsway.io</p>
          </div>
          <button className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function Topbar({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6">
      <h1 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {children}
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
