import { handle, ok, type Ctx } from "@/lib/http";
import { listFiles } from "@/lib/files";

export const runtime = "nodejs";

export const GET = handle(async (_req: Request, { params }: Ctx<{ id: string }>) => {
  const { id } = await params;
  return ok({ files: await listFiles(id) });
});
