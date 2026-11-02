import "server-only";
import { AsyncLocalStorage } from "async_hooks";
import crypto from "crypto";
import { promisify } from "util";
import { mutate, newId, now, read } from "./store";
import type { DB, User, WorkspaceRole } from "./types";

/**
 * Multi-user & sharing (Phase 5).
 *
 * Single-user mode until the first account is created (Settings → Team → Turn on sign-in):
 * then every API route needs a session cookie. Admins manage Luma and see every workspace;
 * members see workspaces they belong to, as owner / editor / viewer.
 * Authorisation happens centrally in `handle()` (lib/http.ts) from the request path.
 */

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "luma_session";
const SESSION_DAYS = 30;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- passwords & tokens

export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"), 32);
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const newToken = () => crypto.randomBytes(32).toString("base64url");

export function checkPassword(pw: string) {
  if (pw.length < 8) throw new HttpError(400, "Use a password with at least 8 characters.");
}

export function normEmail(e: string) {
  const email = e.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
  return email;
}

// ---------------------------------------------------------------- sessions

export async function createSession(userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await mutate((db) => {
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt) > new Date());
    db.sessions.push({ id: sha256(token), userId, createdAt: now(), expiresAt: expires.toISOString() });
  });
  return { token, expires };
}

export function sessionCookie(token: string, expires: Date, secure: boolean) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function tokenFrom(req: Request) {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}

export function userForRequest(db: DB, req: Request): User | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const s = db.sessions.find((x) => x.id === sha256(token));
  if (!s || new Date(s.expiresAt) < new Date()) return null;
  return db.users.find((u) => u.id === s.userId) ?? null;
}

export async function endSession(req: Request) {
  const token = tokenFrom(req);
  if (!token) return;
  await mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.id !== sha256(token));
  });
}

// ---------------------------------------------------------------- request context

type Ctx = { user: User | null; authEnabled: boolean };
const als = new AsyncLocalStorage<Ctx>();

export function currentUser() {
  return als.getStore()?.user ?? null;
}

export function runWithUser<T>(ctx: Ctx, fn: () => T) {
  return als.run(ctx, fn);
}

// ---------------------------------------------------------------- roles

const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function workspaceRole(db: DB, user: User | null, workspaceId: string): WorkspaceRole | null {
  if (!db.users.length) return "owner"; // single-user mode
  if (!user) return null;
  if (user.role === "admin") return "owner";
  const ws = db.workspaces.find((w) => w.id === workspaceId);
  return ws?.members?.find((m) => m.userId === user.id)?.role ?? null;
}

export function canSee(db: DB, user: User | null, workspaceId: string) {
  return workspaceRole(db, user, workspaceId) !== null;
}

/** Which workspace a request path belongs to (null = not workspace-scoped). */
export function workspaceForPath(db: DB, pathname: string): string | null | undefined {
  const seg = pathname.split("/").filter(Boolean);
  const [a, b, c] = seg;
  if (a === "preview") return b;
  if (a !== "api") return null;
  const find = <T extends { id: string; workspaceId: string }>(list: T[], id?: string) => (id ? list.find((x) => x.id === id)?.workspaceId : undefined);
  switch (b) {
    case "workspaces":
      return c ?? null;
    case "tickets":
      return find(db.tickets, c);
    case "agents":
      return c === "draft" ? null : find(db.agents, c);
    case "memory":
      return c === "merge" ? null : find(db.memories, c);
    case "commands":
      return find(db.commandRuns, c);
    case "deploys":
      return find(db.deploys, c);
    default:
      return null;
  }
}

const PUBLIC = /^\/api\/auth\//;
const ADMIN_ONLY: { re: RegExp; methods: string[] }[] = [
  { re: /^\/api\/settings$/, methods: ["POST", "PUT", "PATCH", "DELETE"] },
  { re: /^\/api\/usage$/, methods: ["GET"] },
  { re: /^\/api\/users(\/|$)/, methods: ["GET", "POST", "PATCH", "DELETE"] },
];

/**
 * Check the request against sign-in and workspace roles. Returns the context to run the
 * handler with, or throws HttpError(401/403/404).
 */
export async function authorize(req: Request): Promise<Ctx> {
  const db = await read();
  const authEnabled = db.users.length > 0;
  if (!authEnabled) return { user: null, authEnabled };
  const url = new URL(req.url);
  const user = userForRequest(db, req);
  if (PUBLIC.test(url.pathname)) return { user, authEnabled };
  if (!user) throw new HttpError(401, "Please sign in.");

  for (const rule of ADMIN_ONLY)
    if (rule.re.test(url.pathname) && rule.methods.includes(req.method) && user.role !== "admin")
      throw new HttpError(403, "Only a Luma admin can do that.");

  const wsId = workspaceForPath(db, url.pathname);
  if (wsId === undefined) throw new HttpError(404, "Not found");
  if (wsId) {
    const role = workspaceRole(db, user, wsId);
    if (!role) throw new HttpError(404, "Workspace not found");
    const read = req.method === "GET" || req.method === "HEAD";
    const ownerOnly =
      (url.pathname === `/api/workspaces/${wsId}` && req.method === "DELETE") ||
      (url.pathname.startsWith(`/api/workspaces/${wsId}/members`) && !read);
    const need: WorkspaceRole = ownerOnly ? "owner" : read ? "viewer" : "editor";
    if (RANK[role] < RANK[need])
      throw new HttpError(403, need === "owner" ? "Only the workspace owner can do that." : "You have view-only access to this workspace.");
  }
  // Touch lastSeenAt at most every 10 minutes.
  if (!user.lastSeenAt || Date.now() - new Date(user.lastSeenAt).getTime() > 600_000) {
    void mutate((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (u) u.lastSeenAt = now();
    }).catch(() => undefined);
  }
  return { user, authEnabled };
}

/** For routes that decide the workspace from the body (e.g. memory merge). */
export async function requireWorkspaceRole(workspaceId: string, need: WorkspaceRole) {
  const db = await read();
  const role = workspaceRole(db, currentUser(), workspaceId);
  if (!role) throw new HttpError(404, "Workspace not found");
  if (RANK[role] < RANK[need]) throw new HttpError(403, "You don't have permission to do that here.");
}

/** Public view of a user (never the password hash). */
export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt });

export async function createUser(input: { email: string; name: string; password: string; role: "admin" | "member" }) {
  const email = normEmail(input.email);
  checkPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  return mutate((db) => {
    if (db.users.some((u) => u.email === email)) throw new HttpError(400, "There's already an account with that email. Sign in instead.");
    const user: User = { id: newId("usr"), email, name: input.name.trim().slice(0, 60) || email.split("@")[0], passwordHash, role: input.role, createdAt: now() };
    db.users.push(user);
    return user;
  });
}

// Simple in-memory brute-force protection for sign-in.
const attempts = new Map<string, number[]>();
export function rateLimit(key: string) {
  const t = Date.now();
  const list = (attempts.get(key) ?? []).filter((x) => t - x < 10 * 60_000);
  if (list.length >= 10) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
  list.push(t);
  attempts.set(key, list);
}
