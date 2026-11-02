import "server-only";
import { promises as fs, existsSync, realpathSync } from "fs";
import os from "os";
import path from "path";
import { DATA_DIR, mutate, newId, now } from "./store";
import { publish } from "./bus";
import { listFiles, readFile, recordCheckpoint, workspaceRoot } from "./files";
import { runProcess, safeEnv, toolPath } from "./proc";
import { redact, secretEnv } from "./secrets";
import type { CommandRun, Workspace } from "./types";

/**
 * Sandboxed command execution (Phase 4).
 *
 * Safety layers, outermost first:
 * 1. Permission: only agents with "run_commands" (and the user) can run commands, and only
 *    when the workspace allows it.
 * 2. No shell: the command line is split into argv and run directly, so pipes, redirects,
 *    `;`, `&&`, `$(…)` and globbing are impossible.
 * 3. Allowlist: only known project tools (flutter, dart, npm, npx <known tool>, linters…)
 *    plus prefixes you add in workspace settings.
 * 4. Path jail: arguments may not point outside the workspace folder.
 * 5. OS sandbox: on macOS every command runs under `sandbox-exec` with a profile that blocks
 *    writes outside the workspace (and tool caches) and blocks reading credentials and Luma's
 *    own data. On Linux, bubblewrap (`bwrap`) is used when installed.
 * 6. Scrubbed environment (no API keys/tokens), a timeout, an output cap, and one command at
 *    a time per workspace.
 *
 * Files a command changes (e.g. a formatter) get checkpoints, so they can be diffed and undone.
 */

export const DEFAULT_TIMEOUT_S = 180;
export const MAX_TIMEOUT_S = 600;
const KEEP_RUNS = 300;
const TOOL_OUTPUT = 6000;
const STORE_OUTPUT = 40_000;

type Rule = { cmd: string; sub?: string[]; any?: boolean; needsSandbox?: boolean; hint?: string };

const LINTERS = ["prettier", "eslint", "stylelint", "html-validate", "tsc", "vitest", "jest", "serve", "http-server", "lighthouse"];

export const RULES: Rule[] = [
  { cmd: "flutter", sub: ["analyze", "test", "pub", "format", "doctor", "--version", "build", "clean", "gen-l10n"] },
  { cmd: "dart", sub: ["analyze", "format", "test", "fix", "pub", "--version", "run"] },
  { cmd: "npm", sub: ["install", "i", "ci", "test", "run", "ls", "outdated", "init", "--version", "audit", "uninstall"] },
  { cmd: "npx", sub: LINTERS, hint: `npx is limited to: ${LINTERS.join(", ")}` },
  ...LINTERS.map((cmd) => ({ cmd, any: true })),
  { cmd: "git", sub: ["status", "diff", "log", "show"], hint: "Luma commits for you; agents may only read git history" },
  { cmd: "ls", any: true },
  { cmd: "wc", any: true },
  { cmd: "grep", any: true },
  { cmd: "node", any: true, needsSandbox: true },
  { cmd: "python3", any: true, needsSandbox: true },
];

// ---------------------------------------------------------------- parsing & policy

/** Split a command line into argv like a shell would for quotes, but refuse shell syntax. */
export function parseCommand(line: string): { argv: string[] } | { error: string } {
  const argv: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  const s = line.trim();
  if (!s) return { error: "Empty command." };
  if (s.length > 2000) return { error: "Command is too long." };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < s.length) cur += s[++i];
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) argv.push(cur);
      cur = "";
      has = false;
    } else if (";|&<>`$()\n".includes(c)) {
      return { error: `Shell syntax like "${c}" isn't supported. Commands run without a shell: run one command at a time, with no pipes, redirects or variables.` };
    } else {
      cur += c;
      has = true;
    }
  }
  if (quote) return { error: "Unclosed quote in the command." };
  if (has) argv.push(cur);
  return { argv };
}

function pathsInside(argv: string[], root: string): string | null {
  for (const raw of argv.slice(1)) {
    const parts = [raw, ...(raw.includes("=") ? [raw.slice(raw.indexOf("=") + 1)] : [])];
    for (const a of parts) {
      if (a.startsWith("~")) return `Paths outside the project aren't allowed (${raw}).`;
      if (a.startsWith("/") || a.includes("..")) {
        const abs = path.resolve(root, a);
        if (abs !== root && !abs.startsWith(root + path.sep)) return `Paths outside the project aren't allowed (${raw}).`;
      }
    }
  }
  return null;
}

