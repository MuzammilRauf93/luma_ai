import "server-only";
import path from "path";
import { promises as fs } from "fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { DATA_DIR } from "./store";
import type { ClaudeAccount } from "./types";
import type { ModelOption } from "./anthropic";

/**
 * "Use my Claude account" mode: agents run through the Claude Agent SDK, which
 * signs in with the Claude (Pro / Max / Team / Enterprise) login stored by
 * Claude Code on this computer, so usage counts against the subscription.
 */

/** Environment for the SDK subprocess: never let an API key override the Claude login. */
export function accountEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "luma-ai/0.1.0";
  return env;
}

/** Working directory for SDK sessions (kept out of the user's projects). */
export async function sdkCwd() {
  const dir = path.join(DATA_DIR, "sdk");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export const LOGIN_HELP =
  "Luma couldn't find a Claude login on this computer. In Terminal, run `npx @anthropic-ai/claude-code` (or `claude` if it's installed), type /login, choose your Claude account, then come back and try again.";

/** Ask the SDK which account it is signed in with, without sending any prompt. */
export async function inspectAccount(): Promise<{ account: ClaudeAccount; models: ModelOption[] }> {
  let release: () => void = () => {};
  const idle = new Promise<void>((r) => (release = r));
  async function* never() {
    await idle; // keep the session open with no messages until we close it
  }
  const ctrl = new AbortController();
  const q = query({
    prompt: never(),
    options: {
      tools: [],
      settingSources: [],
      persistSession: false,
      abortController: ctrl,
      cwd: await sdkCwd(),
      env: accountEnv(),
    },
  });
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const info = await q.accountInfo();
    if (info.apiProvider && info.apiProvider !== "firstParty") {
      throw new Error(`Your Claude Code is set up for ${info.apiProvider}, not a Claude account. Use the API key option instead.`);
    }
    if (!info.email && !info.subscriptionType && !info.tokenSource) throw new Error(LOGIN_HELP);
    if (info.apiKeySource || !info.subscriptionType || /api/i.test(info.subscriptionType)) {
      throw new Error(
        "Claude Code on this computer is signed in with an API (Console) account, not a Claude plan. In Terminal run `npx @anthropic-ai/claude-code`, type /login, pick “Claude account”, then try again.",
      );
    }
    const models = (await q.supportedModels()).map((m) => ({ id: m.value, name: m.displayName }));
    return {
      account: { email: info.email, organization: info.organization, subscriptionType: info.subscriptionType },
      models,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/credential|token|abort|not logged|unauthori/i.test(msg) && !msg.startsWith("Claude Code on this") && msg !== LOGIN_HELP) throw new Error(`${LOGIN_HELP}\n\n(Details: ${msg})`);
    throw err;
  } finally {
    clearTimeout(timeout);
    release();
    try {
      q.close();
    } catch {}
  }
}
