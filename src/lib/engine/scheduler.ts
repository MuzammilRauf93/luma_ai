import "server-only";
import { read } from "../store";
import { addEvent, updateTicket, updateWorkspace } from "../repo";
import { runningTicketIds, startRun } from "./orchestrator";
import { isExecutor } from "../role";
import type { DB, Priority, Ticket } from "../types";

/**
 * Autopilot scheduler (Phase 2): starts queued tickets in the background.
 *
 * - Parallel runs: up to `workspace.maxParallelRuns` agents work at once (default 2),
 *   and each agent works on one ticket at a time.
 * - Dependencies: a queued ticket waits until every ticket in `dependsOn` is Done or In Review.
 * - Loop protection: a circuit breaker pauses autopilot after too many automatic starts
 *   in an hour. (Handoff and sub-ticket limits live in tools.ts.)
 *
 * `kick(workspaceId)` is cheap and idempotent: call it whenever something may have
 * freed a slot or unblocked a ticket.
 */

export const DEFAULT_PARALLEL = 2;
export const MAX_AUTO_STARTS_PER_HOUR = 40;
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const SATISFIED = new Set(["done", "in_review"]);

type State = { chains: Map<string, Promise<void>>; autoStarts: Map<string, number[]> };
const g = globalThis as unknown as { __lumaSched?: State };
const st: State = (g.__lumaSched ??= { chains: new Map(), autoStarts: new Map() });

/** Schedule a scheduling pass for this workspace (serialised per workspace). */
export function kick(workspaceId: string) {
  if (!isExecutor()) return Promise.resolve(); // a web-only process leaves scheduling to workers
  const prev = st.chains.get(workspaceId) ?? Promise.resolve();
  const next = prev.then(() => tick(workspaceId)).catch((err) => {
    console.error("[luma scheduler]", err);
  });
  st.chains.set(workspaceId, next);
  return next;
}

/** Tickets that block `t` from starting (not yet Done / In Review). */
export function blockersOf(t: Ticket, db: Pick<DB, "tickets">) {
  return (t.dependsOn ?? [])
    .map((id) => db.tickets.find((x) => x.id === id))
    .filter((d): d is Ticket => Boolean(d) && !SATISFIED.has(d!.status));
}

async function tick(workspaceId: string) {
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return;
  const tickets = db.tickets.filter((t) => t.workspaceId === workspaceId);

  // Interrupted runs are recovered (and resumed) by runtime.ts using the shared run records.
  if (ws.autopilotPaused) return;

  const running = new Set(runningTicketIds());
  const runningHere = tickets.filter((t) => running.has(t.id));
  let slots = (ws.maxParallelRuns ?? DEFAULT_PARALLEL) - runningHere.length;
  if (slots <= 0) return;
  const busyAgents = new Set(runningHere.map((t) => t.assigneeId));

  const candidates = tickets
    .filter((t) => t.queued && !running.has(t.id) && t.assigneeId && !t.pendingHandoff)
    .filter((t) => !db.agents.find((a) => a.id === t.assigneeId)?.paused)
    .filter((t) => t.forceStart || blockersOf(t, db).length === 0)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.number - b.number);

  for (const t of candidates) {
    if (slots <= 0) break;
    if (busyAgents.has(t.assigneeId)) continue;

    // Circuit breaker: too many automatic starts in the last hour → pause autopilot.
    const hourAgo = Date.now() - 3_600_000;
    const recent = (st.autoStarts.get(workspaceId) ?? []).filter((ts) => ts > hourAgo);
    if (recent.length >= MAX_AUTO_STARTS_PER_HOUR) {
      const note = `Autopilot paused itself after ${recent.length} automatic runs in one hour, to protect your usage. Check the board, then resume when you're ready.`;
      await updateWorkspace(workspaceId, { autopilotPaused: true, autopilotNote: note });
      const { notify } = await import("../notifications");
      await notify({ workspaceId, kind: "autopilot", title: `Autopilot paused in ${ws.name}`, body: note, link: `/w/${workspaceId}/board` }).catch(() => undefined);
      return;
    }

    try {
      const res = await startRun(t.id, { auto: true });
      if (res.started) {
        recent.push(Date.now());
        st.autoStarts.set(workspaceId, recent);
        busyAgents.add(t.assigneeId);
        slots--;
      }
    } catch (err) {
      // Could not start (no login, monthly limit, …): take it out of the queue and say why.
      const message = err instanceof Error ? err.message : String(err);
      await updateTicket(t.id, { queued: false }, "system");
      await addEvent(t.id, "system", "error", `Autopilot couldn't start this ticket: ${message}`);
    }
  }
}
