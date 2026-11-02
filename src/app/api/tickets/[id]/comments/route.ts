import { handle, ok, fail, type Ctx } from "@/lib/http";
import { addEvent } from "@/lib/repo";

export const runtime = "nodejs";

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return fail("Write something first.");
  return ok({ event: await addEvent(id, "user", "comment", text.trim()) }, 201);
});
