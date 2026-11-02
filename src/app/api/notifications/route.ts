import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { canSee, currentUser } from "@/lib/auth";
import { markRead, meKey } from "@/lib/notifications";

export const runtime = "nodejs";

/** My notifications, newest first (only for workspaces I can still open). */
export const GET = handle(async (req: Request) => {
  const db = await read();
  const me = meKey();
  const onlyUnread = new URL(req.url).searchParams.get("unread") === "1";
  const mine = db.notifications.filter((n) => n.userId === me && canSee(db, currentUser(), n.workspaceId));
  const items = mine
    .filter((n) => !onlyUnread || !n.readAt)
    .slice(-60)
    .reverse()
    .map((n) => {
      const ws = db.workspaces.find((w) => w.id === n.workspaceId);
      return { ...n, workspace: ws ? { name: ws.name, icon: ws.icon } : null };
    });
  return ok({ items, unread: mine.filter((n) => !n.readAt).length });
});

/** Mark some (ids) or all as read. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { ids?: string[]; all?: boolean };
  await markRead(meKey(), body.all ? "all" : (body.ids ?? []));
  return ok({ ok: true });
});
