import "server-only";
import { spawn } from "child_process";
import { createRequire } from "module";
import { existsSync, openSync, promises as fs } from "fs";
import os from "os";
import path from "path";
import { DATA_DIR, usingPostgres } from "./store";
import { ROLE } from "./role";
import { runProcess, toolPath } from "./proc";

/**
 * Settings → System (Phase 7): everything that used to need a terminal or a config file.
 * - Diagnostics: runtime, storage, encryption secret, optional packages, local tools.
 * - One-click install of Luma's optional packages (npm install, run by the server).
 * - Server configuration written to .env.local (database, secret, roles, …).
 * - Restart Luma from the browser so new configuration takes effect.
 */

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.local");

export const OPTIONAL_PACKAGES = [
  { name: "pg", range: "^8.13.0", purpose: "Postgres database (multiple servers, workers, cloud file storage)" },
  { name: "nodemailer", range: "^6.9.14", purpose: "Sending email (invites, password resets, notifications)" },
  { name: "@huggingface/transformers", range: "^3.0.2", purpose: "Smarter team-memory search (local AI model, ~25 MB download on first use)" },
] as const;

/** Server settings an admin may change from the UI (written to .env.local). */
export const CONFIG_KEYS = [
  { key: "LUMA_DATABASE_URL", label: "Postgres connection URL", secret: true, hint: "postgres://user:password@host:5432/luma — leave empty to use the built-in file database." },
  { key: "LUMA_SECRET", label: "Encryption secret", secret: true, hint: "Encrypts API keys, tokens and secrets. Must be identical on every Luma server." },
  { key: "LUMA_ROLE", label: "Server role", secret: false, hint: "all (default) · web (interface only) · worker (runs agents only). Split roles need Postgres." },
  { key: "LUMA_FILES", label: "Workspace files", secret: false, hint: "db (default with Postgres: files synced through the database) · disk (this machine only)" },
  { key: "LUMA_EMBEDDINGS", label: "Memory search", secret: false, hint: "auto (default) · minilm · ngram" },
  { key: "LUMA_APP_URL", label: "Public web address", secret: false, hint: "Used in email links, e.g. https://luma.example.com" },
] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number]["key"];

