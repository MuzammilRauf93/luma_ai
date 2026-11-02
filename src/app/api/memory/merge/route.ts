import { handle, ok, fail } from "@/lib/http";
import { mergeMemories } from "@/lib/memory";
import { requireWorkspaceRole } from "@/lib/auth";
import { read } from "@/lib/store";

export const runtime = "nodejs";

/** Merge two memories that say the same thing. */
export const POST = handle(async (req: Request) => {
  const { keepId, dropId } = (await req.json()) as { keepId?: string; dropId?: string };
  if (!keepId || !dropId || keepId === dropId) return fail("Pick two different memories.");
  const ws = (await read()).memories.find((m) => m.id === keepId)?.workspaceId;
  if (!ws) return fail("Memory not found", 404);
  await requireWorkspaceRole(ws, "editor");
  const { embedding: _e, ...memory } = await mergeMemories(keepId, dropId);
  void _e;
  return ok({ memory });
});
