import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { createTicket } from "@/lib/repo";
import { startRun } from "@/lib/engine/orchestrator";

export const runtime = "nodejs";

/**
 * "Describe your goal" (plan §6 step 4): creates a planning ticket for the
 * Project Manager and starts it, so the PM splits it into tickets.
 */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const { goal } = (await req.json()) as { goal: string };
  if (!goal?.trim()) return fail("Describe what you'd like to build.");
  const db = await read();
  const pm = db.agents.find((a) => a.workspaceId === id && a.presetKey === "project_manager" && !a.paused)
    ?? db.agents.find((a) => a.workspaceId === id && /project manager/i.test(a.role) && !a.paused);
  const firstLine = goal.trim().split("\n")[0];
  const ticket = await createTicket({
    workspaceId: id,
    title: `Plan: ${firstLine.length > 70 ? firstLine.slice(0, 67) + "…" : firstLine}`,
    description: goal.trim(),
    priority: "high",
    labels: ["feature"],
    assigneeId: pm?.id ?? null,
    createdBy: "user",
  });
  let started = false;
  let error: string | null = null;
  if (pm) {
    try {
      started = (await startRun(ticket.id)).started;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  return ok({ ticket, started, error }, 201);
});
