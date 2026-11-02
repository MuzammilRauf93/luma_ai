import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { read, mutate, newId, now, peek } from "../store";
import { publish } from "../bus";
import { estimateCost, getClient } from "../anthropic";
import { addEvent, updateTicket } from "../repo";
import { kick, DEFAULT_PARALLEL } from "./scheduler";
import { listFiles } from "../files";
import { buildSystemPrompt } from "../presets";
import { memoryBriefing } from "../memory";
import { autoCommitRun } from "../git";
import { secretNames } from "../secrets";
import { newRunState, QUIET_TOOLS, toApiTool, toolsFor, WEB_SEARCH_TOOL, type ToolContext } from "./tools";
import { executeWithAccount } from "./accountRunner";
import { onAgentFinished } from "../simulator";
import type { Agent, Handoff, RunRecord, Ticket, TicketStatus, Workspace } from "../types";
import { HEARTBEAT_MS, isExecutor, STALE_MS, WORKER_ID } from "../role";

/**
 * The orchestrator runs one agent on one ticket. Several runs can be active at once
 * (Phase 2 parallel runs, scheduled by scheduler.ts).
 * It loops Claude ⇄ tools until the agent calls finish_ticket / ask_user, hits the
 * turn limit, or exceeds the ticket's token budget. Progress is persisted as
 * ticket events and streamed live to the UI through the bus.
 */

const MAX_TURNS = 30;
const MAX_TOKENS = 16_000;

/** Runs executing in THIS process: ticketId → controller. The shared truth is `db.runs`. */
type Runs = Map<string, AbortController>;
const g = globalThis as unknown as { __lumaRuns?: Runs };
const runs: Runs = (g.__lumaRuns ??= new Map());

const fresh = (r: RunRecord) => r.status === "running" && Date.now() - new Date(r.heartbeatAt).getTime() < STALE_MS + HEARTBEAT_MS;

/** Is any Luma process (this one or a worker) running this ticket right now? */
export function isRunning(ticketId: string) {
  return runs.has(ticketId) || Boolean(peek()?.runs.some((r) => r.ticketId === ticketId && fresh(r)));
}

export function runningTicketIds() {
  return [...new Set([...runs.keys(), ...(peek()?.runs.filter(fresh).map((r) => r.ticketId) ?? [])])];
}

export function localRunTicketIds() {
  return [...runs.keys()];
}

/** Stop a run here, or ask the worker that owns it to stop (picked up on its next heartbeat). */
export async function cancelRun(ticketId: string) {
  const ctrl = runs.get(ticketId);
  if (ctrl) {
    ctrl.abort();
    return true;
  }
  return mutate((db) => {
    const r = db.runs.find((x) => x.ticketId === ticketId && x.status === "running");
    if (!r) return false;
    r.cancelRequested = true;
    return true;
  });
}

class Busy extends Error {}

export type StartResult = { started: true; queued?: false } | { started: false; queued: true; reason: string };

/**
 * Start a run in the background. Returns immediately.
 * If every parallel slot is taken, or the agent is busy with another ticket, the ticket
 * is queued instead and the scheduler starts it as soon as possible.
 */
