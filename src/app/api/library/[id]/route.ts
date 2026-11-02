import { handle, ok, type Ctx } from "@/lib/http";
import { mutate, now } from "@/lib/store";
import { sanitizeAgentFields } from "@/lib/agentFields";
import type { LibraryAgent } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<LibraryAgent>;
  const agent = await mutate((db) => {
    const a = db.library.find((x) => x.id === id);
    if (!a) throw new Error("Library agent not found");
    Object.assign(a, sanitizeAgentFields({ ...a, ...body }), { updatedAt: now() });
    return a;
  });
  return ok({ agent });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await mutate((db) => {
    db.library = db.library.filter((a) => a.id !== id);
  });
  return ok({ deleted: true });
});
