import "server-only";
import { mutate, newId, now, read } from "./store";
import { publish } from "./bus";
import { defaultTeam, type AgentPreset } from "./presets";
import { getTemplate } from "./templates";
import { initWorkspaceFiles, removeWorkspaceFiles } from "./files";
import { currentUser } from "./auth";
import type {
  DB,
  Agent,
  ApprovalMode,
  Label,
  LibraryAgent,
  Priority,
  Ticket,
  TicketEvent,
  TicketEventType,
  TicketStatus,
  Workspace,
} from "./types";

// ---------- Workspaces ----------

export async function createWorkspace(input: {
  name: string;
  description?: string;
  icon?: string;
  template?: string;
}) {
  const tpl = getTemplate(input.template ?? "blank");
  const ws: Workspace = {
    id: newId("ws"),
    name: input.name.trim() || "Untitled workspace",
    icon: input.icon || tpl.icon,
    description: input.description?.trim() ?? "",
    template: tpl.key,
    techStack: tpl.techStack,
    platform: tpl.platform ?? "web",
    autoRunSimulator: tpl.platform === "flutter" ? true : undefined,
    approvalMode: "ask_before_done",
    maxParallelRuns: 2,
    members: currentUser() ? [{ userId: currentUser()!.id, role: "owner" }] : undefined,
    ticketBudgetTokens: 400_000,
    createdAt: now(),
    updatedAt: now(),
  };
  const agents: Agent[] = defaultTeam(ws.platform, tpl.extraAgents).map((p) => agentFromTemplate(ws.id, p));
  await initWorkspaceFiles(ws.id, tpl.files);
  await mutate((db) => {
    db.workspaces.push(ws);
    db.agents.push(...agents);
  });
  return ws;
}