export function checkPolicy(argv: string[], ws: Workspace, sandboxed: boolean): string | null {
  const root = workspaceRoot(ws.id);
  const prog = argv[0];
  if (!prog || prog.includes("/")) return "Run tools by name (e.g. `flutter analyze`), not by path.";
  const extra = (ws.extraCommands ?? []).map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);
  const extraOk = extra.some((p) => p.every((tok, i) => argv[i] === tok));
  if (!extraOk) {
    const rule = RULES.find((r) => r.cmd === prog);
    if (!rule)
      return `\`${prog}\` isn't on this workspace's allowed list. Allowed: ${[...new Set(RULES.map((r) => r.cmd))].join(", ")}${extra.length ? `, ${extra.map((p) => p.join(" ")).join(", ")}` : ""}. Ask the user to add it in Workspace settings if you really need it.`;
    if (rule.needsSandbox && !sandboxed)
      return `\`${prog}\` can run any code, so it's only allowed inside the OS sandbox, which isn't available on this computer. Ask the user to allow it in Workspace settings.`;
    if (rule.sub) {
      const sub = argv.find((a, i) => i > 0 && !a.startsWith("-")) ?? argv[1];
      const first = prog === "npx" ? argv.slice(1).find((a) => !a.startsWith("-")) : sub;
      if (!first || !rule.sub.includes(first)) return `\`${prog} ${first ?? ""}\` isn't allowed. ${rule.hint ?? `Allowed: ${prog} ${rule.sub.join(" | ")}`}.`;
    }
  }
  return pathsInside(argv, root);
}

// ---------------------------------------------------------------- sandbox

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function flutterRoot(): string | null {
  for (const dir of toolPath().split(":")) {
    const f = path.join(dir, "flutter");
    if (existsSync(f)) {
      try {
        return path.resolve(realpathSync(f), "..", "..");
      } catch {
        return path.resolve(dir, "..");
      }
    }
  }
  return null;
}

