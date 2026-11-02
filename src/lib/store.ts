import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { DB } from "./types";

/**
 * Luma's database. All access goes through `read()` / `mutate()`; the rest of the app never
 * knows which driver is underneath.
 *
 * - JSON file (default): `.luma/data.json`, one process.
 * - Postgres (Phase 5): set LUMA_DATABASE_URL. Every process keeps the whole DB in memory and
 *   writes through: each `mutate()` takes a Postgres advisory lock, catches up on other
 *   processes' changes, runs, then upserts only the records that changed and NOTIFYs the
 *   others. That's what lets a web process and background workers share one database.
 *   See storePg.ts.
 */

export const DATA_DIR = path.resolve(process.env.LUMA_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".luma"));
export const DB_FILE = path.join(DATA_DIR, "data.json");

export const EMPTY: DB = {
  version: 1,
  settings: {},
  workspaces: [],
  agents: [],
  tickets: [],
  events: [],
  checkpoints: [],
  usage: [],
  library: [],
  memories: [],
  commandRuns: [],
  deploys: [],
  secrets: [],
  runs: [],
  users: [],
  sessions: [],
  invites: [],
};

export interface Driver {
  name: "json" | "postgres";
  load(): Promise<DB>;
  /** Run `fn` against the live DB atomically and persist what it changed. */
  transact<T>(db: DB, fn: (db: DB) => T | Promise<T>): Promise<T>;
  /** Pull other processes' changes into `db` (no-op for JSON). */
  sync?(db: DB): Promise<void>;
}

// ---------------------------------------------------------------- JSON driver

export function withDefaults(raw: Partial<DB>): DB {
  return { ...structuredClone(EMPTY), ...raw } as DB;
}

const jsonDriver: Driver = {
  name: "json",
  async load() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      return withDefaults(JSON.parse(await fs.readFile(DB_FILE, "utf8")));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return structuredClone(EMPTY);
    }
  },
  async transact(db, fn) {
    const result = await fn(db);
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, DB_FILE);
    return result;
  },
};

// ---------------------------------------------------------------- state

type StoreState = { db: DB | null; queue: Promise<unknown>; driver: Promise<Driver> | null; listeners: (() => void)[] };
const g = globalThis as unknown as { __lumaStore?: StoreState };
const state: StoreState = (g.__lumaStore ??= { db: null, queue: Promise.resolve(), driver: null, listeners: [] });

/** Called after this process catches up on another process's changes (Postgres only). */
export function onRemoteChange(fn: () => void) {
  state.listeners.push(fn);
}

export function usingPostgres() {
  return Boolean(process.env.LUMA_DATABASE_URL);
}

function driver(): Promise<Driver> {
  return (state.driver ??= usingPostgres()
    ? import("./storePg").then((m) => m.createPgDriver(process.env.LUMA_DATABASE_URL!, {
        onRemoteChange: () => enqueueSync(),
      }))
    : Promise.resolve(jsonDriver));
}

async function load(): Promise<DB> {
  if (state.db) return state.db;
  state.db = await (await driver()).load();
  return state.db;
}

/** Catch up on changes another process made (Postgres only), in order with local writes. */
function enqueueSync() {
  const run = state.queue.then(async () => {
    const d = await driver();
    if (d.sync && state.db) await d.sync(state.db);
    for (const fn of state.listeners) fn();
  });
  state.queue = run.catch((err) => {
    console.error("[luma store] sync failed, reloading:", err);
    state.db = null;
  });
}

/** Read-only snapshot. Do not mutate the returned object. */
export async function read(): Promise<DB> {
  await state.queue;
  return load();
}

/** The cached DB without waiting (null before first load). For hot, synchronous checks only. */
export function peek(): DB | null {
  return state.db;
}

/** Serialized read-modify-write. The callback may mutate `db` in place. */
export function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = state.queue.then(async () => {
    const db = await load();
    const d = await driver();
    try {
      return await d.transact(db, fn);
    } catch (err) {
      if (d.name === "postgres") state.db = null; // rolled back: reload a clean copy next time
      throw err;
    }
  });
  state.queue = run.catch(() => undefined);
  return run;
}

/** The active driver (for Postgres-only extras such as cross-process live events). */
export function getDriver() {
  return driver();
}

/** Make sure the driver is connected (used at server start). */
export async function initStore() {
  const d = await driver();
  await load();
  return d.name;
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

export function now() {
  return new Date().toISOString();
}