// `auto` marks scheduler starts (the scheduler already checked dependencies; manual runs may override them).
export async function startRun(ticketId: string, opts: { auto?: boolean } = {}): Promise<StartResult> {
  void opts;
  if (isRunning(ticketId)) throw new Error("An agent is already working on this ticket.");
  const db = await read();
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error("Ticket not found");
  const agent = db.agents.find((a) => a.id === ticket.assigneeId);
  if (!agent) throw new Error("Assign this ticket to an agent first.");
  if (agent.paused) throw new Error(`${agent.name} is paused. Resume the agent to run this ticket.`);
  const workspace = db.workspaces.find((w) => w.id === ticket.workspaceId)!;
  if (ticket.pendingHandoff) throw new Error("This ticket has a handoff waiting for your approval. Approve or decline it first.");

  // Web-only process (LUMA_ROLE=web): hand the run to a background worker.
  if (!isExecutor()) {
    await updateTicket(ticketId, { queued: true, forceStart: true }, "system");
    return { started: false, queued: true, reason: "Sent to a background worker; it starts in a moment." };
  }

  // Parallel-run limits: one ticket per agent, and at most N agents per workspace.
  const active = db.tickets.filter((t) => t.workspaceId === workspace.id && isRunning(t.id));
  const agentBusy = active.find((t) => t.assigneeId === agent.id);
  const limit = workspace.maxParallelRuns ?? DEFAULT_PARALLEL;
  const queueIt = async (reason: string): Promise<StartResult> => {
    if (!ticket.queued) {
      await updateTicket(ticketId, { queued: true, forceStart: !opts.auto || ticket.forceStart }, "system");
      await addEvent(ticketId, "system", "comment", `Queued. ${reason}`);
    }
    return { started: false, queued: true, reason };
  };
  if (agentBusy || active.length >= limit) {
    const reason = agentBusy
      ? `${agent.name} is busy with LUM-${agentBusy.number}. This ticket will start when they're free.`
      : `${active.length === 1 ? "An agent is" : `${active.length} agents are`} already working (your limit is ${limit} at a time). This ticket will start when one finishes.`;
    return queueIt(reason);
  }
  const useAccount = db.settings.authMode === "claude_account";
  const model = agent.model || db.settings.defaultModel || "";
  if (!useAccount) {
    if (!db.settings.encryptedApiKey) throw new Error("Connect your Claude account in Settings first.");
    if (!model) throw new Error("No model selected. Choose a default model in Settings.");
  }
  const monthly = db.settings.monthlyLimitUsd;
  if (monthly) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const spent = db.usage.filter((u) => new Date(u.createdAt) >= monthStart).reduce((s, u) => s + u.costUsd, 0);
    if (spent >= monthly) throw new Error(`You've reached your monthly limit of $${monthly}. Raise it in Settings to keep going.`);
  }

  // Claim the run atomically across processes (another worker may be racing for it).
  const runId = newId("run");
  try {
    await mutate((d) => {
      const live = d.runs.filter(fresh);
      if (live.some((r) => r.ticketId === ticketId)) throw new Error("An agent is already working on this ticket.");
      const here = live.filter((r) => r.workspaceId === workspace.id);
      if (here.length >= limit || here.some((r) => r.agentId === agent.id)) throw new Busy("All slots are taken right now.");
      const t = new Date().toISOString();
      d.runs.push({ id: runId, ticketId, workspaceId: workspace.id, agentId: agent.id, workerId: WORKER_ID, status: "running", startedAt: t, heartbeatAt: t });
      if (d.runs.length > 1000) d.runs = d.runs.filter((r, i) => r.status === "running" || i >= d.runs.length - 1000);
    });
  } catch (err) {
    if (err instanceof Busy) return queueIt("Another agent just took the last free slot. This ticket will start when one finishes.");
    throw err;
  }
  const ctrl = new AbortController();
  runs.set(ticketId, ctrl);
  if (ticket.queued || ticket.forceStart) await updateTicket(ticketId, { queued: false, forceStart: false }, "system");
  const input: RunInput = {
    ticket,
    agent,
    workspace,
    model,
    team: db.agents.filter((a) => a.workspaceId === workspace.id),
    signal: ctrl.signal,
    controller: ctrl,
    startedAt: new Date().toISOString(),
  };
  let outcome: RunRecord["status"] = "finished";
  void (useAccount ? executeWithAccount(input) : execute(input))
    .then((result) => finishRun(input, result))
    .then(() => onAgentFinished(workspace.id, ticketId).catch(() => undefined))
    .catch(async (err: unknown) => {
      const aborted = ctrl.signal.aborted;
      outcome = aborted ? "cancelled" : "failed";
      const message = aborted ? "Stopped by you." : err instanceof Error ? err.message : String(err);
      await addEvent(ticketId, "system", "error", message);
      await updateTicket(ticketId, { status: aborted ? "todo" : "failed", queued: false }, "system");
      publish(workspace.id, { kind: "run_error", ticketId, message });
    })
    .finally(async () => {
      runs.delete(ticketId);
      await mutate((d) => {
        const r = d.runs.find((x) => x.id === runId);
        if (r) Object.assign(r, { status: outcome, finishedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
      }).catch(() => undefined);
      void kick(workspace.id);
    });
  return { started: true };
}

/** What an engine run ended with. */
export interface RunResult {
  status: TicketStatus;
  handoff?: { toAgentId: string; note: string };
}

/**
 * Apply the end of a run: plain status change, or an automatic handoff to a teammate.
 * In "manual" approval mode a handoff waits for the user's approval instead.
 */
async function finishRun(input: RunInput, result: RunResult) {
  await applyResult(input, result);
  await commitRun(input).catch(async (err) => {
    await addEvent(input.ticket.id, "system", "error", `Couldn't commit this run to git: ${err instanceof Error ? err.message : String(err)}`);
  });
}

/** Git sync: one commit per agent run that changed files, authored as the agent. */
async function commitRun(input: RunInput) {
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === input.workspace.id);
  if (!ws?.git?.enabled) return;
  const ticket = db.tickets.find((t) => t.id === input.ticket.id) ?? input.ticket;
  const summary = [...db.events].reverse().find((e) => e.ticketId === ticket.id && e.type === "summary" && e.actor === input.agent.id);
  const paths = [
    ...new Set(
      db.checkpoints
        .filter((c) => c.workspaceId === ws.id && c.ticketId === ticket.id && c.actor === input.agent.id && c.createdAt >= input.startedAt)
        .map((c) => c.path),
    ),
  ];
  const res = await autoCommitRun(ws, {
    ticketNumber: ticket.number,
    title: ticket.title,
    agentName: input.agent.name,
    agentRole: input.agent.role,
    summary: summary?.content,
    paths,
  });
  if (res) {
    await addEvent(
      ticket.id,
      "system",
      "commit",
      `Committed ${res.sha} to ${ws.git.branch}${res.pushed ? " and pushed to GitHub" : ""}.${res.pushError ? ` Push failed: ${res.pushError}` : ""}`,
      { sha: res.sha, pushed: res.pushed, repo: ws.git.githubRepo },
    );
  }
}

