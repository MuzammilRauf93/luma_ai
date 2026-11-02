import { handle, ok, fail, type Ctx } from "@/lib/http";
import { mutate, newId, now, read } from "@/lib/store";
import { agentFromTemplate } from "@/lib/repo";
import { getPreset } from "@/lib/presets";
import { sanitizeAgentFields } from "@/lib/agentFields";
import type { Agent } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Add an agent to this workspace:
 * - { presetKey }  one of the 9 predefined agents
 * - { libraryId }  an agent saved in your library
 * - { ...fields, saveToLibrary? }  a custom agent from the builder
 */
export const POST = handle(async (req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const body = (await req.json()) as Partial<Agent> & { presetKey?: string; libraryId?: string; saveToLibrary?: boolean };
  const db = await read();
  if (!db.workspaces.some((w) => w.id === id)) return fail("Workspace not found", 404);

  let agent: Agent;
  if (body.presetKey) {
    const preset = getPreset(body.presetKey);
    if (!preset) return fail("Unknown agent preset");
    if (db.agents.some((a) => a.workspaceId === id && a.presetKey === preset.key))
      return fail(`${preset.name} is already on this team.`);
    agent = agentFromTemplate(id, preset);
  } else if (body.libraryId) {
    const lib = db.library.find((l) => l.id === body.libraryId);
    if (!lib) return fail("Library agent not found", 404);
    agent = agentFromTemplate(id, lib);
  } else {
    agent = agentFromTemplate(id, sanitizeAgentFields(body));
  }

  await mutate((d) => {
    d.agents.push(agent);
    if (body.saveToLibrary && !body.presetKey && !body.libraryId) {
      const f = sanitizeAgentFields(agent);
      d.library.push({ id: newId("lib"), ...f, createdAt: now(), updatedAt: now() });
    }
  });
  return ok({ agent }, 201);
});
