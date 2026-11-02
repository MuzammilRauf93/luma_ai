import { mimeFor, readFileBuffer } from "@/lib/files";
import { guard } from "@/lib/http";
import { signScoped, verifyScoped } from "@/lib/crypto";

// Agent-written pages run in an opaque, sandboxed origin so their scripts can never call
// Luma's API with the signed-in user's cookie. Sub-resources authenticate with a signed,
// workspace-scoped token carried in the path (/preview/<ws>/_t/<token>/...).
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serves a workspace's files so the live preview iframe can load them like a real site. */
export async function GET(req: Request, { params }: { params: Promise<{ wsId: string; path?: string[] }> }) {
  const { wsId, path: rawPath } = await params;
  let path = rawPath ?? [];
  let token: string;
  if (path[0] === "_t") {
    token = path[1] ?? "";
    if (!(await verifyScoped(`preview:${wsId}`, token))) return new Response("Preview link expired — reload the page.", { status: 401, headers: { "Content-Security-Policy": SANDBOX } });
    path = path.slice(2);
  } else {
    const g = await guard(req);
    if ("error" in g) return g.error;
    token = await signScoped(`preview:${wsId}`);
  }
  const headers = (type: string) => ({ "Content-Type": type, "Cache-Control": "no-store", "Content-Security-Policy": SANDBOX, "X-Content-Type-Options": "nosniff" });
  let rel = path.map(decodeURIComponent).join("/");
  if (!rel || rel.endsWith("/")) rel += "index.html";
  try {
    let buf = await readFileBuffer(wsId, rel);
    if (!buf && !rel.includes(".")) {
      rel = `${rel}/index.html`;
      buf = await readFileBuffer(wsId, rel);
    }
    if (!buf) return new Response(notFound(rel), { status: 404, headers: headers("text/html") });
    if (rel.endsWith(".html") || rel.endsWith(".htm")) {
      // Next.js strips trailing slashes, so pin relative URLs to the file's folder.
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
      // The sandbox gives the page an opaque origin, where localStorage/sessionStorage throw.
      // Give sites an in-memory stand-in so code that saves preferences keeps working.
      const shim = `<script>(function(){function m(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}});try{document.cookie}catch(e){try{Object.defineProperty(document,"cookie",{get:function(){return""},set:function(){},configurable:true})}catch(_){}}})();</script>`;
      const base = `<base href="/preview/${wsId}/_t/${token}/${dir}">${shim}`;
      let html = buf.toString("utf8");
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${base}`) : base + html;
      return new Response(html, { headers: headers(mimeFor(rel)) });
    }
    return new Response(new Uint8Array(buf), { headers: headers(mimeFor(rel)) });
  } catch {
    return new Response("Bad request", { status: 400 });
  }
}

const notFound = (rel: string) =>
  `<!doctype html><body style="font-family:system-ui;display:grid;place-content:center;min-height:90vh;color:#57534e;text-align:center"><h2 style="margin:0">Nothing here yet</h2><p><code>${rel.replace(/[<>&]/g, "")}</code> doesn't exist in this project.</p></body>`;