async function applyResult(input: RunInput, result: RunResult) {
  const { ticket, agent, workspace } = input;
  if (!result.handoff) {
    await updateTicket(ticket.id, { status: result.status }, agent.id);
    publish(workspace.id, { kind: "run_finished", ticketId: ticket.id, status: result.status });
    return;
  }
  const db = await read();
  const fresh = db.tickets.find((t) => t.id === ticket.id) ?? ticket;
  const to = db.agents.find((a) => a.id === result.handoff!.toAgentId);
  const h: Handoff = { fromAgentId: agent.id, toAgentId: result.handoff.toAgentId, note: result.handoff.note, at: new Date().toISOString() };
  const toName = to ? `${to.name} (${to.role})` : "a teammate";
  await addEvent(ticket.id, agent.id, "handoff", `Handed this ticket to ${toName}: ${h.note}`, { to: h.toAgentId });

  if (workspace.approvalMode === "manual") {
    await updateTicket(ticket.id, { status: "waiting_for_user", pendingHandoff: h }, agent.id);
    await addEvent(ticket.id, "system", "approval", `${agent.name} wants to hand this ticket to ${toName}. Approve the handoff to let them start.`);
    publish(workspace.id, { kind: "run_finished", ticketId: ticket.id, status: "waiting_for_user" });
    return;
  }
  await updateTicket(
    ticket.id,
    { status: "todo", assigneeId: h.toAgentId, handoffs: [...(fresh.handoffs ?? []), h], queued: true, pendingHandoff: null },
    agent.id,
  );
  publish(workspace.id, { kind: "run_finished", ticketId: ticket.id, status: "todo" });
}

