import { handle, ok, fail, type Ctx } from "@/lib/http";
import { deleteFile, readFile, renameFile, writeFile } from "@/lib/files";
import { publish } from "@/lib/bus";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

const pathOf = (req: Request) => new URL(req.url).searchParams.get("path") ?? "";

export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const content = await readFile(id, pathOf(req));
  if (content === null) return fail("File not found", 404);
  return ok({ path: pathOf(req), content });
});

/** Save (create or overwrite) a file as the user. */
export const PUT = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { path, content } = (await req.json()) as { path: string; content: string };
  const res = await writeFile(id, path, content ?? "", { actor: "user" });
  publish(id, { kind: "files_changed", workspaceId: id, paths: [res.rel] });
  return ok(res);
});

/** Rename / move. */
export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { from, to } = (await req.json()) as { from: string; to: string };
  await renameFile(id, from, to, { actor: "user" });
  publish(id, { kind: "files_changed", workspaceId: id, paths: [from, to] });
  return ok({ renamed: true });
});

export const DELETE = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const removed = await deleteFile(id, pathOf(req), { actor: "user" });
  if (!removed) return fail("File not found", 404);
  publish(id, { kind: "files_changed", workspaceId: id, paths: [pathOf(req)] });
  return ok({ deleted: true });
});
