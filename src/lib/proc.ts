import "server-only";
import { spawn, type SpawnOptions } from "child_process";
import os from "os";
import path from "path";

/** Shells started from Finder/Dock may lack these, so add the usual tool install locations. */
export function toolPath() {
  const home = os.homedir();
  return [
    path.join(home, "development", "flutter", "bin"),
    path.join(home, "fvm", "default", "bin"),
    path.join(home, "flutter", "bin"),
    path.join(home, ".pub-cache", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "/usr/bin:/bin",
  ].join(":");
}

/** Environment for child processes: tool PATH, and none of Luma's own secrets. */
export function safeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  const drop = /^(ANTHROPIC_|CLAUDE_|LUMA_SECRET|LUMA_DATA_DIR|AWS_|GITHUB_TOKEN|GH_TOKEN|NETLIFY_|VERCEL_|NPM_TOKEN|OPENAI_)/;
  for (const [k, v] of Object.entries(process.env)) if (!drop.test(k)) env[k] = v;
  return { ...env, PATH: toolPath(), CI: "1", FORCE_COLOR: "0", NO_COLOR: "1", ...extra } as unknown as NodeJS.ProcessEnv;
}

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a program (no shell) and collect its output, with a timeout and an output cap. */
export function runProcess(
  cmd: string,
  args: string[],
  opts: SpawnOptions & { timeoutMs?: number; maxOutput?: number; onData?: (chunk: string) => void; input?: string } = {},
): Promise<ProcResult> {
  const { timeoutMs = 60_000, maxOutput = 200_000, onData, input, ...spawnOpts } = opts;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { env: safeEnv(), ...spawnOpts, shell: false });
    } catch (err) {
      resolve({ code: 127, stdout: "", stderr: String(err), timedOut: false });
      return;
    }
    const cap = (s: string, add: string) => (s.length > maxOutput ? s : (s + add).slice(-maxOutput));
    child.stdout?.on("data", (b: Buffer) => {
      const t = b.toString("utf8");
      stdout = cap(stdout, t);
      onData?.(t);
    });
    child.stderr?.on("data", (b: Buffer) => {
      const t = b.toString("utf8");
      stderr = cap(stderr, t);
      onData?.(t);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr + String(err.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (input !== undefined) child.stdin?.end(input);
    else child.stdin?.end();
  });
}
