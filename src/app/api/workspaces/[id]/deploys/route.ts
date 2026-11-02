import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { PROVIDERS, startDeploy } from "@/lib/deploy";
import type { DeployProvider } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  return ok({
    deploys: db.deploys.filter((d) => d.workspaceId === id).slice(-30).reverse(),
    target: ws.deploy ?? null,
    providers: PROVIDERS.map((p) => ({
      ...p,
      ready:
        p.id === "netlify" ? Boolean(db.settings.deployTokens?.netlify)
        : p.id === "vercel" ? Boolean(db.settings.deployTokens?.vercel)
        : p.id === "github_pages" ? Boolean(ws.git?.githubRepo)
        : true,
    })),
  });
});

export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { provider } = (await req.json()) as { provider: DeployProvider };
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  return ok({ deploy: await startDeploy(ws, provider) }, 202);
});
