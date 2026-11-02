import { z } from "zod";
import { handle, ok, fail } from "@/lib/http";
import { complete, extractJson } from "@/lib/oneshot";
import { sanitizeAgentFields } from "@/lib/agentFields";
import { PERMISSIONS } from "@/lib/types";

export const runtime = "nodejs";

const SYSTEM = `You design AI agents for Luma AI, a workspace where a team of AI agents (project manager, designer, developers, QA, …) work through tickets on a software project.
Given a short description from a non-technical user, reply with ONLY a JSON object, no prose:
{
  "name": "a friendly first name",
  "role": "job title, 1-4 words",
  "avatar": "one emoji",
  "color": "#rrggbb",
  "description": "one sentence: what they're responsible for",
  "tone": "3-6 words",
  "permissions": [subset of ${JSON.stringify(PERMISSIONS.map((p) => p.id))}],
  "systemPrompt": "role instructions in second person (You are the … of this workspace.), 5-10 lines with concrete '- ' rules about how to do the job well, what files to produce, and what NOT to do"
}
Grant the fewest permissions the role needs. Only give web_research to roles that must look things up online. Do not include tool names or generic team rules; Luma adds those automatically.`;

const Body = z.object({ description: z.string().min(3).max(2000) });

/** "Draft with Claude" in the agent builder. */
export const POST = handle(async (req: Request) => {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return fail("Describe the agent you want in a sentence or two.");
  const text = await complete(SYSTEM, `Design an agent for this: ${parsed.data.description}`);
  return ok({ draft: sanitizeAgentFields(extractJson(text) as Record<string, never>) });
});
