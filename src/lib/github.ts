import "server-only";
import { read } from "./store";
import { decrypt } from "./crypto";

/**
 * GitHub without the terminal (Phase 7): a personal access token saved in Settings →
 * Integrations is used for git push/pull/fetch over HTTPS and for the GitHub REST API
 * (create repo, pull requests, Pages). Falls back to your own git credentials / `gh`
 * login when no token is saved.
 */

const API = () => process.env.LUMA_GITHUB_API || "https://api.github.com";

export async function githubToken(): Promise<string | null> {
  const enc = (await read()).settings.githubToken;
  if (!enc) return null;
  return decrypt(enc).catch(() => null);
}

export async function verifyGithubToken(token: string) {
  const res = await fetch(`${API()}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub rejected this token (${res.status}). Check it hasn't expired and has the “repo” scope (or Contents + Pull requests + Pages + Administration for fine-grained tokens).`);
  const u = (await res.json()) as { login: string };
  return u.login;
}

export async function gh<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; data: T }> {
  const token = await githubToken();
  if (!token) throw new Error("Connect GitHub in Settings → Integrations first.");
  const res = await fetch(`${API()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.json ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T;
  if (!res.ok && res.status !== 404 && res.status !== 409 && res.status !== 422) {
    throw new Error(`GitHub ${res.status}: ${(data as { message?: string }).message ?? text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

/** git config entries (via GIT_CONFIG_* env) that authenticate HTTPS requests to github.com. */
export async function gitAuthEnv(): Promise<Record<string, string>> {
  const token = await githubToken();
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}

export async function githubConnected() {
  const db = await read();
  return db.settings.githubToken ? db.settings.githubUser ?? "connected" : null;
}
