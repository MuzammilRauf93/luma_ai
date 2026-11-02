import { promises as fs } from "fs";
import { fail, handle, type Ctx } from "@/lib/http";
import { read } from "@/lib/store";
import { zipPath } from "@/lib/deploy";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  const db = await read();
  const d = db.deploys.find((x) => x.id === id && x.provider === "zip");
  if (!d) return fail("Download not found", 404);
  const ws = db.workspaces.find((w) => w.id === d.workspaceId);
  const data = await fs.readFile(await zipPath(d)).catch(() => null);
  if (!data) return fail("This ZIP has been cleaned up; export again.", 404);
  const name = `${(ws?.name ?? "site").replace(/[^\w.-]+/g, "-")}.zip`;
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
