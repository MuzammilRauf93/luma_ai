"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AlertTriangle, AtSign, Bell, Brain, CheckCheck, CircleHelp, Hand, Rocket, Eye, Zap, UserPlus } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import type { Notification, NotificationKind } from "@/lib/types";

type Item = Notification & { workspace: { name: string; icon: string } | null };

const ICON: Record<NotificationKind, React.ComponentType<{ size?: number; className?: string }>> = {
  waiting: CircleHelp,
  approval: Hand,
  review: Eye,
  failed: AlertTriangle,
  mention: AtSign,
  memory_review: Brain,
  deploy: Rocket,
  autopilot: Zap,
  invite: UserPlus,
};

export const NOTIFY_EVENT = "luma:notify";
const DESKTOP_KEY = "luma-desktop-notifications";

/** Bell + inbox in the sidebar. Polls every 20 s and refreshes immediately on live "notification" events. */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [desktop, setDesktop] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setDesktop(localStorage.getItem(DESKTOP_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: Item[]; unread: number }>("/api/notifications");
      setItems(d.items);
      setUnread(d.unread);
      const fresh = d.items.filter((n) => !n.readAt && seen.current && !seen.current.has(n.id));
      if (desktop && document.hidden && fresh.length && typeof Notification !== "undefined") {
        for (const n of fresh.slice(0, 3)) {
          const dn = new Notification(n.title, { body: n.body, tag: n.id });
          dn.onclick = () => {
            window.focus();
            router.push(n.link);
          };
        }
      }
      seen.current = new Set(d.items.map((n) => n.id));
    } catch {
      // signed out or offline: try again on the next tick
    }
  }, [desktop, router]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    window.addEventListener(NOTIFY_EVENT, load);
    return () => {
      clearInterval(t);
      window.removeEventListener(NOTIFY_EVENT, load);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const openItem = async (n: Item) => {
    setOpen(false);
    if (!n.readAt) await api("/api/notifications", { method: "POST", json: { ids: [n.id] } }).catch(() => undefined);
    router.push(n.link);
    load();
  };
  const readAll = async () => {
    await api("/api/notifications", { method: "POST", json: { all: true } });
    load();
  };
  const toggleDesktop = async () => {
    if (desktop) {
      setDesktop(false);
      try {
        localStorage.setItem(DESKTOP_KEY, "0");
      } catch {}
      return;
    }
    if (typeof Notification === "undefined") return;
    const p = await Notification.requestPermission();
    const on = p === "granted";
    setDesktop(on);
    try {
      localStorage.setItem(DESKTOP_KEY, on ? "1" : "0");
    } catch {}
  };

  return (
    <div className="relative" ref={box}>
      <button className="btn btn-ghost btn-sm !px-1.5 relative" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-50 w-[340px] max-w-[calc(100vw-24px)] card shadow-2xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button className="btn btn-ghost btn-sm ml-auto !h-6 text-xs" onClick={readAll}>
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto scroll-thin">
            {items.length === 0 && <li className="p-6 text-center text-sm text-muted">You're all caught up.</li>}
            {items.map((n) => {
              const Icon = ICON[n.kind] ?? Bell;
              return (
                <li key={n.id}>
                  <button onClick={() => openItem(n)} className={clsx("w-full text-left flex gap-2.5 px-3 py-2.5 hover:bg-panel-2 border-b last:border-0", !n.readAt && "bg-accent-soft/30")}>
                    <Icon size={15} className={clsx("mt-0.5 shrink-0", n.kind === "failed" ? "text-danger" : n.kind === "waiting" || n.kind === "approval" ? "text-warning" : "text-accent")} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block text-[13px] leading-snug", !n.readAt && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="block text-xs text-muted line-clamp-2 mt-0.5">{n.body}</span>}
                      <span className="block text-[11px] text-muted mt-1">{n.workspace ? `${n.workspace.icon} ${n.workspace.name} · ` : ""}{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="w-2 h-2 rounded-full bg-accent mt-1.5 shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="flex items-center gap-2 px-3 py-2 border-t text-xs text-muted cursor-pointer">
            <input type="checkbox" className="accent-[var(--accent)]" checked={desktop} onChange={toggleDesktop} />
            Desktop alerts when Luma is in the background
          </label>
        </div>
      )}
    </div>
  );
}
