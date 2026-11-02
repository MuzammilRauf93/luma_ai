import "server-only";
import { spawn, execFile, type ChildProcessWithoutNullStreams } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { read } from "./store";
import { subscribe } from "./bus";
import { workspaceRoot } from "./files";
import type { Workspace } from "./types";

/**
 * Runs Flutter workspaces in the iOS Simulator (macOS + Xcode only).
 *
 * One `flutter run -d <udid>` process is kept alive per workspace. When agents
 * (or you) change Dart files, Luma sends "r" for a hot reload, so the app on
 * the simulator updates in about a second. The UI shows the simulator screen by
 * polling `xcrun simctl io <udid> screenshot`.
 */

const exec = promisify(execFile);

export type SimState = "idle" | "preparing" | "building" | "running" | "reloading" | "error" | "stopped";

export interface SimDevice {
  udid: string;
  name: string;
  runtime: string;
  state: string;
}

interface Session {
  workspaceId: string;
  udid: string;
  state: SimState;
  message: string;
  log: string[];
  proc: ChildProcessWithoutNullStreams | null;
  ticketId: string | null;
  unsubscribe: () => void;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  needsRestart: boolean;
  startedAt: number;
}

const g = globalThis as unknown as { __lumaSims?: Map<string, Session> };
const sessions: Map<string, Session> = (g.__lumaSims ??= new Map());

export const isMac = process.platform === "darwin";

/** Shells started from Finder/Dock may lack these, so add the usual install locations. */
function toolEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extra = [
    path.join(home, "development", "flutter", "bin"),
    path.join(home, "fvm", "default", "bin"),
    path.join(home, "flutter", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ""].join(":") };
}

const flutterCmd = () => process.env.LUMA_FLUTTER || "flutter";

export async function isFlutterWorkspace(ws: Workspace) {
  if (ws.platform === "flutter") return true;
  try {
    await fs.access(path.join(workspaceRoot(ws.id), "pubspec.yaml"));
    return true;
  } catch {
    return false;
  }
}

export async function checkTools(): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (!isMac) return { ok: false, problems: ["The iOS Simulator only runs on a Mac. Run Luma on your Mac to use it."] };
  try {
    await exec("xcrun", ["simctl", "help"], { env: toolEnv(), timeout: 20_000 });
  } catch {
    problems.push("Xcode isn't set up. Install Xcode from the App Store, open it once, then run: sudo xcode-select -s /Applications/Xcode.app");
  }
  try {
    await exec(flutterCmd(), ["--version"], { env: toolEnv(), timeout: 60_000 });
  } catch {
    problems.push("Flutter wasn't found. Make sure `flutter --version` works in Terminal, or start Luma with LUMA_FLUTTER=/path/to/flutter.");
  }
  return { ok: problems.length === 0, problems };
}

export async function listDevices(): Promise<SimDevice[]> {
  if (!isMac) return [];
  const { stdout } = await exec("xcrun", ["simctl", "list", "devices", "available", "--json"], { env: toolEnv(), maxBuffer: 10_000_000 });
  const data = JSON.parse(stdout) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
  const out: SimDevice[] = [];
  for (const [runtimeId, devices] of Object.entries(data.devices)) {
    if (!/iOS/i.test(runtimeId)) continue;
    const runtime = runtimeId.replace(/^.*SimRuntime\./, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1");
    for (const d of devices) out.push({ udid: d.udid, name: d.name, runtime, state: d.state });
  }
  // Newest runtime first, iPhones before iPads.
  return out.sort(
    (a, b) =>
      b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) ||
      Number(/iPad/.test(a.name)) - Number(/iPad/.test(b.name)) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

export async function pickDevice(preferred?: string) {
  const devices = await listDevices();
  if (preferred && devices.some((d) => d.udid === preferred)) return preferred;
  const booted = devices.find((d) => d.state === "Booted" && /iPhone/.test(d.name));
  return (booted ?? devices.find((d) => /iPhone/.test(d.name)) ?? devices[0])?.udid ?? null;
}

export function getStatus(workspaceId: string) {
  const s = sessions.get(workspaceId);
  if (!s) return { state: "idle" as SimState, message: "", udid: null, log: [] as string[] };
  return { state: s.state, message: s.message, udid: s.udid, log: s.log.slice(-200) };
}

function pushLog(s: Session, chunk: string) {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.trim()) continue;
    s.log.push(line);
  }
  if (s.log.length > 1000) s.log.splice(0, s.log.length - 1000);
}

