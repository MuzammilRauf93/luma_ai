import { handle, ok, fail, type Ctx } from "@/lib/http";
import { resolveHandoff } from "@/lib/engine/orchestrator";

export const runtime = "nodejs";

/** Approve or decline a handoff waiting for the user (manual approval mode). */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: "approve" | "decline" };
  if (action !== "approve" && action !== "decline") return fail("action must be approve or decline");
  return ok(await resolveHandoff(id, action === "approve"));
});
