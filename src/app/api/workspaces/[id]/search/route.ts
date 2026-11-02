import { handle, ok, type Ctx } from "@/lib/http";
import { replaceInWorkspace, searchWorkspace, type SearchOpts } from "@/lib/search";
import { publish } from "@/lib/bus";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

const flag = (v: string | null) => v === "1" || v === "true";

/** Find in files: ?q=…&regex=1&case=1&word=1&include=…&exclude=… */
export const GET = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  return ok(
    await searchWorkspace(id, {
      query: u.get("q") ?? "",
      regex: flag(u.get("regex")),
      caseSensitive: flag(u.get("case")),
      wholeWord: flag(u.get("word")),
      include: u.get("include") ?? undefined,
      exclude: u.get("exclude") ?? undefined,
    }),
  );
});

/** Replace in files: { query, replace, regex?, caseSensitive?, wholeWord?, include?, exclude?, paths? } */
export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as SearchOpts & { replace: string; paths?: string[] };
  const changed = await replaceInWorkspace(id, { ...body, replace: body.replace ?? "" });
  if (changed.length) publish(id, { kind: "files_changed", workspaceId: id, paths: changed.map((c) => c.path) });
  return ok({ changed, files: changed.length, replacements: changed.reduce((n, c) => n + c.count, 0) });
});
