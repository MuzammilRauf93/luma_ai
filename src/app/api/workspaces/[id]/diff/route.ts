import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { getBlob } from "@/lib/files";
import { diffLines, diffStats } from "@/lib/diff";
import type { Checkpoint } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

const MAX_TEXT = 400_000;

async function blob(wsId: string, id: string | null) {
  if (id === null) return null;
  const s = await getBlob(wsId, id).catch(() => "");
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + "\n…(truncated)" : s;
}

/**
 * Change viewer data.
 * - ?checkpointId=…            before/after of one change
 * - ?ticketId=…&path=…         combined before/after of everything a ticket changed in one file
 * - ?ticketId=…                per-file summary of a ticket's changes (+/− line counts)
 */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const url = new URL(req.url);
  const cpId = url.searchParams.get("checkpointId");
  const ticketId = url.searchParams.get("ticketId");
  const path = url.searchParams.get("path");
  const db = await read();
  const cps = db.checkpoints.filter((c) => c.workspaceId === id);

  if (cpId) {
    const cp = cps.find((c) => c.id === cpId);
    if (!cp) return fail("Change not found", 404);
    return ok({ path: cp.path, before: await blob(id, cp.beforeBlob), after: await blob(id, cp.afterBlob), checkpoints: [cp] });
  }
  if (!ticketId) return fail("Pass checkpointId or ticketId");

  const mine = cps.filter((c) => c.ticketId === ticketId);
  const byPath = new Map<string, Checkpoint[]>();
  for (const c of mine) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);

  if (path) {
    const list = byPath.get(path);
    if (!list) return fail("This ticket didn't change that file", 404);
    return ok({ path, before: await blob(id, list[0].beforeBlob), after: await blob(id, list[list.length - 1].afterBlob), checkpoints: list });
  }

  const files = [];
  for (const [p, list] of byPath) {
    const first = list[0];
    const last = list[list.length - 1];
    const { adds, dels } = diffStats(diffLines(await blob(id, first.beforeBlob), await blob(id, last.afterBlob)));
    // Was the file changed by someone else after this ticket's last change?
    const later = cps.slice(cps.indexOf(last) + 1).find((c) => c.path === p && c.ticketId !== ticketId);
    files.push({
      path: p,
      adds,
      dels,
      created: first.beforeBlob === null,
      deleted: last.afterBlob === null,
      changes: list.length,
      actors: [...new Set(list.map((c) => c.actor))],
      changedLater: Boolean(later),
      lastAt: last.createdAt,
    });
  }
  return ok({ files });
});
