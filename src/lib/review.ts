import "server-only";
import { mutate, newId, now, read } from "./store";
import { publish } from "./bus";
import { currentUser } from "./auth";
import { getBlob, readFile } from "./files";
import { diffLines, toHunks } from "./diff";
import { addEvent, updateTicket } from "./repo";
import { complete, extractJson } from "./oneshot";
import type { Checkpoint, ReviewThread, Ticket } from "./types";

/**
 * Code review (IDE review panel): line comment threads on files, per-ticket change sets,
 * approve / request changes, and on-demand AI review.
 */

function author() {
  const u = currentUser();
  return u ? { author: u.id, authorName: u.name } : { author: "user", authorName: "You" };
}

const changed = (wsId: string) => publish(wsId, { kind: "review", workspaceId: wsId });

/** Find where a thread's line is now (files change after comments are written). */
export function anchor(t: Pick<ReviewThread, "line" | "lineText">, lines: string[] | null) {
  if (!lines) return { line: t.line, outdated: true };
  if (lines[t.line - 1] === t.lineText) return { line: t.line, outdated: false };
  if (t.lineText.trim()) {
    let best = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i] === t.lineText && (best < 0 || Math.abs(i + 1 - t.line) < Math.abs(best + 1 - t.line))) best = i;
    if (best >= 0) return { line: best + 1, outdated: false };
  }
  return { line: Math.min(Math.max(1, t.line), Math.max(1, lines.length)), outdated: true };
}

export async function listThreads(wsId: string, filter: { path?: string | null; ticketId?: string | null }) {
  const db = await read();
  const list = (db.reviewThreads ?? []).filter((t) => t.workspaceId === wsId && (!filter.path || t.path === filter.path) && (!filter.ticketId || t.ticketId === filter.ticketId));
  const cache = new Map<string, string[] | null>();
  const out = [];
  for (const t of list) {
    if (!cache.has(t.path)) {
      const c = await readFile(wsId, t.path, { skipPull: true });
      cache.set(t.path, c === null ? null : c.split("\n"));
    }
    out.push({ ...t, ...anchor(t, cache.get(t.path)!) });
  }
  return out;
}

export async function addComment(wsId: string, input: { threadId?: string; path?: string; line?: number; ticketId?: string | null; text: string; severity?: ReviewThread["severity"] }) {
  const text = input.text?.trim();
  if (!text) throw new Error("Write a comment first.");
  const who = author();
  const comment = { id: newId("rc"), ...who, text, createdAt: now() };
  if (input.threadId) {
    const t = await mutate((db) => {
      const t = (db.reviewThreads ?? []).find((x) => x.id === input.threadId && x.workspaceId === wsId);
      if (!t) throw new Error("Comment thread not found");
      t.comments.push(comment);
      t.status = "open";
      t.updatedAt = now();
      return { ...t };
    });
    changed(wsId);
    return t;
  }
  if (!input.path || !input.line || input.line < 1) throw new Error("Pick a line to comment on.");
  const content = await readFile(wsId, input.path);
  if (content === null) throw new Error(`File not found: ${input.path}`);
  const lines = content.split("\n");
  const line = Math.min(input.line, lines.length);
  const t: ReviewThread = {
    id: newId("rt"),
    workspaceId: wsId,
    path: input.path,
    line,
    lineText: lines[line - 1] ?? "",
    ticketId: input.ticketId ?? null,
    status: "open",
    severity: input.severity,
    comments: [comment],
    createdAt: now(),
    updatedAt: now(),
  };
  await mutate((db) => {
    if (t.ticketId && !db.tickets.some((x) => x.id === t.ticketId && x.workspaceId === wsId)) throw new Error("That ticket isn't in this workspace.");
    (db.reviewThreads ??= []).push(t);
  });
  changed(wsId);
  return t;
}

export async function setThreadStatus(wsId: string, threadId: string, status: ReviewThread["status"]) {
  await mutate((db) => {
    const t = (db.reviewThreads ?? []).find((x) => x.id === threadId && x.workspaceId === wsId);
    if (!t) throw new Error("Comment thread not found");
    t.status = status;
    t.updatedAt = now();
  });
  changed(wsId);
}

export async function deleteComment(wsId: string, threadId: string, commentId?: string) {
  const me = author().author;
  await mutate((db) => {
    const t = (db.reviewThreads ?? []).find((x) => x.id === threadId && x.workspaceId === wsId);
    if (!t) throw new Error("Comment thread not found");
    const isAdmin = currentUser()?.role === "admin";
    if (!commentId || t.comments.length === 1 || t.comments[0].id === commentId) {
      if (!isAdmin && t.comments[0].author !== me && t.comments[0].author !== "reviewer") throw new Error("Only the author can delete this thread.");
      db.reviewThreads = db.reviewThreads.filter((x) => x.id !== threadId);
    } else {
      const c = t.comments.find((x) => x.id === commentId);
      if (!c) throw new Error("Comment not found");
      if (!isAdmin && c.author !== me) throw new Error("You can only delete your own comments.");
      t.comments = t.comments.filter((x) => x.id !== commentId);
    }
  });
  changed(wsId);
}

