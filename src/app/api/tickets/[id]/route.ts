import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { deleteTicket, getTicketBundle, updateTicket } from "@/lib/repo";
import { isRunning } from "@/lib/engine/orchestrator";
import { blockersOf, kick } from "@/lib/engine/scheduler";
import type { Ticket } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const bundle = await getTicketBundle(id);
  if (!bundle) return fail("Ticket not found", 404);
  const db = await read();
  const blockers = blockersOf(bundle.ticket, db).map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status }));
  const dependsOn = (bundle.ticket.dependsOn ?? [])
    .map((d) => db.tickets.find((t) => t.id === d))
    .filter((t): t is Ticket => Boolean(t))
    .map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status }));
  return ok({ ...bundle, running: isRunning(id), blockers, dependsOn });
});

/** Fields the user may change directly. Handoff history etc. are system-managed. */
const EDITABLE: (keyof Ticket)[] = ["title", "description", "status", "priority", "labels", "assigneeId", "queued", "dependsOn"];

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<Ticket>;
  const patch: Partial<Ticket> = {};
  for (const k of EDITABLE) if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
  // Moving a ticket by hand to anything but To Do / Backlog takes it out of the autopilot queue.
  if (patch.status && !["todo", "backlog"].includes(patch.status) && patch.queued === undefined) patch.queued = false;
  if (patch.queued && isRunning(id)) delete patch.queued;
  const ticket = await updateTicket(id, patch, "user");
  void kick(ticket.workspaceId);
  return ok({ ticket });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  if (isRunning(id)) return fail("Stop the agent before deleting this ticket.");
  await deleteTicket(id);
  return ok({ deleted: true });
});
