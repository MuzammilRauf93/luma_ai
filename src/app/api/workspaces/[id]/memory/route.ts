import { handle, ok, fail, type Ctx } from "@/lib/http";
import { findDuplicates, listMemories, searchMemories, upsertMemory } from "@/lib/memory";
import type { Memory } from "@/lib/types";

export const runtime = "nodejs";

/** Embeddings stay on the server. */
const strip = ({ embedding: _e, ...m }: Memory) => (void _e, m);
type P = Ctx<{ id: string }>;

/** Team memory for a workspace. `?q=` searches it the same way agents' `recall` does. */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get("duplicates")) {
    const pairs = await findDuplicates(id);
    return ok({ pairs: pairs.map((p) => ({ a: strip(p.a), b: strip(p.b), similarity: p.similarity })) });
  }
  const q = url.searchParams.get("q");
  return ok({ memories: (q ? await searchMemories(id, q, 50) : await listMemories(id)).map(strip) });
});

/** Add a memory as the user (same title updates the existing one). */
export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<Memory>;
  if (!body.title?.trim() || !body.content?.trim()) return fail("Give the memory a title and some details.");
  const { memory } = await upsertMemory({
    workspaceId: id,
    kind: body.kind,
    title: body.title,
    content: body.content,
    tags: body.tags,
    pinned: body.pinned,
    ticketId: body.ticketId ?? null,
    authorId: "user",
  });
  return ok({ memory }, 201);
});
