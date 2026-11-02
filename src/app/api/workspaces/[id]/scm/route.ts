import { handle, ok, fail, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { currentUser } from "@/lib/auth";
import { scmCommit, scmShow, scmStage, scmStatus } from "@/lib/git";
import { deleteFile, writeFile } from "@/lib/files";
import { publish } from "@/lib/bus";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

async function ws(id: string) {
  const w = (await read()).workspaces.find((x) => x.id === id);
  if (!w) throw new Error("Workspace not found");
  return w;
}

/** Source Control: status, or ?path=…&ref=HEAD|INDEX for the original side of a diff. */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (path) return ok({ content: await scmShow(await ws(id), path, url.searchParams.get("ref") === "INDEX" ? "INDEX" : "HEAD") });
  return ok(await scmStatus(await ws(id)));
});

type Body =
  | { action: "stage" | "unstage" | "discard"; paths: string[] }
  | { action: "commit"; message: string; all?: boolean };

export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as Body;
  const w = await ws(id);
  switch (body.action) {
    case "stage":
    case "unstage":
      await scmStage(w, body.paths ?? [], body.action === "stage");
      return ok({ done: true });
    case "discard": {
      // Back to the last commit. Goes through Luma's file layer so it's recorded in History.
      const paths = body.paths ?? [];
      await scmStage(w, paths, false).catch(() => undefined);
      for (const p of paths) {
        const head = await scmShow(w, p, "HEAD");
        if (head === null) await deleteFile(id, p, { actor: "user" });
        else await writeFile(id, p, head, { actor: "user" });
      }
      publish(id, { kind: "files_changed", workspaceId: id, paths });
      publish(id, { kind: "git", workspaceId: id });
      return ok({ discarded: paths });
    }
    case "commit": {
      const u = currentUser();
      const sha = await scmCommit(w, body.message ?? "", { all: body.all, author: u ? { name: u.name, email: u.email } : undefined });
      return ok({ sha });
    }
    default:
      return fail("Unknown action");
  }
});