function installed(pkg: string) {
  try {
    createRequire(path.join(ROOT, "package.json")).resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

async function has(cmd: string, args: string[]) {
  const r = await runProcess(cmd, args, { env: { ...process.env, PATH: toolPath() } as NodeJS.ProcessEnv, timeoutMs: 8000 });
  return r.code === 0 ? (r.stdout || r.stderr).trim().split("\n")[0].slice(0, 80) : null;
}

export async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const out: Record<string, string> = {};
    for (const line of (await fs.readFile(ENV_FILE, "utf8")).split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
    return out;
  } catch {
    return {};
  }
}

const mask = (v: string) => (v.length <= 8 ? "••••" : `${v.slice(0, 4)}••••${v.slice(-3)}`);

export async function diagnostics() {
  const { detectSandbox } = await import("./commands");
  const [git, gh, flutter, xcode, npm, sandbox] = await Promise.all([
    has("git", ["--version"]),
    has("gh", ["--version"]),
    has("flutter", ["--version", "--machine"]).then((v) => (v ? "installed" : null)),
    process.platform === "darwin" ? has("xcrun", ["simctl", "help"]).then((v) => (v ? "installed" : null)) : Promise.resolve(null),
    has("npm", ["--version"]),
    detectSandbox(),
  ]);
  const file = await readEnvFile();
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8").catch(() => "{}")) as { version?: string };
  return {
    luma: { version: pkg.version ?? "dev", node: process.version, platform: `${os.type()} ${os.arch()}`, role: ROLE, dataDir: DATA_DIR, uptimeSec: Math.round(process.uptime()) },
    storage: {
      database: usingPostgres() ? "postgres" : "file",
      files: usingPostgres() && (process.env.LUMA_FILES ?? "db") !== "disk" ? "postgres + local cache" : "this computer's disk",
      secret: process.env.LUMA_SECRET ? "set" : existsSync(path.join(DATA_DIR, "secret.key")) ? "file (this computer only)" : "not created yet",
    },
    packages: OPTIONAL_PACKAGES.map((p) => ({ ...p, installed: installed(p.name) })),
    tools: [
      { name: "git", version: git, needed: "GitHub sync and history", help: process.platform === "darwin" ? "Install Apple's Command Line Tools (a dialog appears the first time git is used) or Xcode." : "Install git from your package manager." },
      { name: "npm", version: npm, needed: "Installing packages and project commands", help: "Comes with Node.js." },
      { name: "Flutter", version: flutter, needed: "Mobile app workspaces", help: "Install from flutter.dev, then restart Luma." },
      ...(process.platform === "darwin" ? [{ name: "Xcode simulator", version: xcode, needed: "iOS Simulator preview", help: "Install Xcode from the App Store and open it once." }] : []),
      { name: "GitHub CLI (optional)", version: gh, needed: "Not needed when GitHub is connected in Integrations", help: "" },
    ],
    sandbox: sandbox.kind,
    config: CONFIG_KEYS.map((c) => {
      const fromFile = file[c.key];
      const active = process.env[c.key];
      return {
        ...c,
        value: c.secret ? (fromFile ? mask(fromFile) : "") : fromFile ?? "",
        active: active ? (c.secret ? mask(active) : active) : "",
        pending: (fromFile ?? "") !== (active ?? ""),
      };
    }),
    canRestart: true,
  };
}

// ---------------------------------------------------------------- installs

type Job = { pkg: string; status: "running" | "ok" | "failed"; output: string; startedAt: string };
const g = globalThis as unknown as { __lumaInstall?: Job | null };

export function installJob() {
  return g.__lumaInstall ?? null;
}

export function installPackage(name: string) {
  const p = OPTIONAL_PACKAGES.find((x) => x.name === name);
  if (!p) throw new Error("Unknown package.");
  if (g.__lumaInstall?.status === "running") throw new Error("Another install is still running.");
  const job: Job = { pkg: p.name, status: "running", output: "", startedAt: new Date().toISOString() };
  g.__lumaInstall = job;
  void runProcess("npm", ["install", "--no-audit", "--no-fund", "--save-optional", `${p.name}@${p.range}`], {
    cwd: ROOT,
    env: { ...process.env, PATH: toolPath() } as NodeJS.ProcessEnv,
    timeoutMs: 600_000,
    onData: (c) => (job.output = (job.output + c).slice(-6000)),
  }).then((r) => {
    job.status = r.code === 0 ? "ok" : "failed";
    if (r.code !== 0 && !job.output.trim()) job.output = r.stderr || `npm exited with ${r.code}`;
  });
  return job;
}

// ---------------------------------------------------------------- configuration

export async function writeConfig(values: Partial<Record<ConfigKey, string | null>>) {
  const allowed = new Set(CONFIG_KEYS.map((c) => c.key as string));
  let text = "";
  try {
    text = await fs.readFile(ENV_FILE, "utf8");
  } catch {}
  const lines = text ? text.split("\n") : ["# Written by Luma AI → Settings → System"];
  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key)) continue;
    const v = raw === null || raw === undefined ? "" : String(raw).trim();
    if (/[\n\r]/.test(v)) throw new Error(`${key} can't contain line breaks.`);
    if (key === "LUMA_ROLE" && v && !["all", "web", "worker"].includes(v)) throw new Error("Server role must be all, web or worker.");
    if (key === "LUMA_FILES" && v && !["db", "disk"].includes(v)) throw new Error("Workspace files must be db or disk.");
    if (key === "LUMA_EMBEDDINGS" && v && !["auto", "minilm", "ngram"].includes(v)) throw new Error("Memory search must be auto, minilm or ngram.");
    if (key === "LUMA_DATABASE_URL" && v && !/^postgres(ql)?:\/\//.test(v)) throw new Error("The database URL should start with postgres://");
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    const line = `${key}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`;
    if (!v) {
      if (i >= 0) lines.splice(i, 1);
    } else if (i >= 0) lines[i] = line;
    else lines.push(line);
  }
  await fs.writeFile(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
}

/** Make the current encryption key explicit, so other servers can share it. */
export async function pinSecret() {
  if (process.env.LUMA_SECRET) return { already: true };
  const key = (await fs.readFile(path.join(DATA_DIR, "secret.key"), "utf8")).trim();
  await writeConfig({ LUMA_SECRET: key });
  return { already: false };
}

export async function testDatabase(url: string) {
  if (!installed("pg")) throw new Error("Install the Postgres package first (above).");
  const { Client } = createRequire(path.join(ROOT, "package.json"))("pg") as { Client: new (c: Record<string, unknown>) => { connect(): Promise<void>; query(q: string): Promise<{ rows: { v: string }[] }>; end(): Promise<void> } };
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    const r = await c.query("select version() as v");
    return r.rows[0]?.v?.split(",")[0] ?? "connected";
  } finally {
    await c.end().catch(() => undefined);
  }
}

/**
 * Restart Luma so .env.local and new packages take effect. A detached helper waits for this
 * process to exit, then starts the same npm script (or command) again; output goes to
 * .luma/server.log.
 */
export function restart() {
  const script = process.env.npm_lifecycle_event; // dev / start / worker / start:web
  const cmd = script ? `npm run ${script}` : [process.execPath, ...process.argv.slice(1)].map((a) => JSON.stringify(a)).join(" ");
  const log = openSync(path.join(DATA_DIR, "server.log"), "a");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const c of CONFIG_KEYS) delete env[c.key]; // let .env.local decide on the next start
  const child = spawn("sh", ["-c", `sleep 2; cd ${JSON.stringify(ROOT)} && exec ${cmd}`], { detached: true, stdio: ["ignore", log, log], env });
  child.unref();
  setTimeout(() => {
    // `next dev` serves from a child of the CLI: stop the CLI too so the port is freed.
    if (process.env.NODE_ENV === "development" && process.ppid > 1) {
      try {
        process.kill(process.ppid, "SIGTERM");
      } catch {}
    }
    process.exit(0);
  }, 400);
  return { command: cmd };
}