function setState(s: Session, state: SimState, message = "") {
  s.state = state;
  s.message = message;
}

async function bootDevice(udid: string) {
  try {
    await exec("xcrun", ["simctl", "boot", udid], { env: toolEnv() });
  } catch (err) {
    if (!/current state: Booted|Unable to boot device in current state: Booted/i.test(String((err as Error).message))) throw err;
  }
  await exec("xcrun", ["simctl", "bootstatus", udid, "-b"], { env: toolEnv(), timeout: 180_000 }).catch(() => undefined);
}

/** Generates the ios/ folder (Xcode project) the first time a Flutter workspace runs. */
async function ensureIosProject(root: string, s: Session) {
  try {
    await fs.access(path.join(root, "ios", "Runner.xcodeproj"));
    return;
  } catch {}
  setState(s, "preparing", "Creating the iOS project (first run only)…");
  const { stdout, stderr } = await exec(
    flutterCmd(),
    ["create", "--platforms=ios", "--org", "com.lumaai", "--project-name", "app", "."],
    { cwd: root, env: toolEnv(), timeout: 300_000, maxBuffer: 20_000_000 },
  );
  pushLog(s, stdout + stderr);
}

/** Start (or restart) the app on the simulator. */
export async function startApp(workspaceId: string, opts: { udid?: string; ticketId?: string | null } = {}) {
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  if (!ws) throw new Error("Workspace not found");
  if (!(await isFlutterWorkspace(ws))) throw new Error("This workspace isn't a Flutter app (no pubspec.yaml).");
  const tools = await checkTools();
  if (!tools.ok) throw new Error(tools.problems.join("\n"));
  const udid = await pickDevice(opts.udid ?? ws.simulatorUdid);
  if (!udid) throw new Error("No iOS simulators found. In Xcode open Settings → Platforms (Components) and install an iOS simulator.");

  await stopApp(workspaceId);
  const root = workspaceRoot(workspaceId);
  const s: Session = {
    workspaceId,
    udid,
    state: "preparing",
    message: "Starting the simulator…",
    log: [],
    proc: null,
    ticketId: opts.ticketId ?? null,
    unsubscribe: () => {},
    reloadTimer: null,
    needsRestart: false,
    startedAt: Date.now(),
  };
  sessions.set(workspaceId, s);

  // Hot reload whenever code changes; restart when packages change.
  s.unsubscribe = subscribe(workspaceId, (e) => {
    if (e.kind !== "files_changed") return;
    if (e.paths.some((p) => p === "pubspec.yaml")) s.needsRestart = true;
    if (!e.paths.some((p) => p.endsWith(".dart") || p === "pubspec.yaml" || p.startsWith("assets/"))) return;
    scheduleReload(s);
  });

  void (async () => {
    try {
      await bootDevice(udid);
      await ensureIosProject(root, s);
      setState(s, "building", "Building the app… the first build can take a few minutes.");
      const proc = spawn(flutterCmd(), ["run", "-d", udid, "--debug"], { cwd: root, env: toolEnv() });
      s.proc = proc;
      let errorTail: string[] = [];
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        pushLog(s, text);
        if (/Error:|error:|Could not build|Failed to build/i.test(text)) errorTail = s.log.slice(-40);
        if (/Flutter run key commands|Syncing files to device/i.test(text) && s.state === "building") setState(s, "running", "Running");
        if (/Reloaded \d+ of|Hot reload performed|Restarted application/i.test(text)) setState(s, "running", "Up to date");
        if (/Hot reload was rejected|Try performing a hot restart|compilation error/i.test(text)) {
          setState(s, "error", "The latest code has errors. See the log.");
          void reportBuildError(s, s.log.slice(-40));
        }
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("exit", (code) => {
        if (sessions.get(workspaceId) !== s || s.proc !== proc) return;
        s.proc = null;
        if (s.state === "stopped") return;
        if (code === 0) setState(s, "stopped", "The app stopped.");
        else {
          setState(s, "error", "The app failed to build or crashed. See the log.");
          void reportBuildError(s, errorTail.length ? errorTail : s.log.slice(-40));
        }
      });
    } catch (err) {
      setState(s, "error", err instanceof Error ? err.message : String(err));
      pushLog(s, String((err as Error)?.message ?? err));
    }
  })();

  return getStatus(workspaceId);
}