function macProfile(root: string) {
  const home = os.homedir();
  const writable = [
    root,
    os.tmpdir(),
    "/private/tmp",
    "/private/var/folders",
    "/dev",
    ...[".pub-cache", ".dart-tool", ".dartServer", ".flutter", ".flutter-devtools", ".npm", ".cache", ".config", ".gradle", ".cocoapods", "Library/Caches", "Library/Developer"].map((p) => path.join(home, p)),
  ];
  const fr = flutterRoot();
  if (fr) writable.push(fr);
  const secretDirs = [".ssh", ".aws", ".gnupg", ".claude", ".config/gh", ".docker", "Library/Keychains", ".netlify", ".vercel"].map((p) => path.join(home, p));
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write* ${writable.map((p) => `(subpath ${q(p)})`).join(" ")})
(deny file-read* file-write* ${secretDirs.map((p) => `(subpath ${q(p)})`).join(" ")} (literal ${q(path.join(home, ".netrc"))}) (literal ${q(path.join(home, ".npmrc"))}))
(deny file-read* file-write* (subpath ${q(DATA_DIR)}))
(allow file-read* file-write* (subpath ${q(root)}))`;
}

type Sandbox = { kind: "sandbox-exec" | "bwrap" | "none" };
let sandboxCache: Promise<Sandbox> | null = null;

export function detectSandbox(): Promise<Sandbox> {
  if (process.env.LUMA_SANDBOX === "off") return Promise.resolve({ kind: "none" });
  return (sandboxCache ??= (async () => {
    if (process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")) {
      const r = await runProcess("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"], { timeoutMs: 5000 });
      if (r.code === 0) return { kind: "sandbox-exec" };
    }
    if (process.platform === "linux") {
      const r = await runProcess("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "true"], { timeoutMs: 5000 });
      if (r.code === 0) return { kind: "bwrap" };
    }
    return { kind: "none" };
  })());
}

function wrap(sb: Sandbox, root: string, argv: string[]): [string, string[]] {
  if (sb.kind === "sandbox-exec") return ["/usr/bin/sandbox-exec", ["-p", macProfile(root), ...argv]];
  if (sb.kind === "bwrap") {
    const home = os.homedir();
    const binds: string[] = [];
    for (const p of [".pub-cache", ".npm", ".cache", ".dart-tool", ".dartServer", ".flutter"]) {
      const abs = path.join(home, p);
      if (existsSync(abs)) binds.push("--bind", abs, abs);
    }
    const hide: string[] = [];
    for (const p of [".ssh", ".aws", ".gnupg", ".claude", ".config/gh", ".docker"]) {
      const abs = path.join(home, p);
      if (existsSync(abs)) hide.push("--tmpfs", abs);
    }
    return [
      "bwrap",
      [
        "--ro-bind", "/", "/",
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        ...(existsSync(DATA_DIR) ? ["--tmpfs", DATA_DIR] : []),
        "--bind", root, root,
        ...binds,
        ...hide,
        "--chdir", root,
        "--die-with-parent",
        ...argv,
      ],
    ];
  }
  return [argv[0], argv.slice(1)];
}

// ---------------------------------------------------------------- change tracking

const TEXT = /\.(html?|css|scss|js|mjs|cjs|jsx|ts|tsx|json|md|txt|dart|yaml|yml|xml|svg|toml|lock|gitignore|env\.example|sh|py|rb|swift|kt|gradle|plist|arb)$/i;

export async function snapshot(wsId: string) {
  const files = await listFiles(wsId);
  const map = new Map<string, { size: number; content: string | null }>();
  let budget = 8_000_000;
  for (const f of files) {
    const text = TEXT.test(f.path) && f.size < 1_000_000 && budget > 0;
    const content = text ? await readFile(wsId, f.path) : null;
    if (content) budget -= content.length;
    map.set(f.path, { size: f.size, content });
  }
  return map;
}

export async function recordChanges(wsId: string, before: Awaited<ReturnType<typeof snapshot>>, actor: string, ticketId: string | null) {
  const after = await snapshot(wsId);
  const changed: string[] = [];
  const done = async () => {
    if (changed.length) await (await import("./files")).syncChanged(wsId, changed);
    return changed;
  };
  for (const [p, a] of after) {
    const b = before.get(p);
    if (!b) {
      changed.push(p);
      if (a.content !== null) await recordCheckpoint(wsId, p, null, a.content, { actor, ticketId });
    } else if (a.content !== null && b.content !== null ? a.content !== b.content : a.size !== b.size) {
      changed.push(p);
      if (a.content !== null && b.content !== null) await recordCheckpoint(wsId, p, b.content, a.content, { actor, ticketId });
    }
  }
  for (const [p, b] of before) {
    if (!after.has(p)) {
      changed.push(p);
      if (b.content !== null) await recordCheckpoint(wsId, p, b.content, null, { actor, ticketId });
    }
  }
  return done();
}

// ---------------------------------------------------------------- running

type State = { chains: Map<string, Promise<unknown>>; controllers: Map<string, AbortController> };
const g = globalThis as unknown as { __lumaCmd?: State };
const st: State = (g.__lumaCmd ??= { chains: new Map(), controllers: new Map() });

async function saveRun(run: CommandRun) {
  await mutate((db) => {
    const i = db.commandRuns.findIndex((r) => r.id === run.id);
    if (i >= 0) db.commandRuns[i] = run;
    else db.commandRuns.push(run);
    const mine = db.commandRuns.filter((r) => r.workspaceId === run.workspaceId);
    if (mine.length > KEEP_RUNS) {
      const drop = new Set(mine.slice(0, mine.length - KEEP_RUNS).map((r) => r.id));
      db.commandRuns = db.commandRuns.filter((r) => !drop.has(r.id));
    }
  });
  publish(run.workspaceId, { kind: "command", run });
}

export function cancelCommand(runId: string) {
  const c = st.controllers.get(runId);
  if (!c) return false;
  c.abort();
  return true;
}

/**
 * Run one command in a workspace. Resolves when it finishes (commands in the same workspace
 * run one at a time). Refused commands resolve immediately with status "refused".
 */
export async function runCommand(opts: {
  workspace: Workspace;
  command: string;
  actor: string;
  ticketId: string | null;
  timeoutSec?: number;
  signal?: AbortSignal;
}): Promise<CommandRun> {
  const { workspace: ws, command, actor, ticketId } = opts;
  const sb = await detectSandbox();
  const base: CommandRun = {
    id: newId("cmd"),
    workspaceId: ws.id,
    ticketId,
    actor,
    command: command.trim(),
    status: "running",
    exitCode: null,
    output: "",
    durationMs: 0,
    changedFiles: [],
    sandboxed: sb.kind !== "none",
    createdAt: now(),
  };
  const refuse = async (why: string) => {
    const run = { ...base, status: "refused" as const, output: why };
    await saveRun(run);
    return run;
  };
  if (ws.commandsEnabled === false) return refuse("Commands are turned off for this workspace (Workspace settings).");
  const parsed = parseCommand(command);
  if ("error" in parsed) return refuse(parsed.error);
  const why = checkPolicy(parsed.argv, ws, sb.kind !== "none");
  if (why) return refuse(why);

  const timeoutMs = Math.min(MAX_TIMEOUT_S, Math.max(5, opts.timeoutSec ?? DEFAULT_TIMEOUT_S)) * 1000;
  const prev = st.chains.get(ws.id) ?? Promise.resolve();
  const job = prev.catch(() => undefined).then(async () => {
    const root = workspaceRoot(ws.id);
    await fs.mkdir(root, { recursive: true });
    const ctrl = new AbortController();
    st.controllers.set(base.id, ctrl);
    const onOuterAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onOuterAbort);
    await saveRun(base);
    await (await import("./fileMirror")).pull(ws.id, true); // run on the latest files from every host
    const before = await snapshot(ws.id);
    const secrets = await secretEnv(ws.id);
    const started = Date.now();

    // Stream output to the UI in small batches.
    let pending = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      if (pending) publish(ws.id, { kind: "command_output", runId: base.id, chunk: redact(pending, secrets) });
      pending = "";
    };
    const [cmd, args] = wrap(sb, root, parsed.argv);
    const res = await runProcess(cmd, args, {
      cwd: root,
      timeoutMs,
      maxOutput: STORE_OUTPUT,
      signal: ctrl.signal,
      env: safeEnv({
        ...secrets,
        HOME: os.homedir(),
        PATH: [path.join(root, "node_modules", ".bin"), toolPath()].join(":"),
        LUMA_WORKSPACE: root,
        GIT_CEILING_DIRECTORIES: path.dirname(path.dirname(root)),
      }),
      onData: (chunk) => {
        pending += chunk;
        flushTimer ??= setTimeout(flush, 250);
      },
    });
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    opts.signal?.removeEventListener("abort", onOuterAbort);
    st.controllers.delete(base.id);

    const changedFiles = await recordChanges(ws.id, before, actor, ticketId);
    if (changedFiles.length) publish(ws.id, { kind: "files_changed", workspaceId: ws.id, paths: changedFiles });
    const output = redact((res.stdout + (res.stderr ? (res.stdout ? "\n" : "") + res.stderr : "")).slice(-STORE_OUTPUT), secrets);
    const aborted = ctrl.signal.aborted;
    const run: CommandRun = {
      ...base,
      status: res.timedOut ? "timeout" : aborted ? "failed" : res.code === 0 ? "ok" : "failed",
      exitCode: res.code,
      output: aborted ? output + "\n(stopped)" : res.code === 127 && !output.trim() ? `\`${parsed.argv[0]}\` isn't installed on this computer (or not on PATH).` : output,
      durationMs: Date.now() - started,
      changedFiles,
    };
    await saveRun(run);
    return run;
  });
  st.chains.set(ws.id, job);
  return job;
}

/** What the agent sees after running a command. */
export function describeRun(run: CommandRun) {
  if (run.status === "refused") return `Command refused: ${run.output}`;
  const head =
    run.status === "timeout"
      ? `Timed out after ${Math.round(run.durationMs / 1000)}s.`
      : `Exit code ${run.exitCode} (${(run.durationMs / 1000).toFixed(1)}s)${run.status === "ok" ? "" : " — FAILED"}.`;
  const out = run.output.trim();
  const tail = out.length > TOOL_OUTPUT ? "…(earlier output cut)\n" + out.slice(-TOOL_OUTPUT) : out || "(no output)";
  const changed = run.changedFiles.length ? `\nFiles changed by the command: ${run.changedFiles.slice(0, 20).join(", ")}${run.changedFiles.length > 20 ? " …" : ""}` : "";
  return `${head}\n${tail}${changed}`;
}