/** Approve or decline a handoff that is waiting for the user (manual mode). */
export async function resolveHandoff(ticketId: string, approve: boolean) {
  const db = await read();
  const t = db.tickets.find((x) => x.id === ticketId);
  if (!t) throw new Error("Ticket not found");
  const h = t.pendingHandoff;
  if (!h) throw new Error("There's no handoff waiting on this ticket.");
  const to = db.agents.find((a) => a.id === h.toAgentId);
  if (!approve || !to) {
    await updateTicket(ticketId, { pendingHandoff: null, status: "in_review" }, "user");
    await addEvent(ticketId, "user", "approval", to ? `Declined the handoff to ${to.name}.` : "Declined the handoff (that teammate no longer exists).");
    return { started: false as const };
  }
  await updateTicket(ticketId, { pendingHandoff: null, assigneeId: to.id, status: "todo", handoffs: [...(t.handoffs ?? []), h] }, "user");
  await addEvent(ticketId, "user", "approval", `Approved the handoff to ${to.name}.`);
  return startRun(ticketId);
}

export interface RunInput {
  ticket: Ticket;
  agent: Agent;
  workspace: Workspace;
  model: string;
  team: Agent[];
  signal: AbortSignal;
  controller: AbortController;
  startedAt: string;
}

function platformNotes(ws: Workspace) {
  if (ws.platform !== "flutter") return "";
  return `
Platform notes: this is a Flutter app that runs live in the iOS Simulator with hot reload.
- Write Dart in lib/ (entry point lib/main.dart, keep the MyApp widget). Split screens/widgets into lib/screens/ and lib/widgets/.
- Add packages to pubspec.yaml only when really needed, with exact versions you are sure exist.
- Never edit ios/, build/ or .dart_tool/; they are generated.
- Write code that compiles: correct imports, null-safety, const constructors where possible. If the ticket history shows a build error, fix that first.`;
}

