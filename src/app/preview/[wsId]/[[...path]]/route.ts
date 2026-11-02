import { mimeFor, readFileBuffer } from "@/lib/files";
import { guard } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a workspace's files so the live preview iframe can load them like a real site. */
export async function GET(req: Request, { params }: { params: Promise<{ wsId: string; path?: string[] }> }) {
  const { wsId, path } = await params;
  const g = await guard(req);
  if ("error" in g) return g.error;
  let rel = (path ?? []).map(decodeURIComponent).join("/");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  try {
    let buf = await readFileBuffer(wsId, rel);
    if (!buf && !rel.includes(".")) {
      rel = `${rel}/index.html`;
      buf = await readFileBuffer(wsId, rel);
    }
    if (!buf) return new Response(notFound(rel), { status: 404, headers: { "Content-Type": "text/html" } });
    if (rel.endsWith(".html") || rel.endsWith(".htm")) {
      // Next.js strips trailing slashes, so pin relative URLs to the file's folder.
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
      const base = `<base href="/preview/${wsId}/${dir}">`;
      let html = buf.toString("utf8");
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}`) : base + html;
      return new Response(html, { headers: { "Content-Type": mimeFor(rel), "Cache-Control": "no-store" } });
    }
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": mimeFor(rel), "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}

const notFound = (rel: string) =>
  `<!doctype html><body style="font-family:system-ui;display:grid;place-content:center;min-height:90vh;color:#57534e;text-align:center"><h2 style="margin:0">Nothing here yet</h2><p><code>${rel.replace(/[<>&]/g, "")}</code> doesn't exist in this project.</p></body>`;
