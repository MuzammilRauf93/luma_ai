import { handle, ok, type Ctx } from "@/lib/http";
import { cancelCommand } from "@/lib/commands";

export const runtime = "nodejs";

/** Stop a running command. */
export const DELETE = handle(async (_req: Request, { params }: Ctx<{ runId: string }>) => {
  const { runId } = await params;
  return ok({ stopped: cancelCommand(runId) });
});
