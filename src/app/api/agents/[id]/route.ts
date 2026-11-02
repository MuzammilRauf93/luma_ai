import { handle, ok, type Ctx } from "@/lib/http";
import { mutate } from "@/lib/store";
import { updateAgent } from "@/lib/repo";
import { runningTicketIds } from "@/lib/engine/orchestrator";
import { kick } from "@/lib/engine/scheduler";
import { read } from "@/lib/store";
import { fail } from "@/lib/http";
import { sanitizeAgentFields } from "@/lib/agentFields";
import type { Agent } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<Agent>;
  // Only sanitise identity fields when they're being edited; a plain pause/resume passes through.
  const patch: Partial<Agent> =
    body.name !== undefined || body.systemPrompt !== undefined || body.permissions !== undefined
      ? { ...sanitizeAgentFields(body), paused: body.paused }
      : { paused: body.paused, model: body.model };
  const agent = await updateAgent(id, patch);
  if (body.paused === false) void kick(agent.workspaceId); // resumed agents pick up queued work
  return ok({ agent });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const db0 = await read();
  const running = new Set(runningTicketIds());
  if (db0.tickets.some((t) => t.assigneeId === id && running.has(t.id))) return fail("Stop this agent's running ticket before removing them.");
  await mutate((db) => {
    db.agents = db.agents.filter((a) => a.id !== id);
    for (const t of db.tickets)
      if (t.assigneeId === id) {
        t.assigneeId = null;
        t.queued = undefined;
      }
  });
  return ok({ deleted: true });
});
