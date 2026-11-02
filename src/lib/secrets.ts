import "server-only";
import { mutate, newId, now, read } from "./store";
import { decrypt, encrypt } from "./crypto";

/**
 * Workspace secrets (Phase 5): encrypted environment variables for the app being built
 * (API keys, database URLs…). Agents only ever see the NAMES. Values are injected into
 * sandboxed commands as env vars and into Flutter web builds as --dart-define, and are
 * redacted from command output and file reads before any agent or the UI sees them.
 */

export const NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;
const RESERVED = /^(PATH|HOME|SHELL|USER|NODE_OPTIONS|LD_PRELOAD|DYLD_.*|LUMA_.*|ANTHROPIC_.*|CLAUDE_.*|GIT_.*)$/;
const MAX_SECRETS = 50;

export async function listSecrets(workspaceId: string) {
  const db = await read();
  return db.secrets
    .filter((s) => s.workspaceId === workspaceId)
    .map(({ name, hint, updatedAt }) => ({ name, hint, updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function secretNames(workspaceId: string) {
  return (await listSecrets(workspaceId)).map((s) => s.name);
}

export async function setSecret(workspaceId: string, nameIn: string, value: string) {
  const name = nameIn.trim().toUpperCase();
  if (!NAME_RE.test(name)) throw new Error("Use a name like STRIPE_KEY: capital letters, numbers and _ only, not starting with a number.");
  if (RESERVED.test(name)) throw new Error(`${name} is reserved by the system. Pick another name.`);
  if (!value) throw new Error("Enter a value.");
  if (value.length > 10_000) throw new Error("That value is too long (max 10,000 characters).");
  const enc = await encrypt(value);
  const hint = value.length >= 8 ? `…${value.slice(-4)}` : "…";
  await mutate((db) => {
    const ex = db.secrets.find((s) => s.workspaceId === workspaceId && s.name === name);
    if (ex) Object.assign(ex, { value: enc, hint, updatedAt: now() });
    else {
      if (db.secrets.filter((s) => s.workspaceId === workspaceId).length >= MAX_SECRETS) throw new Error(`A workspace can have up to ${MAX_SECRETS} secrets.`);
      db.secrets.push({ id: newId("sec"), workspaceId, name, value: enc, hint, updatedAt: now() });
    }
  });
  return { name, hint };
}

export async function deleteSecret(workspaceId: string, name: string) {
  await mutate((db) => {
    db.secrets = db.secrets.filter((s) => !(s.workspaceId === workspaceId && s.name === name));
  });
}

/** Decrypted name → value map. Server-side only; never send to agents or the browser. */
export async function secretEnv(workspaceId: string): Promise<Record<string, string>> {
  const db = await read();
  const out: Record<string, string> = {};
  for (const s of db.secrets.filter((x) => x.workspaceId === workspaceId)) {
    try {
      out[s.name] = await decrypt(s.value);
    } catch {
      // Encrypted with a different LUMA_SECRET: skip it rather than leak garbage.
    }
  }
  return out;
}

/** Replace any secret value in `text` with a placeholder. */
export function redact(text: string, env: Record<string, string>) {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value.length < 4) continue;
    out = out.split(value).join(`[secret ${name}]`);
  }
  return out;
}

export async function redactFor(workspaceId: string, text: string) {
  const env = await secretEnv(workspaceId);
  return Object.keys(env).length ? redact(text, env) : text;
}
