"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import clsx from "clsx";
import type { Agent, Priority, TicketStatus } from "@/lib/types";
import { PRIORITY_STYLE, STATUS_STYLE } from "@/lib/client";

export function AgentAvatar({ agent, size = 28 }: { agent: Pick<Agent, "avatar" | "color" | "name"> | null; size?: number }) {
  if (!agent)
    return (
      <span
        className="inline-grid place-items-center rounded-full border border-dashed text-muted shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
        title="Unassigned"
      >
        ?
      </span>
    );
  return (
    <span
      className="inline-grid place-items-center rounded-full shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.52, background: `${agent.color}22`, boxShadow: `inset 0 0 0 1.5px ${agent.color}55` }}
      title={agent.name}
    >
      {agent.avatar}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="chip" style={{ color: s.dot, background: `${s.dot}18` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const p = PRIORITY_STYLE[priority];
  return (
    <span className="chip" title={`${p.label} priority`}>
      <PriorityBars priority={priority} />
      {p.label}
    </span>
  );
}

export function PriorityBars({ priority }: { priority: Priority }) {
  const n = { low: 1, medium: 2, high: 3, urgent: 4 }[priority];
  const color = PRIORITY_STYLE[priority].color;
  return (
    <span className="inline-flex items-end gap-[2px] h-[10px]">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: 2 + i * 2, background: i <= n ? color : "var(--border)" }} />
      ))}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/30 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        className={clsx("card w-full max-h-[90vh] overflow-auto scroll-thin", wide === "xl" ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="font-semibold text-[15px]">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-2xl bg-accent-soft text-accent-ink grid place-items-center mb-3">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted mt-1 max-w-sm">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-danger bg-danger/10 rounded-lg px-3 py-2 mt-3">{message}</p>;
}
