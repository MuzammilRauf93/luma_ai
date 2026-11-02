"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { api, type TicketView } from "@/lib/client";
import type { Agent, LiveEvent, Workspace, WorkspaceRole } from "@/lib/types";

export interface ActivityItem {
  id: string;
  ticketId: string;
  agentId?: string;
  text: string;
  kind: "text" | "tool" | "start" | "finish" | "error";
  at: number;
}

interface Ctx {
  workspace: Workspace | null;
  agents: Agent[];
  tickets: TicketView[];
  activity: ActivityItem[];
  fileVersion: number;
  /** Bumps whenever any ticket event arrives, so open detail panels can refresh. */
  eventVersion: number;
  /** Bumps whenever team memory changes. */
  memoryVersion: number;
  /** Your role here ("owner" in single-user mode). */
  myRole: WorkspaceRole | null;
  canEdit: boolean;
  /** The signed-in person (null in single-user mode). */
  me: { id: string; name: string } | null;
  /** Listen to every live event (terminal output, deploys…). Returns an unsubscribe function. */
  subscribeLive: (fn: (e: LiveEvent) => void) => () => void;
  reload: () => Promise<void>;
  openTicket: (id: string | null) => void;
  openTicketId: string | null;
  notFound: boolean;
}

const WorkspaceCtx = createContext<Ctx | null>(null);

export function useWorkspace() {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return c;
}

export function WorkspaceProvider({ id, children }: { id: string; children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [fileVersion, setFileVersion] = useState(0);
  const [eventVersion, setEventVersion] = useState(0);
  const [memoryVersion, setMemoryVersion] = useState(0);
  const [myRole, setMyRole] = useState<WorkspaceRole | null>("owner");
  // Deep links from notifications: /w/<id>/board?ticket=<ticketId> opens that ticket.
  const ticketParam = useSearchParams().get("ticket");

  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    api<{ user: { id: string; name: string } | null }>("/api/auth/me").then((m) => setMe(m.user)).catch(() => undefined);
  }, []);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentForTicket = useRef<Record<string, string>>({});
  const liveListeners = useRef(new Set<(e: LiveEvent) => void>());
  const subscribeLive = useCallback((fn: (e: LiveEvent) => void) => {
    liveListeners.current.add(fn);
    return () => {
      liveListeners.current.delete(fn);
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await api<{ workspace: Workspace; agents: Agent[]; tickets: TicketView[]; myRole: WorkspaceRole | null }>(`/api/workspaces/${id}`);
      setMyRole(d.myRole);
      setWorkspace(d.workspace);
      setAgents(d.agents);
      setTickets(d.tickets);
      for (const t of d.tickets) if (t.assigneeId) agentForTicket.current[t.id] = t.assigneeId;
      setNotFound(false);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(reload, 250);
  }, [reload]);

  useEffect(() => {
    reload();
    setActivity([]);
    setOpenTicketId(null);
  }, [reload]);

  useEffect(() => {
    if (ticketParam) setOpenTicketId(ticketParam);
  }, [ticketParam]);

  useEffect(() => {
    const es = new EventSource(`/api/workspaces/${id}/stream`);
    const push = (item: Omit<ActivityItem, "id" | "at">) =>
      setActivity((a) => [...a.slice(-199), { ...item, id: Math.random().toString(36).slice(2), at: Date.now() }]);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as LiveEvent | { kind: "ping" };
      if (e.kind !== "ping") for (const fn of liveListeners.current) fn(e);
      switch (e.kind) {
        case "ping":
          return;
        case "run_started":
          agentForTicket.current[e.ticketId] = e.agentId;
          push({ ticketId: e.ticketId, agentId: e.agentId, kind: "start", text: "Started working" });
          scheduleReload();
          return;
        case "text":
          push({ ticketId: e.ticketId, agentId: agentForTicket.current[e.ticketId], kind: "text", text: e.text });
          return;
        case "tool":
          push({ ticketId: e.ticketId, agentId: agentForTicket.current[e.ticketId], kind: "tool", text: e.summary });
          return;
        case "run_finished":
          push({ ticketId: e.ticketId, agentId: agentForTicket.current[e.ticketId], kind: "finish", text: "Finished this run" });
          scheduleReload();
          window.dispatchEvent(new Event("luma:workspaces"));
          return;
        case "run_error":
          push({ ticketId: e.ticketId, agentId: agentForTicket.current[e.ticketId], kind: "error", text: e.message });
          scheduleReload();
          return;
        case "files_changed":
          setFileVersion((v) => v + 1);
          return;
        case "event":
          setEventVersion((v) => v + 1);
          return;
        case "ticket":
          scheduleReload();
          return;
        case "memory":
          setMemoryVersion((v) => v + 1);
          window.dispatchEvent(new Event("luma:workspaces"));
          return;
        case "notification":
          window.dispatchEvent(new Event("luma:notify"));
          return;
        case "workspace":
          setWorkspace(e.workspace);
          return;
      }
    };
    return () => es.close();
  }, [id, scheduleReload]);

  return (
    <WorkspaceCtx.Provider
      value={{ workspace, agents, tickets, activity, fileVersion, eventVersion, memoryVersion, myRole, canEdit: myRole === "owner" || myRole === "editor", me, subscribeLive, reload, openTicket: setOpenTicketId, openTicketId, notFound }}
    >
      {children}
    </WorkspaceCtx.Provider>
  );
}
