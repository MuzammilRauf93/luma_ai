import "server-only";
import type { DB } from "./types";

/**
 * Workspace insights (Phase 6), computed on demand from runs, usage, tickets, events,
 * command runs and deploys. Days are UTC calendar days.
 */

const DAY = 864e5;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function workspaceMetrics(db: DB, workspaceId: string, days: number) {
  const end = Date.now();
  const start = new Date(new Date(end - (days - 1) * DAY).toISOString().slice(0, 10)).getTime();
  const inRange = (iso?: string) => Boolean(iso) && new Date(iso!).getTime() >= start;

  const runs = db.runs.filter((r) => r.workspaceId === workspaceId && inRange(r.startedAt) && r.status !== "running");
  const usage = db.usage.filter((u) => u.workspaceId === workspaceId && inRange(u.createdAt));
  const tickets = db.tickets.filter((t) => t.workspaceId === workspaceId);
  const ticketIds = new Set(tickets.map((t) => t.id));
  const events = db.events.filter((e) => ticketIds.has(e.ticketId) && inRange(e.createdAt));
  const cmds = db.commandRuns.filter((c) => c.workspaceId === workspaceId && inRange(c.createdAt) && c.status !== "running");
  const deploys = db.deploys.filter((d) => d.workspaceId === workspaceId && inRange(d.createdAt));

  // When did each ticket first reach Done / In Review?
  const reached = (to: string) => {
    const m = new Map<string, string>();
    for (const e of db.events)
      if (ticketIds.has(e.ticketId) && e.type === "status_change" && e.content.endsWith(`→ ${to}`) && !m.has(e.ticketId)) m.set(e.ticketId, e.createdAt);
    return m;
  };
  const doneAt = reached("done");
  const reviewAt = reached("in_review");
  const hoursTo = (m: Map<string, string>) =>
    tickets
      .filter((t) => m.has(t.id) && inRange(m.get(t.id)))
      .map((t) => (new Date(m.get(t.id)!).getTime() - new Date(t.createdAt).getTime()) / 3_600_000)
      .filter((h) => h >= 0);

  const completed = runs.filter((r) => r.status === "finished");
  const durations = completed.filter((r) => r.finishedAt).map((r) => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000);
  const tokens = usage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
  const cost = usage.reduce((s, u) => s + u.costUsd, 0);
  const cmdJudged = cmds.filter((c) => c.status !== "refused");

  // Daily series
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(start + i * DAY).toISOString().slice(0, 10);
    return { date: d, completed: 0, notFinished: 0, tokens: 0 };
  });
  const idx = (iso: string) => Math.floor((new Date(iso.slice(0, 10)).getTime() - start) / DAY);
  for (const r of runs) {
    const s = series[idx(r.startedAt)];
    if (s) r.status === "finished" ? s.completed++ : s.notFinished++;
  }
  for (const u of usage) {
    const s = series[idx(u.createdAt)];
    if (s) s.tokens += u.inputTokens + u.outputTokens;
  }

  // Per agent
  const agents = db.agents
    .filter((a) => a.workspaceId === workspaceId)
    .map((a) => {
      const ar = runs.filter((r) => r.agentId === a.id);
      const ok = ar.filter((r) => r.status === "finished");
      const au = usage.filter((u) => u.agentId === a.id);
      const d = ok.filter((r) => r.finishedAt).map((r) => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000);
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        avatar: a.avatar,
        color: a.color,
        runs: ar.length,
        completed: ok.length,
        failed: ar.filter((r) => r.status === "failed").length,
        successRate: ar.length ? ok.length / ar.length : null,
        avgSeconds: avg(d),
        tokens: au.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0),
        cost: au.reduce((s, u) => s + u.costUsd, 0),
        ticketsDone: tickets.filter((t) => t.assigneeId === a.id && doneAt.has(t.id) && inRange(doneAt.get(t.id))).length,
        handoffsOut: events.filter((e) => e.type === "handoff" && e.actor === a.id).length,
        commands: cmds.filter((c) => c.actor === a.id).length,
      };
    })
    .filter((a) => a.runs || a.tokens)
    .sort((x, y) => y.runs - x.runs);

  return {
    days,
    since: new Date(start).toISOString(),
    totals: {
      runs: runs.length,
      completed: completed.length,
      failed: runs.filter((r) => r.status === "failed").length,
      cancelled: runs.filter((r) => r.status === "cancelled").length,
      interrupted: runs.filter((r) => r.status === "interrupted").length,
      successRate: runs.length ? completed.length / runs.length : null,
      medianRunSeconds: median(durations),
      tokens,
      costUsd: cost,
      ticketsCreated: tickets.filter((t) => inRange(t.createdAt)).length,
      ticketsDone: [...doneAt.values()].filter(inRange).length,
      medianHoursToDone: median(hoursTo(doneAt)),
      medianHoursToReview: median(hoursTo(reviewAt)),
      handoffs: events.filter((e) => e.type === "handoff").length,
      questions: events.filter((e) => e.type === "question").length,
      commands: cmds.length,
      commandPassRate: cmdJudged.length ? cmdJudged.filter((c) => c.status === "ok").length / cmdJudged.length : null,
      deploys: deploys.filter((d) => d.status === "ready").length,
      deployFailures: deploys.filter((d) => d.status === "error").length,
      openTickets: tickets.filter((t) => !["done"].includes(t.status)).length,
    },
    series,
    agents,
  };
}

export type WorkspaceMetrics = ReturnType<typeof workspaceMetrics>;
