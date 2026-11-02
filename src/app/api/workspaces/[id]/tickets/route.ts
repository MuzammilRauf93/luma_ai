import { handle, ok, type Ctx } from "@/lib/http";
import { createTicket } from "@/lib/repo";
import { kick } from "@/lib/engine/scheduler";

export const runtime = "nodejs";

export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const body = await req.json();
  const ticket = await createTicket({
    workspaceId: id,
    title: body.title ?? "",
    description: body.description,
    priority: body.priority,
    labels: body.labels,
    assigneeId: body.assigneeId,
    status: body.status,
    dependsOn: Array.isArray(body.dependsOn) ? body.dependsOn : undefined,
    queued: Boolean(body.queued && body.assigneeId),
    createdBy: "user",
  });
  if (ticket.queued) void kick(id);
  return ok({ ticket }, 201);
});