function scheduleReload(s: Session) {
  if (s.reloadTimer) clearTimeout(s.reloadTimer);
  s.reloadTimer = setTimeout(() => {
    s.reloadTimer = null;
    if (s.needsRestart) {
      s.needsRestart = false;
      void startApp(s.workspaceId, { udid: s.udid, ticketId: s.ticketId }).catch(() => undefined);
      return;
    }
    hotReload(s.workspaceId, false);
  }, 1200);
}

/** "r" = hot reload (keeps state), "R" = hot restart. */
export function hotReload(workspaceId: string, restart: boolean) {
  const s = sessions.get(workspaceId);
  if (!s?.proc) return false;
  setState(s, "reloading", restart ? "Restarting the app…" : "Applying changes…");
  s.proc.stdin.write(restart ? "R" : "r");
  return true;
}

export async function stopApp(workspaceId: string) {
  const s = sessions.get(workspaceId);
  if (!s) return;
  setState(s, "stopped", "Stopped");
  s.unsubscribe();
  if (s.reloadTimer) clearTimeout(s.reloadTimer);
  const proc = s.proc;
  s.proc = null;
  if (proc) {
    try {
      proc.stdin.write("q");
    } catch {}
    setTimeout(() => proc.kill("SIGTERM"), 3000);
  }
}

export async function screenshot(workspaceId: string, udidIn?: string): Promise<Buffer | null> {
  if (!isMac) return null;
  const udid = sessions.get(workspaceId)?.udid ?? udidIn;
  if (!udid) return null;
  const file = path.join(os.tmpdir(), `luma-sim-${udid}.jpg`);
  try {
    await exec("xcrun", ["simctl", "io", udid, "screenshot", "--type=jpeg", file], { env: toolEnv(), timeout: 10_000 });
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

export async function openSimulatorWindow(udid: string) {
  await exec("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid], { env: toolEnv() });
}

/** Called after an agent finishes a ticket: run the app, or hot-reload it if it's already running. */
export async function onAgentFinished(workspaceId: string, ticketId: string) {
  if (!isMac) return;
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  if (!ws || ws.autoRunSimulator === false || !(await isFlutterWorkspace(ws))) return;
  const s = sessions.get(workspaceId);
  if (s?.proc) {
    s.ticketId = ticketId;
    if (!s.reloadTimer) hotReload(workspaceId, false);
    return;
  }
  await startApp(workspaceId, { ticketId }).catch(() => undefined);
}

async function reportBuildError(s: Session, lines: string[]) {
  if (!s.ticketId) return;
  const { addEvent } = await import("./repo");
  await addEvent(
    s.ticketId,
    "system",
    "error",
    `The app didn't build on the iOS Simulator. Run the agent again to fix it:\n\n${lines.slice(-25).join("\n")}`,
  ).catch(() => undefined);
}
