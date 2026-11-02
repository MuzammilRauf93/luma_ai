import { handle, ok, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { workspaceMetrics } from "@/lib/metrics";

export const runtime = "nodejs";

/** Insights for the last N days (7–180, default 30). */
export const GET = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const days = Math.min(180, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
  return ok(workspaceMetrics(await read(), id, days));
});
