import "server-only";
import { mutate, newId, now, read } from "./store";
import { publish } from "./bus";
import { currentUser } from "./auth";
import type { DB, Notification, NotificationKind, Ticket, WorkspaceRole } from "./types";

/**
 * Notifications (Phase 6): a per-person inbox for things that need attention.
 * In single-user mode everything goes to "local". With accounts, workspace owners and
 * editors are notified (viewers only for @mentions), never the person who caused it.
 * Repeats of the same thing on the same ticket within 30 minutes update one notification.
 */

export const LOCAL = "local";
const MAX_PER_USER = 300;
const IMPORTANT: NotificationKind[] = ["waiting", "approval", "failed", "mention", "invite"];
export const isImportant = (k: NotificationKind) => IMPORTANT.includes(k);

export const meKey = () => currentUser()?.id ?? LOCAL;

/** People to tell about something in a workspace. */
export function recipients(db: DB, workspaceId: string, opts: { minRole?: WorkspaceRole; exclude?: string | null } = {}) {
  if (!db.users.length) return [LOCAL];
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  const rank = { viewer: 1, editor: 2, owner: 3 } as const;
  const min = rank[opts.minRole ?? "editor"];
  return (ws?.members ?? [])
    .filter((m) => rank[m.role] >= min && db.users.some((u) => u.id === m.userId))
    .map((m) => m.userId)
    .filter((id) => id !== opts.exclude);
}

export async function notify(input: {
  workspaceId: string;
  ticketId?: string | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  to?: string[];
}) {
  const db = await read();
  const to = [...new Set(input.to ?? recipients(db, input.workspaceId, { exclude: currentUser()?.id }))];
  if (!to.length) return [];
  const link = input.link ?? (input.ticketId ? `/w/${input.workspaceId}/board?ticket=${input.ticketId}` : `/w/${input.workspaceId}`);
  const cutoff = Date.now() - 30 * 60_000;
  const created = await mutate((d) => {
    const out: Notification[] = [];
    for (const userId of to) {
      const same = d.notifications.find(
        (n) => n.userId === userId && !n.readAt && n.kind === input.kind && n.workspaceId === input.workspaceId && (n.ticketId ?? null) === (input.ticketId ?? null) && new Date(n.createdAt).getTime() > cutoff,
      );
      if (same) {
        Object.assign(same, { title: input.title, body: input.body ?? "", link, createdAt: now(), emailedAt: null });
        out.push({ ...same });
        continue;
      }
      const n: Notification = { id: newId("ntf"), userId, workspaceId: input.workspaceId, ticketId: input.ticketId ?? null, kind: input.kind, title: input.title, body: (input.body ?? "").slice(0, 500), link, readAt: null, createdAt: now() };
      d.notifications.push(n);
      out.push(n);
      const mine = d.notifications.filter((x) => x.userId === userId);
      if (mine.length > MAX_PER_USER) {
        const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((x) => x.id));
        d.notifications = d.notifications.filter((x) => !drop.has(x.id));
      }
    }
    return out;
  });
  publish(input.workspaceId, { kind: "notification", userIds: to });
  // Email (instant) — loaded lazily so notifications work without the mail module.
  void import("./mail").then((m) => m.sendInstant(created)).catch(() => undefined);
  return created;
}

const firstLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 240);

/** Called after a ticket's status changes. */
export async function onTicketStatus(t: Ticket, to: Ticket["status"], actor: string) {
  if (!["waiting_for_user", "in_review", "failed"].includes(to)) return;
  const db = await read();
  const events = db.events.filter((e) => e.ticketId === t.id);
  const agent = db.agents.find((a) => a.id === t.assigneeId);
  const last = (types: string[]) => [...events].reverse().find((e) => types.includes(e.type))?.content ?? "";
  const exclude = actor === "user" ? currentUser()?.id : null;
  const to_ = recipients(db, t.workspaceId, { exclude });
  if (to === "waiting_for_user") {
    const handoff = !!t.pendingHandoff;
    await notify({
      workspaceId: t.workspaceId,
      ticketId: t.id,
      kind: handoff ? "approval" : "waiting",
      title: handoff ? `LUM-${t.number}: approve a handoff` : `LUM-${t.number}: ${agent?.name ?? "An agent"} needs your answer`,
      body: firstLine(handoff ? t.pendingHandoff!.note : last(["question"])) || t.title,
      to: to_,
    });
  } else if (to === "in_review") {
    await notify({ workspaceId: t.workspaceId, ticketId: t.id, kind: "review", title: `LUM-${t.number} is ready for review`, body: `${t.title}${agent ? ` · ${agent.name}` : ""}: ${firstLine(last(["summary"]))}`, to: to_ });
  } else if (to === "failed") {
    await notify({ workspaceId: t.workspaceId, ticketId: t.id, kind: "failed", title: `LUM-${t.number} failed`, body: firstLine(last(["error"])) || t.title, to: to_ });
  }
}

/** @mentions in a comment: "@Ana" or "@Ana Khan" (members' names, case-insensitive). */
export async function onComment(ticketId: string, actor: string, content: string) {
  if (!content.includes("@")) return;
  const db = await read();
  if (!db.users.length) return;
  const t = db.tickets.find((x) => x.id === ticketId);
  const ws = db.workspaces.find((w) => w.id === t?.workspaceId);
  if (!t || !ws) return;
  const text = content.toLowerCase();
  const me = currentUser()?.id;
  const people = (ws.members ?? []).map((m) => db.users.find((u) => u.id === m.userId)).filter((u): u is NonNullable<typeof u> => Boolean(u));
  const hit = people.filter((u) => u.id !== me && [u.name, u.name.split(/\s+/)[0], u.email.split("@")[0]].some((n) => n && text.includes(`@${n.toLowerCase()}`)));
  if (!hit.length) return;
  const who = actor === "user" ? currentUser()?.name ?? "Someone" : db.agents.find((a) => a.id === actor)?.name ?? "Luma";
  await notify({ workspaceId: ws.id, ticketId, kind: "mention", title: `${who} mentioned you on LUM-${t.number}`, body: firstLine(content), to: hit.map((u) => u.id) });
}

export async function markRead(userId: string, ids: string[] | "all") {
  await mutate((d) => {
    const t = now();
    for (const n of d.notifications) if (n.userId === userId && !n.readAt && (ids === "all" || ids.includes(n.id))) n.readAt = t;
  });
}
