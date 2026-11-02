import { handle, ok, type Ctx } from "@/lib/http";
import { cancelRun, startRun } from "@/lib/engine/orchestrator";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Start the assigned agent on this ticket (runs in the background, or queues if all slots are busy). */
export const POST = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const res = await startRun(id);
  return ok(res, 202);
});

/** Stop a running agent. */
export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  return ok({ stopped: await cancelRun(id) });
});
