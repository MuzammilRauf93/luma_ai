import { guard, type Ctx } from "@/lib/http";
import { subscribe } from "@/lib/bus";
import type { LiveEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events: live agent activity for one workspace. */
export async function GET(req: Request, { params }: Ctx<{ id: string }>) {
  const { id } = await params;
  const g = await guard(req);
  if ("error" in g) return g.error;
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LiveEvent | { kind: "ping" }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribe(id, send);
      const ping = setInterval(() => send({ kind: "ping" }), 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send({ kind: "ping" });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
