import { guard, type Ctx } from "@/lib/http";
import { screenshot } from "@/lib/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current simulator screen as a JPEG (the preview polls this). */
export async function GET(req: Request, { params }: Ctx<{ id: string }>) {
  const { id } = await params;
  const g = await guard(req);
  if ("error" in g) return g.error;
  const img = await screenshot(id);
  if (!img) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
