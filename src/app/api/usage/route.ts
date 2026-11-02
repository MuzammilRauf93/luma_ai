import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";

export const runtime = "nodejs";

type Bucket = { tokens: number; cost: number };
const add = (m: Record<string, Bucket>, k: string, tokens: number, cost: number) => {
  m[k] ??= { tokens: 0, cost: 0 };
  m[k].tokens += tokens;
  m[k].cost += cost;
};

export const GET = handle(async (req: Request) => {
  const wsFilter = new URL(req.url).searchParams.get("workspaceId");
  const db = await read();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const byWorkspace: Record<string, Bucket> = {};
  const byAgent: Record<string, Bucket> = {};
  const byTicket: Record<string, Bucket> = {};
  const total: Bucket = { tokens: 0, cost: 0 };
  const month: Bucket = { tokens: 0, cost: 0 };
  for (const u of db.usage) {
    if (wsFilter && u.workspaceId !== wsFilter) continue;
    const t = u.inputTokens + u.outputTokens;
    add(byWorkspace, u.workspaceId, t, u.costUsd);
    add(byAgent, u.agentId, t, u.costUsd);
    add(byTicket, u.ticketId, t, u.costUsd);
    total.tokens += t;
    total.cost += u.costUsd;
    if (new Date(u.createdAt) >= monthStart) {
      month.tokens += t;
      month.cost += u.costUsd;
    }
  }
  return ok({ total, month, byWorkspace, byAgent, byTicket, monthlyLimitUsd: db.settings.monthlyLimitUsd ?? null });
});