// ---------------------------------------------------------------- change sets

function ticketCheckpoints(cps: Checkpoint[], ticketId: string) {
  const byPath = new Map<string, Checkpoint[]>();
  for (const c of cps) if (c.ticketId === ticketId) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
  return byPath;
}

/** Tickets whose agents changed files, newest first; "In Review" tickets on top. */
export async function changeSets(wsId: string) {
  const db = await read();
  const cps = db.checkpoints.filter((c) => c.workspaceId === wsId && c.ticketId);
  const last = new Map<string, { at: string; paths: Set<string> }>();
  for (const c of cps) {
    const e = last.get(c.ticketId!) ?? { at: c.createdAt, paths: new Set<string>() };
    e.at = c.createdAt > e.at ? c.createdAt : e.at;
    e.paths.add(c.path);
    last.set(c.ticketId!, e);
  }
  const threads = (db.reviewThreads ?? []).filter((t) => t.workspaceId === wsId);
  return db.tickets
    .filter((t) => t.workspaceId === wsId && last.has(t.id))
    .map((t) => ({
      ticketId: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      assigneeId: t.assigneeId,
      files: last.get(t.id)!.paths.size,
      lastAt: last.get(t.id)!.at,
      openThreads: threads.filter((x) => x.ticketId === t.id && x.status === "open").length,
      review: t.review ?? null,
    }))
    .sort((a, b) => Number(b.status === "in_review") - Number(a.status === "in_review") || b.lastAt.localeCompare(a.lastAt))
    .slice(0, 60);
}

export async function markViewed(wsId: string, ticketId: string, path: string, viewed: boolean) {
  const db = await read();
  const t = db.tickets.find((x) => x.id === ticketId && x.workspaceId === wsId);
  if (!t) throw new Error("Ticket not found");
  const set = new Set(t.review?.viewed ?? []);
  if (viewed) set.add(path);
  else set.delete(path);
  await updateTicket(ticketId, { review: { ...(t.review ?? {}), viewed: [...set] } }, "user");
  changed(wsId);
}

// ---------------------------------------------------------------- verdicts

export async function submitVerdict(wsId: string, ticketId: string, verdict: "approve" | "request_changes", note?: string) {
  const db = await read();
  const t = db.tickets.find((x) => x.id === ticketId && x.workspaceId === wsId);
  if (!t) throw new Error("Ticket not found");
  const who = author();
  const review = { ...(t.review ?? {}), verdict: verdict === "approve" ? ("approved" as const) : ("changes_requested" as const), by: who.authorName, at: now() };
  if (verdict === "approve") {
    await updateTicket(ticketId, { status: "done", review }, "user");
    await addEvent(ticketId, "user", "comment", `Approved the changes.${note?.trim() ? `\n\n${note.trim()}` : ""}`);
    changed(wsId);
    return { started: false };
  }
  const open = (db.reviewThreads ?? []).filter((x) => x.ticketId === ticketId && x.status === "open");
  if (!open.length && !note?.trim()) throw new Error("Add a line comment or a note explaining what to change.");
  const items = [];
  for (const th of await listThreads(wsId, { ticketId })) {
    if (th.status !== "open") continue;
    const convo = th.comments.map((c, i) => (i === 0 ? c.text : `  ↳ ${c.authorName}: ${c.text}`)).join("\n");
    items.push(`- \`${th.path}\` line ${th.line}${th.outdated ? " (line has changed since)" : ""} — \`${th.lineText.trim().slice(0, 120)}\`\n  ${convo.replace(/\n/g, "\n  ")}`);
  }
  const body = ["Requested changes in code review.", note?.trim() ?? "", items.length ? `Review comments to address:\n${items.join("\n")}` : "", "Fix each point, then hand the ticket back for review."]
    .filter(Boolean)
    .join("\n\n");
  await addEvent(ticketId, "user", "comment", body);
  await updateTicket(ticketId, { status: "todo", review }, "user");
  changed(wsId);
  if (!t.assigneeId) return { started: false, message: "Assign an agent to this ticket to start the follow-up." };
  const { startRun } = await import("./engine/orchestrator");
  try {
    const r = await startRun(ticketId);
    return { started: r.started, message: r.started ? undefined : "reason" in r ? r.reason : undefined };
  } catch (e) {
    return { started: false, message: (e as Error).message };
  }
}

// ---------------------------------------------------------------- AI review

