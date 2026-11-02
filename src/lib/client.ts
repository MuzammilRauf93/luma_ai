"use client";

import type { Agent, Ticket, TicketStatus, Priority } from "./types";

export type TicketView = Ticket & { running?: boolean };

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const STATUS_STYLE: Record<TicketStatus, { dot: string; label: string }> = {
  backlog: { dot: "#a8a29e", label: "Backlog" },
  todo: { dot: "#64748b", label: "To Do" },
  in_progress: { dot: "#2563eb", label: "In Progress" },
  in_review: { dot: "#7c3aed", label: "In Review" },
  waiting_for_user: { dot: "#d97706", label: "Waiting for You" },
  done: { dot: "#059669", label: "Done" },
  blocked: { dot: "#be123c", label: "Blocked" },
  failed: { dot: "#dc2626", label: "Failed" },
};

export const PRIORITY_STYLE: Record<Priority, { color: string; label: string }> = {
  low: { color: "#a8a29e", label: "Low" },
  medium: { color: "#0ea5e9", label: "Medium" },
  high: { color: "#f59e0b", label: "High" },
  urgent: { color: "#ef4444", label: "Urgent" },
};

export function agentById(agents: Agent[], id: string | null | undefined) {
  return agents.find((a) => a.id === id) ?? null;
}

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtUsd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
export const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
