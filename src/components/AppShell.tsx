"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Brain,
  Bot,
  Rocket,
  Code2,
  Home,
  KanbanSquare,
  LayoutDashboard,
  Moon,
  Plus,
  Settings,
  Sun,
  Menu,
  Compass,
  LogOut,
} from "lucide-react";
import { api } from "@/lib/client";
import type { Workspace } from "@/lib/types";
import { NewWorkspaceModal } from "./NewWorkspaceModal";

type WsItem = Workspace & { ticketCounts: { open: number; done: number; waiting: number }; pendingMemories?: number };

export const WORKSPACES_CHANGED = "luma:workspaces";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WsItem[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [dark, setDark] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const bare = pathname.startsWith("/setup") || pathname.startsWith("/login") || pathname.startsWith("/invite");
  const [me, setMe] = useState<{ authEnabled: boolean; user: { name: string; email: string; role: string } | null } | null>(null);
  const wsMatch = pathname.match(/^\/w\/([^/]+)/);
  const currentWsId = wsMatch?.[1];

  const loadWorkspaces = useCallback(() => {
    api<{ workspaces: WsItem[] }>("/api/workspaces").then((d) => setWorkspaces(d.workspaces)).catch(() => {});
  }, []);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    loadWorkspaces();
    window.addEventListener(WORKSPACES_CHANGED, loadWorkspaces);
    return () => window.removeEventListener(WORKSPACES_CHANGED, loadWorkspaces);
  }, [loadWorkspaces]);

  // Sign-in (Phase 5): send signed-out people to /login once accounts exist.
  useEffect(() => {
    if (bare) return;
    api<{ authEnabled: boolean; user: { name: string; email: string; role: string } | null }>("/api/auth/me")
      .then((m) => {
        setMe((prev) => {
          if (m.user && prev?.user?.email !== m.user.email) loadWorkspaces(); // just signed in
          return m;
        });
        if (m.authEnabled && !m.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      })
      .catch(() => setMe({ authEnabled: false, user: null }));
  }, [pathname, router, bare, loadWorkspaces]);

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };

  useEffect(() => {
    if (!me || (me.authEnabled && !me.user)) return;
    api<{ connected: boolean }>("/api/settings")
      .then((s) => {
        setConnected(s.connected);
        if (!s.connected && !bare && !pathname.startsWith("/settings")) router.replace(me.user?.role === "member" ? "/settings" : "/setup");
      })
      .catch(() => setConnected(false));
  }, [pathname, router, me, bare]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("luma-theme", next ? "dark" : "light");
    } catch {}
  };

  if (bare) return <>{children}</>;

  const current = workspaces.find((w) => w.id === currentWsId);
  const wsNav = currentWsId
    ? [
        { href: `/w/${currentWsId}`, label: "Overview", icon: LayoutDashboard },
        { href: `/w/${currentWsId}/board`, label: "Tickets", icon: KanbanSquare },
        { href: `/w/${currentWsId}/agents`, label: "Agents", icon: Bot },
        { href: `/w/${currentWsId}/memory`, label: "Memory", icon: Brain },
        { href: `/w/${currentWsId}/ship`, label: "Ship", icon: Rocket },
        { href: `/w/${currentWsId}/editor`, label: "Code & Preview", icon: Code2 },
      ]
    : [];

  const sidebar = (
    <aside className="w-[244px] shrink-0 h-full flex flex-col bg-panel border-r">
      <Link href="/" className="flex items-center gap-2.5 px-4 h-14 border-b">
        <span className="w-7 h-7 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>
          L
        </span>
        <span className="font-semibold tracking-tight">Luma AI</span>
      </Link>

      <nav className="flex-1 overflow-y-auto scroll-thin px-2 py-3 space-y-5">
        <div>
          <NavLink href="/" active={pathname === "/"} icon={Home} label="Home" />
        </div>

        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Workspaces</span>
            <button className="btn btn-ghost btn-sm !h-6 !px-1.5" onClick={() => setCreating(true)} aria-label="New workspace">
              <Plus size={14} />
            </button>
          </div>
          {workspaces.length === 0 && <p className="px-2 text-xs text-muted">No workspaces yet.</p>}
          {workspaces.map((w) => (
            <div key={w.id}>
              <Link
                href={`/w/${w.id}`}
                className={clsx(
                  "flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm",
                  w.id === currentWsId ? "bg-panel-2 font-medium" : "hover:bg-panel-2 text-ink/85",
                )}
              >
                <span className="text-base leading-none">{w.icon}</span>
                <span className="truncate flex-1">{w.name}</span>
                {w.ticketCounts.waiting > 0 && (
                  <span className="text-[10px] font-bold rounded-full px-1.5 bg-warning/15 text-warning" title="Needs your attention">
                    {w.ticketCounts.waiting}
                  </span>
                )}
              </Link>
              {w.id === currentWsId && (
                <div className="ml-3 pl-2 border-l my-1 space-y-0.5">
                  {wsNav.map((n) => (
                    <NavLink
                      key={n.href}
                      href={n.href}
                      active={pathname === n.href}
                      icon={n.icon}
                      label={n.label}
                      small
                      badge={n.label === "Memory" ? w.pendingMemories : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </nav>

      {me?.user && (
        <div className="border-t px-3 py-2 flex items-center gap-2">
          <span className="w-7 h-7 rounded-full bg-accent text-white grid place-items-center text-[11px] font-bold shrink-0">
            {me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium truncate">{me.user.name}</span>
            <span className="block text-[11px] text-muted truncate">{me.user.role === "admin" ? "Admin · " : ""}{me.user.email}</span>
          </span>
          <button className="btn btn-ghost btn-sm !px-1.5" onClick={signOut} title="Sign out" aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      )}
      <div className="border-t p-2 flex items-center gap-1">
        <NavLink href="/settings" active={pathname === "/settings"} icon={Settings} label="Settings" />
        {currentWsId && (
          <button className="btn btn-ghost btn-sm" onClick={() => window.dispatchEvent(new Event("luma:tour"))} aria-label="Take the tour" title="Take the tour">
            <Compass size={15} />
          </button>
        )}
        <button className="btn btn-ghost btn-sm ml-auto" onClick={toggleTheme} aria-label="Toggle dark mode">
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      {connected === false && (
        <Link href="/setup" className="m-2 mt-0 text-xs rounded-lg px-3 py-2 bg-warning/15 text-warning font-medium">
          Connect your Claude account →
        </Link>
      )}
    </aside>
  );

  return (
    <div className="h-screen flex overflow-hidden">
      <div className="hidden md:flex">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden" onClick={() => setMobileOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
          <div className="flex-1 bg-black/30" />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex items-center gap-2 h-12 px-3 border-b bg-panel">
          <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={16} />
          </button>
          <span className="font-medium text-sm truncate">{current ? `${current.icon} ${current.name}` : "Luma AI"}</span>
        </div>
        <main className="flex-1 min-h-0 overflow-auto scroll-thin">{children}</main>
      </div>
      <NewWorkspaceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          loadWorkspaces();
          router.push(`/w/${id}`);
        }}
      />
    </div>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  label,
  small,
  badge,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  small?: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-2 px-2 rounded-lg",
        small ? "py-1 text-[13px]" : "py-1.5 text-sm",
        active ? "bg-accent-soft text-accent-ink font-medium" : "text-muted hover:text-ink hover:bg-panel-2",
      )}
    >
      <Icon size={small ? 14 : 16} />
      {label}
      {badge ? <span className="ml-auto text-[10px] font-bold rounded-full px-1.5 bg-warning/15 text-warning" title="Waiting for your review">{badge}</span> : null}
    </Link>
  );
}
