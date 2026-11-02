import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { read } from "./store";
import { decrypt } from "./crypto";

export async function getApiKey(): Promise<string | null> {
  const db = await read();
  if (!db.settings.encryptedApiKey) return null;
  try {
    return await decrypt(db.settings.encryptedApiKey);
  } catch {
    // Saved on another machine/process with a different encryption secret.
    throw new Error(
      "This Luma server can't unlock the saved API key. When Luma runs on more than one machine or process (Postgres + workers), set the same LUMA_SECRET on every one of them, then reconnect in Settings.",
    );
  }
}

export async function getClient(apiKey?: string) {
  const key = apiKey ?? (await getApiKey());
  if (!key) throw new Error("No Claude account connected. Add your API key in Settings.");
  return new Anthropic({ apiKey: key, maxRetries: 3 });
}

export interface ModelOption {
  id: string;
  name: string;
}

export async function listModels(apiKey?: string): Promise<ModelOption[]> {
  if (!apiKey) {
    const db = await read();
    if (db.settings.authMode === "claude_account") {
      const { inspectAccount } = await import("./claudeAccount");
      return (await inspectAccount()).models;
    }
  }
  const client = await getClient(apiKey);
  const out: ModelOption[] = [];
  for await (const m of client.models.list({ limit: 100 })) out.push({ id: m.id, name: m.display_name });
  return out;
}

/** Pick a sensible default: the newest Sonnet-class model, else the first listed. */
export function pickDefaultModel(models: ModelOption[]) {
  return (models.find((m) => /sonnet/i.test(m.id) || /sonnet/i.test(m.name)) ?? models[0])?.id ?? "";
}

/**
 * Rough USD price per million tokens by model family. Used only for the
 * "estimated cost" shown in the usage panel. Update to match current pricing.
 */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /opus/i, input: 5, output: 25 },
  { match: /sonnet/i, input: 3, output: 15 },
  { match: /haiku/i, input: 1, output: 5 },
];

export function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const p = PRICES.find((x) => x.match.test(model)) ?? PRICES[1];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