const REVIEW_SYSTEM = `You are a meticulous senior software engineer doing a code review.
Point out real problems: bugs, broken logic, security issues (XSS, injection, secrets), accessibility, performance, and confusing code. Skip nitpicks about style unless they hurt readability. Be specific and suggest the fix.
Answer with JSON only, no prose: {"summary": "2-4 sentence overall assessment", "comments": [{"path": "file path", "line": <line number in the NEW file>, "severity": "error" | "warning" | "info", "text": "the comment, Markdown allowed"}]}.
Use at most 15 comments. Only comment on line numbers shown in the input. If everything looks good, return an empty comments list.`;

const MAX_INPUT = 60_000;

export async function aiReview(wsId: string, scope: { ticketId?: string; path?: string }) {
  const db = await read();
  let input = "";
  const valid = new Map<string, number>();
  let ticket: Ticket | undefined;
  if (scope.ticketId) {
    ticket = db.tickets.find((x) => x.id === scope.ticketId && x.workspaceId === wsId);
    if (!ticket) throw new Error("Ticket not found");
    input += `Ticket LUM-${ticket.number}: ${ticket.title}\n${ticket.description.slice(0, 2000)}\n\nChanges (new-file line numbers on the left, + added, - removed):\n`;
    const byPath = ticketCheckpoints(db.checkpoints.filter((c) => c.workspaceId === wsId), ticket.id);
    for (const [p, list] of byPath) {
      if (scope.path && p !== scope.path) continue;
      const before = list[0].beforeBlob ? await getBlob(wsId, list[0].beforeBlob).catch(() => "") : null;
      const after = await readFile(wsId, p, { skipPull: true });
      if (after === null || after.includes("\0")) continue;
      valid.set(p, after.split("\n").length);
      input += `\n=== ${p} ===\n`;
      for (const h of toHunks(diffLines(before, after), 4)) {
        if ("skipped" in h) {
          input += `   … ${h.skipped} unchanged lines …\n`;
          continue;
        }
        for (const l of h.lines) input += l.type === "del" ? `     - ${l.text}\n` : `${String(l.b).padStart(5)}${l.type === "add" ? "+" : " "} ${l.text}\n`;
      }
      if (input.length > MAX_INPUT) break;
    }
  } else if (scope.path) {
    const content = await readFile(wsId, scope.path);
    if (content === null) throw new Error(`File not found: ${scope.path}`);
    valid.set(scope.path, content.split("\n").length);
    input = `Review this file.\n\n=== ${scope.path} ===\n` + content.split("\n").map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join("\n");
  } else throw new Error("Pick a ticket or a file to review.");
  if (!valid.size) throw new Error("There's nothing to review here.");
  if (input.length > MAX_INPUT) input = input.slice(0, MAX_INPUT) + "\n…(truncated)";

  const reply = await complete(REVIEW_SYSTEM, input, 4000);
  let parsed: { summary?: string; comments?: { path?: string; line?: number; severity?: string; text?: string }[] };
  try {
    parsed = extractJson(reply) as typeof parsed;
  } catch {
    throw new Error("The reviewer's answer couldn't be read. Try again.");
  }
  // Replace the reviewer's previous open comments for the same scope.
  await mutate((db) => {
    db.reviewThreads = (db.reviewThreads ?? []).filter(
      (t) => !(t.workspaceId === wsId && t.status === "open" && t.comments.length === 1 && t.comments[0].author === "reviewer" && valid.has(t.path) && (t.ticketId ?? null) === (scope.ticketId ?? null)),
    );
  });
  const created: ReviewThread[] = [];
  const contents = new Map<string, string[]>();
  for (const c of (parsed.comments ?? []).slice(0, 15)) {
    const max = c.path ? valid.get(c.path) : undefined;
    if (!c.path || !max || !c.text?.trim()) continue;
    const line = Math.min(Math.max(1, Math.round(Number(c.line) || 1)), max);
    if (!contents.has(c.path)) contents.set(c.path, ((await readFile(wsId, c.path, { skipPull: true })) ?? "").split("\n"));
    const severity = (["error", "warning", "info"].includes(c.severity ?? "") ? c.severity : "info") as ReviewThread["severity"];
    created.push({
      id: newId("rt"),
      workspaceId: wsId,
      path: c.path,
      line,
      lineText: contents.get(c.path)![line - 1] ?? "",
      ticketId: scope.ticketId ?? null,
      status: "open",
      severity,
      comments: [{ id: newId("rc"), author: "reviewer", authorName: "Luma reviewer", text: c.text.trim(), createdAt: now() }],
      createdAt: now(),
      updatedAt: now(),
    });
  }
  if (created.length) await mutate((db) => void (db.reviewThreads ??= []).push(...created));
  const summary = parsed.summary?.trim() || (created.length ? "" : "No problems found.");
  if (ticket && summary) await addEvent(ticket.id, "user", "comment", `AI review: ${summary}${created.length ? ` (${created.length} line comment${created.length === 1 ? "" : "s"})` : ""}`);
  changed(wsId);
  return { summary, comments: created.length };
}
