import { handle, ok, fail } from "@/lib/http";
import { mutate, newId, now, read } from "@/lib/store";
import { AGENT_PRESETS } from "@/lib/presets";
import { sanitizeAgentFields } from "@/lib/agentFields";
import type { LibraryAgent } from "@/lib/types";

export const runtime = "nodejs";

/** The agent library: the 9 predefined agents plus agents you saved. */
export const GET = handle(async () => {
  const db = await read();
  return ok({ presets: AGENT_PRESETS, custom: db.library });
});

/** Save an agent to the library, from scratch or from a workspace agent ({ fromAgentId }). */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as Partial<LibraryAgent> & { fromAgentId?: string };
  const db = await read();
  const src = body.fromAgentId ? db.agents.find((a) => a.id === body.fromAgentId) : body;
  if (!src) return fail("Agent not found", 404);
  const fields = sanitizeAgentFields(src);
  const item: LibraryAgent = { id: newId("lib"), ...fields, createdAt: now(), updatedAt: now() };
  await mutate((d) => {
    d.library.push(item);
  });
  return ok({ agent: item }, 201);
});
