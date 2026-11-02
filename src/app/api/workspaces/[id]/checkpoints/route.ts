import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { revertCheckpoint } from "@/lib/files";
import { publish } from "@/lib/bus";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Version history: newest first, optionally for one file. */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path");
  const db = await read();
  const checkpoints = db.checkpoints
    .filter((c) => c.workspaceId === id && (!path || c.path === path))
    .slice(-200)
    .reverse();
  return ok({ checkpoints });
});

/**
 * Undo:
 * - { checkpointId }            roll one file back to how it was before that change
 * - { ticketId, path? }         roll back everything a ticket changed (optionally one file)
 */
export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as { checkpointId?: string; ticketId?: string; path?: string };
  if (body.checkpointId) {
    const path = await revertCheckpoint(id, body.checkpointId);
    publish(id, { kind: "files_changed", workspaceId: id, paths: [path] });
    return ok({ restored: [path] });
  }
  if (!body.ticketId) return fail("Pass checkpointId or ticketId");
  const db = await read();
  const firstPerPath = new Map<string, string>();
  for (const c of db.checkpoints)
    if (c.workspaceId === id && c.ticketId === body.ticketId && (!body.path || c.path === body.path) && !firstPerPath.has(c.path))
      firstPerPath.set(c.path, c.id);
  const restored: string[] = [];
  for (const cpId of firstPerPath.values()) restored.push(await revertCheckpoint(id, cpId));
  if (restored.length) publish(id, { kind: "files_changed", workspaceId: id, paths: restored });
  return ok({ restored });
});
