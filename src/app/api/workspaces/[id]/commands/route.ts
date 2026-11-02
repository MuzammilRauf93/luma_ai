import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { detectSandbox, RULES, runCommand } from "@/lib/commands";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Recent command runs + what's allowed here. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  const sandbox = await detectSandbox();
  return ok({
    runs: db.commandRuns.filter((r) => r.workspaceId === id).slice(-100),
    sandbox: sandbox.kind,
    enabled: ws.commandsEnabled !== false,
    allowed: [...new Set(RULES.filter((r) => !r.needsSandbox || sandbox.kind !== "none").map((r) => r.cmd))],
    extra: ws.extraCommands ?? [],
  });
});

/** Run a command as the user (same rules as agents). Output streams over SSE. */
export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { command } = (await req.json()) as { command?: string };
  if (!command?.trim()) return fail("Type a command first.");
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  void runCommand({ workspace: ws, command, actor: "user", ticketId: null }).catch(() => undefined);
  return ok({ started: true }, 202);
});
