import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { deleteWorkspace, updateWorkspace } from "@/lib/repo";
import { runningTicketIds } from "@/lib/engine/orchestrator";
import { kick } from "@/lib/engine/scheduler";
import { currentUser, workspaceRole } from "@/lib/auth";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Everything the workspace screens need in one request. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  const workspace = db.workspaces.find((w) => w.id === id);
  if (!workspace) return fail("Workspace not found", 404);
  void kick(id); // cheap; also recovers queued work after a restart
  const running = new Set(runningTicketIds());
  return ok({
    myRole: workspaceRole(db, currentUser(), id),
    workspace,
    agents: db.agents.filter((a) => a.workspaceId === id),
    tickets: db.tickets.filter((t) => t.workspaceId === id).map((t) => ({ ...t, running: running.has(t.id) })),
  });
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const workspace = await updateWorkspace(id, await req.json());
  void kick(id);
  return ok({ workspace });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await deleteWorkspace(id);
  return ok({ deleted: true });
});
