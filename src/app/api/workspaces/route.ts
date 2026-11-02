import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { createWorkspace } from "@/lib/repo";
import { canSee, currentUser, workspaceRole } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const db = await read();
  const me = currentUser();
  const workspaces = db.workspaces.filter((w) => canSee(db, me, w.id)).map((w) => {
    const tickets = db.tickets.filter((t) => t.workspaceId === w.id);
    return {
      ...w,
      ticketCounts: {
        open: tickets.filter((t) => !["done"].includes(t.status)).length,
        done: tickets.filter((t) => t.status === "done").length,
        waiting: tickets.filter((t) => t.status === "waiting_for_user" || t.status === "in_review").length,
      },
      myRole: workspaceRole(db, me, w.id),
      pendingMemories: db.memories.filter((m) => m.workspaceId === w.id && (m.status === "proposed" || m.proposal)).length,
    };
  });
  return ok({ workspaces });
});

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const ws = await createWorkspace(body);
  return ok({ workspace: ws }, 201);
});
