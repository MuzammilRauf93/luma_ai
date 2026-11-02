import "server-only";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { DATA_DIR, mutate, newId, now, read } from "./store";
import { publish } from "./bus";
import { listFiles, readFileBuffer, workspaceRoot } from "./files";
import { decrypt } from "./crypto";
import { runProcess, toolPath } from "./proc";
import { zip } from "./zip";
import { updateWorkspace } from "./repo";
import { redact, secretEnv } from "./secrets";
import { runDetached } from "./auth";
import type { Deploy, DeployProvider, Workspace } from "./types";

/**
 * One-click deploy (Phase 4). Static workspaces publish as they are; Flutter workspaces are
 * built with `flutter build web` first. Providers: Netlify and Vercel (personal access tokens,
 * stored encrypted in Settings), GitHub Pages (through your git + gh login), or a ZIP download.
 */

const NETLIFY = () => process.env.LUMA_NETLIFY_API || "https://api.netlify.com/api/v1";
const VERCEL = () => process.env.LUMA_VERCEL_API || "https://api.vercel.com";
const POLL_MS = 2000;
const POLL_LIMIT_MS = 180_000;
const MAX_TOTAL = 50 * 1024 * 1024;

export const PROVIDERS: { id: DeployProvider; label: string; needs: string }[] = [
  { id: "netlify", label: "Netlify", needs: "A Netlify personal access token (Settings → Deploy accounts)" },
  { id: "vercel", label: "Vercel", needs: "A Vercel access token (Settings → Deploy accounts)" },
  { id: "github_pages", label: "GitHub Pages", needs: "A GitHub repo connected on this page and the GitHub CLI signed in" },
  { id: "zip", label: "Download ZIP", needs: "Nothing: upload the ZIP to any static host" },
];

type SiteFile = { path: string; data: Buffer };

// ---------------------------------------------------------------- collect + checks

async function walk(dir: string, base = dir): Promise<SiteFile[]> {
  const out: SiteFile[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(abs, base)));
    else if (e.isFile()) out.push({ path: path.relative(base, abs).split(path.sep).join("/"), data: await fs.readFile(abs) });
  }
  return out;
}

async function collect(ws: Workspace, log: (s: string) => void): Promise<SiteFile[]> {
  if (ws.platform === "flutter") {
    log("Building the Flutter app for the web (flutter build web)…");
    const root = workspaceRoot(ws.id);
    const defines = Object.entries(await secretEnv(ws.id)).map(([k, v]) => `--dart-define=${k}=${v}`);
    const r = await runProcess("flutter", ["build", "web", "--release", ...defines], {
      cwd: root,
      timeoutMs: 600_000,
      env: { ...process.env, PATH: toolPath(), CI: "1" } as NodeJS.ProcessEnv,
    });
    if (r.code !== 0) {
      throw new Error(
        r.code === 127
          ? "Flutter isn't installed (or not on PATH), so the app can't be built for the web."
          : `flutter build web failed:\n${redact((r.stderr || r.stdout).split("\n").slice(-12).join("\n"), await secretEnv(ws.id))}`,
      );
    }
    return walk(path.join(root, "build", "web"));
  }
  const files: SiteFile[] = [];
  for (const f of await listFiles(ws.id)) {
    if (f.path.split("/").some((seg) => seg.startsWith("."))) continue;
    const data = await readFileBuffer(ws.id, f.path);
    if (data) files.push({ path: f.path, data });
  }
  return files;
}