export async function updateWorkspace(id: string, patch: Partial<Workspace>) {
  return mutate((db) => {
    const ws = db.workspaces.find((w) => w.id === id);
    if (!ws) throw new Error("Workspace not found");
    const allowed: (keyof Workspace)[] = [
      "name", "icon", "description", "techStack", "approvalMode", "ticketBudgetTokens", "platform", "simulatorUdid", "autoRunSimulator",
      "maxParallelRuns", "autopilotPaused", "autopilotNote", "commandsEnabled", "extraCommands", "git", "deploy", "memoryReview",
    ];
    for (const k of allowed) if (patch[k] !== undefined) (ws as unknown as Record<string, unknown>)[k] = patch[k];
    const modes: ApprovalMode[] = ["manual", "ask_before_done", "automatic"];
    if (!modes.includes(ws.approvalMode)) ws.approvalMode = "ask_before_done";
    if (ws.maxParallelRuns !== undefined) ws.maxParallelRuns = Math.min(4, Math.max(1, Math.round(Number(ws.maxParallelRuns) || 1)));
    if (patch.autopilotPaused === false) ws.autopilotNote = undefined;
    if (Array.isArray(ws.extraCommands))
      ws.extraCommands = ws.extraCommands.map((c) => String(c).trim()).filter((c) => c && !/[;|&<>`$()]/.test(c)).slice(0, 20);
    // One-click: give the builders and QA the "Run commands" permission (Phase 1–3 teams lack it).
    if ((patch as { grantCommands?: boolean }).grantCommands) {
      const builders = ["frontend_developer", "mobile_developer", "backend_developer", "automation_engineer", "qa_tester"];
      for (const a of db.agents)
        if (a.workspaceId === id && a.presetKey && builders.includes(a.presetKey) && !a.permissions.includes("run_commands"))
          a.permissions.push("run_commands");
    }
    ws.updatedAt = now();
    return { ...ws };
  }).then((ws) => {
    publish(ws.id, { kind: "workspace", workspace: ws });
    return ws;
  });
}

export async function deleteWorkspace(id: string) {
  await mutate((db) => {
    const ticketIds = new Set(db.tickets.filter((t) => t.workspaceId === id).map((t) => t.id));
    db.workspaces = db.workspaces.filter((w) => w.id !== id);
    db.agents = db.agents.filter((a) => a.workspaceId !== id);
    db.tickets = db.tickets.filter((t) => t.workspaceId !== id);
    db.events = db.events.filter((e) => !ticketIds.has(e.ticketId));
    db.checkpoints = db.checkpoints.filter((c) => c.workspaceId !== id);
    db.memories = db.memories.filter((m) => m.workspaceId !== id);
    db.commandRuns = db.commandRuns.filter((r) => r.workspaceId !== id);
    db.deploys = db.deploys.filter((d) => d.workspaceId !== id);
    db.secrets = db.secrets.filter((s) => s.workspaceId !== id);
    db.reviewThreads = (db.reviewThreads ?? []).filter((r) => r.workspaceId !== id);
  });
  await removeWorkspaceFiles(id);
}

export async function getWorkspace(id: string) {
  const db = await read();
  return db.workspaces.find((w) => w.id === id) ?? null;
}

// ---------- Agents ----------

/** Build a workspace agent from a predefined preset or a saved library agent. */
export function agentFromTemplate(
  workspaceId: string,
  t: AgentPreset | LibraryAgent | (Partial<Agent> & { name?: string }),
  opts: { presetKey?: string } = {},
): Agent {
  const preset = "key" in t ? (t as AgentPreset) : null;
  const src = t as Partial<Agent>;
  return {
    id: newId("ag"),
    workspaceId,
    presetKey: preset?.key ?? opts.presetKey,
    name: src.name?.trim() || "New agent",
    role: src.role?.trim() || "Assistant",
    avatar: src.avatar || "🤖",
    color: src.color || "#64748b",
    description: src.description ?? "",
    tone: src.tone || "Friendly and clear",
    systemPrompt: src.systemPrompt?.trim() || "You are a helpful member of this team.",
    model: src.model ?? "",
    permissions: [...(src.permissions ?? ["read_files"])],
    paused: false,
    isPredefined: Boolean(preset),
    createdAt: now(),
  };
}

export async function getAgents(workspaceId: string) {
  const db = await read();
  return db.agents.filter((a) => a.workspaceId === workspaceId);
}

export async function updateAgent(id: string, patch: Partial<Agent>) {
  return mutate((db) => {
    const a = db.agents.find((x) => x.id === id);
    if (!a) throw new Error("Agent not found");
    const allowed: (keyof Agent)[] = [
      "name", "role", "avatar", "color", "description", "tone", "systemPrompt", "model", "permissions", "paused",
    ];
    for (const k of allowed) if (patch[k] !== undefined) (a as unknown as Record<string, unknown>)[k] = patch[k];
    return a;
  });
}

// ---------- Tickets ----------

export async function addEvent(
  ticketId: string,
  actor: string,
  type: TicketEventType,
  content: string,
  meta?: Record<string, unknown>,
) {
  const u = actor === "user" ? currentUser() : null;
  const event: TicketEvent = {
    id: newId("ev"),
    ticketId,
    actor,
    type,
    content,
    meta: u ? { ...(meta ?? {}), by: { id: u.id, name: u.name } } : meta,
    createdAt: now(),
  };
  const wsId = await mutate((db) => {
    db.events.push(event);
    return db.tickets.find((t) => t.id === ticketId)?.workspaceId;
  });
  if (wsId) publish(wsId, { kind: "event", ticketId, event });
  if (type === "comment") void import("./notifications").then((n) => n.onComment(ticketId, actor, content)).catch(() => undefined);
  return event;
}

/** Agents and dependencies referenced by a ticket must live in the same workspace. */
function checkRefs(db: DB, workspaceId: string, ref: { assigneeId?: string | null; dependsOn?: string[]; parentId?: string | null }, selfId?: string) {
  if (ref.assigneeId && !db.agents.some((a) => a.id === ref.assigneeId && a.workspaceId === workspaceId)) throw new Error("That agent isn't part of this workspace.");
  if (ref.parentId && !db.tickets.some((t) => t.id === ref.parentId && t.workspaceId === workspaceId)) throw new Error("Parent ticket isn't in this workspace.");
  for (const d of ref.dependsOn ?? []) {
    if (d === selfId) throw new Error("A ticket can't depend on itself.");
    if (!db.tickets.some((t) => t.id === d && t.workspaceId === workspaceId)) throw new Error("A dependency isn't in this workspace.");
  }
}

export async function createTicket(input: {
  workspaceId: string;
  title: string;
  description?: string;
  priority?: Priority;
  labels?: Label[];
  assigneeId?: string | null;
  parentId?: string | null;
  status?: TicketStatus;
  createdBy?: string;
  dependsOn?: string[];
  queued?: boolean;
  chainDepth?: number;
}) {
  const ticket = await mutate((db) => {
    checkRefs(db, input.workspaceId, input);
    const number = db.tickets.filter((t) => t.workspaceId === input.workspaceId).reduce((m, t) => Math.max(m, t.number), 0) + 1;
    const t: Ticket = {
      id: newId("tk"),
      number,
      workspaceId: input.workspaceId,
      title: input.title.trim() || "Untitled ticket",
      description: input.description?.trim() ?? "",
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      labels: input.labels ?? [],
      assigneeId: input.assigneeId ?? null,
      parentId: input.parentId ?? null,
      createdBy: input.createdBy ?? "user",
      createdAt: now(),
      updatedAt: now(),
      dependsOn: input.dependsOn?.length ? input.dependsOn : undefined,
      queued: input.queued || undefined,
      chainDepth: input.chainDepth ?? 0,
    };
    db.tickets.push(t);
    return t;
  });
  await addEvent(ticket.id, ticket.createdBy, "created", "Ticket created");
  publish(ticket.workspaceId, { kind: "ticket", ticket });
  return ticket;
}

export async function updateTicket(id: string, patch: Partial<Ticket>, actor = "user") {
  const { ticket, changes } = await mutate((db) => {
    const t = db.tickets.find((x) => x.id === id);
    if (!t) throw new Error("Ticket not found");
    checkRefs(db, t.workspaceId, { assigneeId: patch.assigneeId, dependsOn: patch.dependsOn }, t.id);
    const changes: { type: TicketEventType; content: string }[] = [];
    if (patch.status && patch.status !== t.status) {
      changes.push({ type: "status_change", content: `${t.status} → ${patch.status}` });
      t.status = patch.status;
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== t.assigneeId) {
      const name = db.agents.find((a) => a.id === patch.assigneeId);
      changes.push({ type: "assignment", content: name ? `Assigned to ${name.name} (${name.role})` : "Unassigned" });
      t.assigneeId = patch.assigneeId;
    }
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.description !== undefined) t.description = patch.description;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.labels !== undefined) t.labels = patch.labels;
    if (patch.queued !== undefined) t.queued = patch.queued || undefined;
    if (patch.dependsOn !== undefined) t.dependsOn = patch.dependsOn?.length ? patch.dependsOn : undefined;
    if (patch.handoffs !== undefined) t.handoffs = patch.handoffs;
    if (patch.pendingHandoff !== undefined) t.pendingHandoff = patch.pendingHandoff;
    if (patch.forceStart !== undefined) t.forceStart = patch.forceStart || undefined;
    if (patch.resumeCount !== undefined) t.resumeCount = patch.resumeCount;
    if (patch.review !== undefined) t.review = patch.review;
    t.updatedAt = now();
    return { ticket: { ...t }, changes };
  });
  for (const c of changes) await addEvent(id, actor, c.type, c.content);
  publish(ticket.workspaceId, { kind: "ticket", ticket });
  if (changes.some((c) => c.type === "status_change")) {
    void import("./notifications").then((n) => n.onTicketStatus(ticket, ticket.status, actor)).catch((err) => console.error("[luma notify]", err));
  }
  return ticket;
}

export async function deleteTicket(id: string) {
  await mutate((db) => {
    db.tickets = db.tickets.filter((t) => t.id !== id);
    db.events = db.events.filter((e) => e.ticketId !== id);
    db.reviewThreads = (db.reviewThreads ?? []).filter((r) => r.ticketId !== id);
    for (const t of db.tickets) {
      if (t.parentId === id) t.parentId = null;
      if (t.dependsOn?.includes(id)) t.dependsOn = t.dependsOn.filter((d) => d !== id);
    }
  });
}

export async function getTicketBundle(id: string) {
  const db = await read();
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return null;
  return {
    ticket,
    events: db.events.filter((e) => e.ticketId === id),
    children: db.tickets.filter((t) => t.parentId === id),
    parent: ticket.parentId ? db.tickets.find((t) => t.id === ticket.parentId) ?? null : null,
    usage: db.usage
      .filter((u) => u.ticketId === id)
      .reduce((s, u) => ({ tokens: s.tokens + u.inputTokens + u.outputTokens, cost: s.cost + u.costUsd }), { tokens: 0, cost: 0 }),
  };
}
