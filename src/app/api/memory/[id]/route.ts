import { handle, ok, type Ctx } from "@/lib/http";
import { deleteMemory, reviewMemory, updateMemory } from "@/lib/memory";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = await req.json();
  if (body.action === "approve" || body.action === "reject") return ok(await reviewMemory(id, body.action === "approve"));
  return ok({ memory: await updateMemory(id, body) });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  await deleteMemory(id);
  return ok({ deleted: true });
});