/** Find local links/assets that point at files that don't exist. */
export function linkWarnings(files: SiteFile[]) {
  const have = new Set(files.map((f) => f.path));
  const warnings: string[] = [];
  for (const f of files) {
    if (!/\.html?$/i.test(f.path)) continue;
    const html = f.data.toString("utf8");
    const dir = path.posix.dirname(f.path);
    for (const m of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"'#?]+)[^"']*["']/gi)) {
      const ref = m[1].trim();
      if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;
      let target = ref.startsWith("/") ? ref.slice(1) : path.posix.normalize(path.posix.join(dir === "." ? "" : dir, ref));
      if (target.endsWith("/") || target === "") target += "index.html";
      if (!have.has(target) && !have.has(`${target}/index.html`) && !have.has(`${target}.html`)) {
        warnings.push(`${f.path} links to “${ref}”, which doesn't exist.`);
        if (warnings.length >= 15) return warnings;
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------- tokens

export async function tokenFor(provider: "netlify" | "vercel") {
  const db = await read();
  const enc = db.settings.deployTokens?.[provider];
  if (!enc) throw new Error(`Connect your ${provider === "netlify" ? "Netlify" : "Vercel"} account in Settings → Deploy accounts first.`);
  return decrypt(enc);
}

/** Check a token against the provider and return the account name. */
export async function verifyToken(provider: "netlify" | "vercel", token: string) {
  const url = provider === "netlify" ? `${NETLIFY()}/user` : `${VERCEL()}/v2/user`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${provider === "netlify" ? "Netlify" : "Vercel"} rejected this token (${res.status}).`);
  const j = (await res.json()) as { email?: string; full_name?: string; user?: { username?: string; email?: string } };
  return j.email ?? j.full_name ?? j.user?.username ?? j.user?.email ?? "connected";
}

async function api<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "luma-site";

// ---------------------------------------------------------------- providers

async function deployNetlify(ws: Workspace, files: SiteFile[], log: (s: string) => void) {
  const token = await tokenFor("netlify");
  let siteId = ws.deploy?.provider === "netlify" ? ws.deploy.siteId : undefined;
  let siteName = ws.deploy?.siteName;
  if (!siteId) {
    log("Creating a Netlify site…");
    const site = await api<{ id: string; name: string; ssl_url?: string; url?: string }>(`${NETLIFY()}/sites`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${slug(ws.name)}-${Math.random().toString(36).slice(2, 6)}` }),
    });
    siteId = site.id;
    siteName = site.name;
  }
  log(`Uploading ${files.length} files…`);
  let d = await api<{ id: string; state: string; ssl_url?: string; deploy_ssl_url?: string; url?: string; error_message?: string }>(
    `${NETLIFY()}/sites/${siteId}/deploys`,
    token,
    { method: "POST", headers: { "Content-Type": "application/zip" }, body: new Uint8Array(zip(files)) },
  );
  const start = Date.now();
  while (!["ready", "error"].includes(d.state) && Date.now() - start < POLL_LIMIT_MS) {
    await sleep(POLL_MS);
    d = await api(`${NETLIFY()}/deploys/${d.id}`, token);
  }
  if (d.state === "error") throw new Error(`Netlify couldn't publish: ${d.error_message ?? "unknown error"}`);
  if (d.state !== "ready") throw new Error("Netlify is still processing; check your Netlify dashboard in a minute.");
  return { url: d.ssl_url ?? d.url, deployUrl: d.deploy_ssl_url, siteId, siteName };
}

async function deployVercel(ws: Workspace, files: SiteFile[], log: (s: string) => void) {
  const token = await tokenFor("vercel");
  const name = ws.deploy?.provider === "vercel" && ws.deploy.siteName ? ws.deploy.siteName : slug(ws.name);
  log(`Uploading ${files.length} files to Vercel…`);
  let d = await api<{ id: string; url: string; readyState: string; alias?: string[]; errorMessage?: string }>(
    `${VERCEL()}/v13/deployments`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        target: "production",
        projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
        files: files.map((f) => ({ file: f.path, data: f.data.toString("base64"), encoding: "base64" })),
      }),
    },
  );
  const start = Date.now();
  while (!["READY", "ERROR", "CANCELED"].includes(d.readyState) && Date.now() - start < POLL_LIMIT_MS) {
    await sleep(POLL_MS);
    d = await api(`${VERCEL()}/v13/deployments/${d.id}`, token);
  }
  if (d.readyState !== "READY") throw new Error(`Vercel deploy ${d.readyState.toLowerCase()}: ${d.errorMessage ?? "check your Vercel dashboard"}`);
  const prod = d.alias?.find((a) => !a.includes("-git-")) ?? d.alias?.[0];
  return { url: `https://${prod ?? d.url}`, deployUrl: `https://${d.url}`, siteId: name, siteName: name };
}

