import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { commitAll, connectRemote, enableGit, gitStatus, openPullRequest, pull, push, updateGitSettings } from "@/lib/git";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

async function ws(id: string) {
  const db = await read();
  const w = db.workspaces.find((x) => x.id === id);
  if (!w) throw new Error("Workspace not found");
  return w;
}

export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  return ok(await gitStatus(await ws(id)));
});

type Body =
  | { action: "enable"; branch?: string; baseBranch?: string }
  | { action: "settings"; autoCommit?: boolean; autoPush?: boolean; branch?: string; enabled?: boolean }
  | { action: "connect"; repo?: string; create?: { name: string; private: boolean } }
  | { action: "commit"; message?: string }
  | { action: "push" }
  | { action: "pull" }
  | { action: "pr" };

export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Body;
  const w = await ws(id);
  switch (body.action) {
    case "enable":
      return ok({ git: await enableGit(w, body) });
    case "settings":
      return ok({ git: await updateGitSettings(w, body) });
    case "connect":
      return ok(await connectRemote(w, body));
    case "commit": {
      const sha = await commitAll(w, body.message?.trim() || "Edits from the Luma editor");
      return ok({ sha, message: sha ? `Committed ${sha}.` : "Nothing to commit." });
    }
    case "push":
      return ok(await push(w));
    case "pull":
      return ok(await pull(w));
    case "pr":
      return ok(await openPullRequest(w));
    default:
      return fail("Unknown action");
  }
});