export async function buildBriefing(ticket: Ticket, workspace: Workspace, team: Agent[]) {
  const db = await read();
  const events = db.events.filter((e) => e.ticketId === ticket.id);
  const nameOf = (id: string) =>
    id === "user" ? "User" : id === "system" ? "System" : (team.find((a) => a.id === id)?.name ?? "Agent");
  const history = events
    .filter((e) => ["comment", "question", "summary", "error", "handoff", "approval"].includes(e.type))
    .map((e) => `- [${e.type}] ${nameOf(e.actor)}: ${e.content}`)
    .join("\n");
  const parent = ticket.parentId ? db.tickets.find((t) => t.id === ticket.parentId) : null;
  const files = await listFiles(workspace.id);
  const secrets = await secretNames(workspace.id);
  const memory = await memoryBriefing(ticket, (id) => (id === "user" ? "from the user" : `by ${nameOf(id)}`));
  const deps = (ticket.dependsOn ?? [])
    .map((id) => db.tickets.find((t) => t.id === id))
    .filter((t): t is Ticket => Boolean(t));
  const recent = db.tickets
    .filter((t) => t.workspaceId === workspace.id && t.id !== ticket.id && ["done", "in_review"].includes(t.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6)
    .map((t) => {
      const summary = [...db.events].reverse().find((e) => e.ticketId === t.id && e.type === "summary");
      return `- LUM-${t.number} “${t.title}” (${nameOf(t.assigneeId ?? "")}, ${t.status.replace(/_/g, " ")})${summary ? `: ${summary.content.replace(/\s*\n\s*/g, " ").slice(0, 280)}` : ""}`;
    });
  const running = db.tickets.filter(
    (t) => t.workspaceId === workspace.id && t.id !== ticket.id && runs.has(t.id),
  );

  return `# Workspace
Name: ${workspace.name}
About: ${workspace.description || "(no description)"}
Tech stack: ${workspace.techStack}${platformNotes(workspace)}

# Team
${team.map((a) => `- ${a.name} — ${a.role}${a.paused ? " (paused)" : ""}`).join("\n")}

# Your ticket: LUM-${ticket.number} — ${ticket.title}
Priority: ${ticket.priority}${ticket.labels.length ? ` · Labels: ${ticket.labels.join(", ")}` : ""}

${ticket.description || "(no description)"}
${parent ? `\nThis ticket is part of LUM-${parent.number} “${parent.title}”:\n${parent.description}\n` : ""}
${ticket.resumeCount ? `\nNOTE: a previous run on this ticket was interrupted (Luma restarted). Files it already changed: ${[...new Set(events.filter((e) => e.type === "file_change").map((e) => String(e.meta?.path ?? "")))].filter(Boolean).join(", ") || "none"}. Check them and continue from there instead of starting over.\n` : ""}${deps.length ? `\nBuilds on: ${deps.map((d) => `LUM-${d.number} “${d.title}” (${d.status.replace(/_/g, " ")})`).join(", ")}\n` : ""}
${recent.length ? `# Recently finished by the team\n${recent.join("\n")}\nThis work is already in the files: build on it, don't redo it, and re-read files before reporting something as missing.\n\n` : ""}${secrets.length ? `# Secrets\nThese are set as environment variables when commands run${workspace.platform === "flutter" ? " and as --dart-define values in web builds (String.fromEnvironment)" : ""}: ${secrets.join(", ")}.\nNever write secret values into files. Reference them by name (e.g. process.env.${secrets[0]}${workspace.platform === "flutter" ? ` or const String.fromEnvironment('${secrets[0]}')` : ""}). You can't see their values.\n\n` : ""}# Team memory
${memory.text ? `${memory.text}${memory.total > memory.shown ? `\n(${memory.total - memory.shown} more: use recall to search them)` : ""}\nFollow these decisions and conventions. Things marked "from the user" are the user's wishes and win over your own preferences.` : "(empty — use remember to save decisions and conventions the team should follow)"}

# Ticket history
${history || "(none yet)"}
${running.length ? `\n# Teammates working right now\n${running.map((t) => `- ${nameOf(t.assigneeId ?? "")} on LUM-${t.number} “${t.title}”`).join("\n")}\nThey may change files while you work. Read a file right before you change it, and stay inside your ticket's scope.\n` : ""}

# Project files
${files.map((f) => f.path).join("\n") || "(empty)"}

Please complete this ticket now. When you are done, call finish_ticket.`;
}

/**
 * Tokens that count against the per-run budget. Cache reads are ~10× cheaper than fresh input
 * and every turn re-reads the whole conversation, so they count at 10% (real runs showed
 * 100–200k "input" per small Flutter ticket, almost all cache reads).
 */
export function budgetTokens(u: { input_tokens?: number | null; output_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) {
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + Math.round((u.cache_read_input_tokens ?? 0) * 0.1) + (u.output_tokens ?? 0);
}

async function recordUsage(input: RunInput, usage: Anthropic.Usage) {
  const inputTokens =
    usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const outputTokens = usage.output_tokens;
  await mutate((db) => {
    db.usage.push({
      id: newId("us"),
      workspaceId: input.workspace.id,
      agentId: input.agent.id,
      ticketId: input.ticket.id,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd: estimateCost(input.model, inputTokens, outputTokens),
      createdAt: now(),
    });
  });
  return budgetTokens(usage);
}

async function execute(input: RunInput): Promise<RunResult> {
  const { ticket, agent, workspace, model, team, signal } = input;
  const client = await getClient();
  const tools = toolsFor(agent);
  const ctx: ToolContext = { workspace, agent, ticket, team, run: newRunState(), signal };
  const apiTools: Anthropic.ToolUnion[] = tools.map(toApiTool);
  if (agent.permissions.includes("web_research")) apiTools.push(WEB_SEARCH_TOOL);

  publish(workspace.id, { kind: "run_started", ticketId: ticket.id, agentId: agent.id });
  await updateTicket(ticket.id, { status: "in_progress" }, agent.id);

  const system = buildSystemPrompt(agent.systemPrompt, agent.tone);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: await buildBriefing(ticket, workspace, team) },
  ];

  let tokensUsed = 0;
  let finalStatus: TicketStatus | null = null;
  let handoff: RunResult["handoff"];

  for (let turn = 0; turn < MAX_TURNS && !finalStatus; turn++) {
    const response = await client.messages.create(
      {
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools: apiTools,
        messages,
      },
      { signal },
    );
    tokensUsed += await recordUsage(input, response.usage);
    messages.push({ role: "assistant", content: response.content });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) {
      publish(workspace.id, { kind: "text", ticketId: ticket.id, text });
      await addEvent(ticket.id, agent.id, "agent_message", text);
    }

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (response.stop_reason === "pause_turn") continue; // server tool (web search) paused a long turn
      if (response.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: "Your last reply was cut off. Continue, keeping files complete." });
        continue;
      }
      // The agent stopped talking without calling finish_ticket: treat its message as the summary.
      await addEvent(ticket.id, agent.id, "summary", text || "Finished without a summary.");
      finalStatus = "in_review";
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const def = tools.find((t) => t.name === use.name);
      const params = (use.input ?? {}) as Record<string, unknown>;
      if (!def) {
        results.push({ type: "tool_result", tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true });
        continue;
      }
      const summary = def.summarize(params);
      publish(workspace.id, { kind: "tool", ticketId: ticket.id, name: use.name, summary });
      if (!QUIET_TOOLS.includes(use.name)) {
        await addEvent(ticket.id, agent.id, "tool_call", summary, { tool: use.name });
      }
      let outcome;
      try {
        outcome = await def.run(params, ctx);
      } catch (err) {
        outcome = { kind: "continue" as const, result: err instanceof Error ? err.message : String(err), isError: true };
      }
      if (outcome.kind === "continue") {
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.result, is_error: outcome.isError });
      } else if (outcome.kind === "ask_user") {
        await addEvent(ticket.id, agent.id, "question", outcome.question);
        finalStatus = "waiting_for_user";
        results.push({ type: "tool_result", tool_use_id: use.id, content: "Question sent to the user." });
      } else if (outcome.kind === "handoff") {
        handoff = { toAgentId: outcome.toAgentId, note: outcome.note };
        finalStatus = "todo";
        results.push({ type: "tool_result", tool_use_id: use.id, content: "Handoff recorded." });
      } else {
        await addEvent(ticket.id, agent.id, "summary", outcome.summary);
        finalStatus = outcome.status;
        results.push({ type: "tool_result", tool_use_id: use.id, content: "Ticket finished." });
      }
    }
    messages.push({ role: "user", content: results });

    if (!finalStatus && tokensUsed > workspace.ticketBudgetTokens) {
      await addEvent(
        ticket.id,
        "system",
        "question",
        `This ticket reached its budget of ${workspace.ticketBudgetTokens.toLocaleString()} tokens, so ${agent.name} paused. Reply with a comment and run it again to continue.`,
      );
      finalStatus = "waiting_for_user";
    }
  }

  if (!finalStatus) {
    await addEvent(ticket.id, "system", "question", `${agent.name} reached the step limit (${MAX_TURNS}) without finishing. Review the progress and run again to continue.`);
    finalStatus = "waiting_for_user";
  }

  return { status: finalStatus, handoff };
}