async function deployPages(ws: Workspace, files: SiteFile[], log: (s: string) => void) {
  const repo = ws.git?.githubRepo;
  if (!ws.git?.enabled || !ws.git.remoteUrl || !repo) throw new Error("GitHub Pages needs a GitHub repository: connect one in the GitHub section first.");
  const { gh: ghApi, githubToken, gitAuthEnv } = await import("./github");
  const env = { ...process.env, PATH: toolPath(), GIT_TERMINAL_PROMPT: "0", ...(await gitAuthEnv()) } as NodeJS.ProcessEnv;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "luma-pages-"));
  try {
    for (const f of files) {
      const abs = path.join(tmp, f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.data);
    }
    await fs.writeFile(path.join(tmp, ".nojekyll"), "");
    const g = (args: string[]) => runProcess("git", args, { cwd: tmp, env, timeoutMs: 120_000 });
    log("Publishing to the gh-pages branch…");
    for (const args of [
      ["init", "-q"],
      ["checkout", "-q", "-b", "gh-pages"],
      ["add", "-A"],
      ["-c", "user.name=Luma", "-c", "user.email=luma@localhost", "commit", "-q", "-m", `Deploy ${ws.name} from Luma`],
      ["push", "-f", ws.git.remoteUrl, "gh-pages:gh-pages"],
    ]) {
      const r = await g(args);
      if (r.code !== 0) throw new Error(`git ${args[0] === "-c" ? "commit" : args[0]} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  log("Turning on GitHub Pages…");
  const [owner, name] = repo.split("/");
  let url = `https://${owner}.github.io/${name}/`;
  if (await githubToken()) {
    await ghApi(`/repos/${repo}/pages`, { method: "POST", json: { source: { branch: "gh-pages", path: "/" } } }); // 409 if already on
    const info = await ghApi<{ html_url?: string }>(`/repos/${repo}/pages`);
    if (info.data.html_url) url = info.data.html_url;
  } else {
    const gh = (args: string[]) => runProcess("gh", args, { env, timeoutMs: 30_000 });
    await gh(["api", "-X", "POST", `repos/${repo}/pages`, "-f", "source[branch]=gh-pages", "-f", "source[path]=/"]);
    const info = await gh(["api", `repos/${repo}/pages`, "--jq", ".html_url"]);
    if (info.code === 0 && info.stdout.trim().startsWith("http")) url = info.stdout.trim();
  }
  return { url, siteId: repo, siteName: repo, note: "GitHub Pages can take a minute or two to show the new version." };
}

async function deployZip(ws: Workspace, files: SiteFile[], id: string) {
  const dir = path.join(DATA_DIR, "exports", ws.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.zip`), zip(files));
  return { url: `/api/deploys/${id}/download` };
}

export async function zipPath(deploy: Deploy) {
  return path.join(DATA_DIR, "exports", deploy.workspaceId, `${deploy.id}.zip`);
}

// ---------------------------------------------------------------- orchestration

async function saveDeploy(d: Deploy) {
  await mutate((db) => {
    const i = db.deploys.findIndex((x) => x.id === d.id);
    if (i >= 0) db.deploys[i] = d;
    else db.deploys.push(d);
  });
  publish(d.workspaceId, { kind: "deploy", deploy: d });
}

const running = new Set<string>();

/** Start a deploy in the background; progress arrives as live "deploy" events. */
export async function startDeploy(ws: Workspace, provider: DeployProvider) {
  if (running.has(ws.id)) throw new Error("A deploy is already running for this workspace.");
  if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Unknown deploy provider.");
  if (provider === "netlify" || provider === "vercel") await tokenFor(provider); // fail fast
  const d: Deploy = { id: newId("dep"), workspaceId: ws.id, provider, status: "building", warnings: [], fileCount: 0, createdAt: now() };
  if (ws.git?.enabled) {
    const sha = await runProcess("git", ["rev-parse", "--short", "HEAD"], { cwd: workspaceRoot(ws.id), timeoutMs: 5000 });
    if (sha.code === 0) d.commit = sha.stdout.trim();
  }
  await saveDeploy(d);
  running.add(ws.id);
  const log = (s: string) => {
    d.warnings = d.warnings.filter((w) => !w.startsWith("…"));
    d.warnings.push(`…${s}`);
    void saveDeploy({ ...d });
  };
  void runDetached(async () => {
    try {
      const files = await collect(ws, log);
      if (!files.length) throw new Error("There are no files to deploy yet.");
      if (!files.some((f) => f.path === "index.html")) throw new Error("There's no index.html at the top of the project, so the site would have no home page.");
      const total = files.reduce((n, f) => n + f.data.length, 0);
      if (total > MAX_TOTAL) throw new Error(`The site is ${(total / 1e6).toFixed(1)} MB; the limit is ${MAX_TOTAL / 1e6} MB.`);
      d.fileCount = files.length;
      const warnings = linkWarnings(files);
      const res =
        provider === "netlify"
          ? await deployNetlify(ws, files, log)
          : provider === "vercel"
            ? await deployVercel(ws, files, log)
            : provider === "github_pages"
              ? await deployPages(ws, files, log)
              : await deployZip(ws, files, d.id);
      d.status = "ready";
      d.url = res.url;
      d.deployUrl = "deployUrl" in res ? res.deployUrl : undefined;
      const note = "note" in res && typeof res.note === "string" ? res.note : null;
      d.warnings = note ? [...warnings, note] : warnings;
      if (provider !== "zip" && "siteId" in res) {
        await updateWorkspace(ws.id, { deploy: { provider, siteId: res.siteId, siteName: res.siteName, url: res.url } });
      }
    } catch (err) {
      d.status = "error";
      d.error = err instanceof Error ? err.message : String(err);
      d.warnings = d.warnings.filter((w) => !w.startsWith("…"));
    } finally {
      d.finishedAt = now();
      running.delete(ws.id);
      await saveDeploy({ ...d });
      if (provider !== "zip") {
        const { notify } = await import("./notifications");
        await notify({
          workspaceId: ws.id,
          kind: "deploy",
          title: d.status === "ready" ? `${ws.name} is live` : `Deploy of ${ws.name} failed`,
          body: d.status === "ready" ? `${d.url ?? ""}${d.warnings.length ? ` · ${d.warnings.length} warning(s)` : ""}` : d.error ?? "",
          link: `/w/${ws.id}/ship`,
        }).catch(() => undefined);
      }
    }
  });
  return d;
}
