import "server-only";
import { createRequire } from "module";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { DB_FILE, EMPTY, withDefaults, type Driver } from "./store";
import type { DB } from "./types";

/**
 * Postgres driver (Phase 5). Records are stored as JSONB documents:
 *
 *   luma_docs(collection, id, data jsonb, version, seq)  — seq keeps insertion order
 *   luma_changes(version, collection, id, deleted, at)    — change log for catching up
 *   luma_meta(key='version', value)                       — global version counter
 *
 * Each process holds the DB in memory. A write = BEGIN → advisory lock → catch up from
 * luma_changes → run the mutation → diff against what's stored → upsert/delete changed
 * records → bump version → COMMIT → NOTIFY luma_changed. Other processes LISTEN and catch up.
 * Live UI events cross processes on the luma_live channel (see bus.ts).
 *
 * Needs the `pg` package (`npm install pg`). Loaded at runtime so the JSON-only setup has no
 * extra dependency.
 */

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release?: () => void;
  on: (ev: string, fn: (msg: { channel: string; payload?: string }) => void) => void;
  connect?: () => Promise<void>;
};
type PgPool = { connect: () => Promise<PgClient>; query: PgClient["query"]; on: (ev: string, fn: (err: Error) => void) => void };

const LOCK_KEY = 74_201_337;
export const ORIGIN = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

const SCHEMA = `
create table if not exists luma_docs (
  collection text not null, id text not null, data jsonb not null,
  version bigint not null, seq bigserial, primary key (collection, id));
create table if not exists luma_changes (
  version bigint not null, collection text not null, id text not null,
  deleted boolean not null default false, at timestamptz not null default now());
create index if not exists luma_changes_version on luma_changes (version);
create table if not exists luma_meta (key text primary key, value bigint not null);
insert into luma_meta (key, value) values ('version', 0) on conflict do nothing;`;

function loadPg(): { Pool: new (cfg: Record<string, unknown>) => PgPool; Client: new (cfg: Record<string, unknown>) => PgClient } {
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    return req("pg");
  } catch {
    throw new Error("LUMA_DATABASE_URL is set but the `pg` package isn't installed. Install it in Settings → System (or run npm install).");
  }
}

type Snap = Map<string, Map<string, string>>;

const collections = (db: DB) => Object.keys(EMPTY).filter((k) => Array.isArray((EMPTY as unknown as Record<string, unknown>)[k])) as (keyof DB)[];

function snapshot(db: DB): Snap {
  const s: Snap = new Map();
  s.set("settings", new Map([["settings", JSON.stringify(db.settings)]]));
  for (const c of collections(db)) {
    const m = new Map<string, string>();
    for (const rec of db[c] as unknown as { id: string }[]) m.set(rec.id, JSON.stringify(rec));
    s.set(c, m);
  }
  return s;
}

export type PgExtras = {
  notifyLive: (payload: string) => Promise<void>;
  onLive: (fn: (payload: string) => void) => void;
  /** Raw query on the shared pool (used by the file mirror). */
  query: PgPool["query"];
  /** Subscribe to another NOTIFY channel. */
  listen: (channel: string, fn: (payload: string) => void) => Promise<void>;
};

export async function createPgDriver(url: string, hooks: { onRemoteChange: () => void }): Promise<Driver & PgExtras> {
  const { Pool, Client } = loadPg();
  const pool = new Pool({ connectionString: url, max: 5 });
  pool.on("error", (err) => console.error("[luma pg] pool error:", err.message));
  await pool.query(SCHEMA);

  let version = 0;
  let snap: Snap = new Map();
  const liveHandlers: ((p: string) => void)[] = [];
  const channelHandlers = new Map<string, ((p: string) => void)[]>();

  // Listener connection for cross-process notifications.
  const listener = new Client({ connectionString: url });
  await listener.connect!();
  listener.on("notification", (msg) => {
    if (!msg.payload) return;
    if (msg.channel === "luma_changed") {
      const { origin, v } = JSON.parse(msg.payload) as { origin: string; v: number };
      if (origin !== ORIGIN && v > version) hooks.onRemoteChange();
    } else if (msg.channel === "luma_live") {
      for (const fn of liveHandlers) fn(msg.payload);
    } else {
      for (const fn of channelHandlers.get(msg.channel) ?? []) fn(msg.payload);
    }
  });
  await listener.query("listen luma_changed");
  await listener.query("listen luma_live");

  async function fullLoad(client: PgClient | PgPool = pool): Promise<DB> {
    const meta = await client.query("select value from luma_meta where key = 'version'");
    const rows = (await client.query("select collection, data from luma_docs order by seq")).rows;
    if (!rows.length) {
      // First start on Postgres: import the JSON database if there is one.
      try {
        const raw = withDefaults(JSON.parse(await fs.readFile(DB_FILE, "utf8")));
        const c = await pool.connect();
        try {
          await c.query("begin");
          await c.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
          const again = await c.query("select 1 from luma_docs limit 1");
          if (!again.rows.length) {
            console.log("[luma pg] importing", DB_FILE, "into Postgres…");
            snap = new Map();
            await write(c, raw, true);
            await c.query("commit");
            return raw;
          }
          await c.query("rollback");
        } finally {
          c.release?.();
        }
        return fullLoad(client);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    const db = structuredClone(EMPTY) as DB;
    for (const r of rows) {
      const c = r.collection as string;
      if (c === "settings") db.settings = r.data as DB["settings"];
      else if (Array.isArray((db as unknown as Record<string, unknown>)[c])) ((db as unknown as Record<string, unknown[]>)[c]).push(r.data);
    }
    version = Number(meta.rows[0]?.value ?? 0);
    snap = snapshot(db);
    return db;
  }

  /** Apply other processes' changes since `version` to `db` (in place). */
  async function catchUp(client: PgClient | PgPool, db: DB) {
    const cur = Number((await client.query("select value from luma_meta where key = 'version'")).rows[0]?.value ?? 0);
    if (cur <= version) return;
    const min = Number((await client.query("select coalesce(min(version), 0) as v from luma_changes")).rows[0]?.v ?? 0);
    if (min > version + 1) {
      // Our cache is older than the change log: reload everything.
      const fresh = await fullLoad(client);
      Object.assign(db, fresh);
      return;
    }
    const { rows } = await client.query(
      `select distinct on (c.collection, c.id) c.collection, c.id, c.deleted, d.data, d.seq
         from luma_changes c left join luma_docs d on d.collection = c.collection and d.id = c.id
        where c.version > $1 order by c.collection, c.id, c.version desc`,
      [version],
    );
    rows.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    for (const r of rows) {
      const c = r.collection as string;
      const id = r.id as string;
      if (c === "settings") {
        if (r.data) db.settings = r.data as DB["settings"];
        snap.get("settings")?.set("settings", JSON.stringify(db.settings));
        continue;
      }
      const arr = (db as unknown as Record<string, { id: string }[]>)[c];
      if (!arr) continue;
      const i = arr.findIndex((x) => x.id === id);
      const m = snap.get(c) ?? new Map<string, string>();
      snap.set(c, m);
      if (r.deleted || !r.data) {
        if (i >= 0) arr.splice(i, 1);
        m.delete(id);
      } else {
        if (i >= 0) arr[i] = r.data as { id: string };
        else arr.push(r.data as { id: string });
        m.set(id, JSON.stringify(r.data));
      }
    }
    version = cur;
  }

  /** Diff `db` against the snapshot and write changed records. Caller holds the lock. */
  async function write(client: PgClient, db: DB, importing = false) {
    const next = snapshot(db);
    const cs: string[] = [];
    const ids: string[] = [];
    const datas: string[] = [];
    const delC: string[] = [];
    const delI: string[] = [];
    for (const [c, m] of next) {
      const old = snap.get(c) ?? new Map();
      for (const [id, s] of m) if (old.get(id) !== s) (cs.push(c), ids.push(id), datas.push(s));
      for (const id of old.keys()) if (!m.has(id)) (delC.push(c), delI.push(id));
    }
    if (!cs.length && !delC.length) return;
    const v = Number((await client.query("update luma_meta set value = value + 1 where key = 'version' returning value")).rows[0].value);
    if (cs.length) {
      await client.query(
        `insert into luma_docs (collection, id, data, version)
         select c, i, d::jsonb, $4 from unnest($1::text[], $2::text[], $3::text[]) as t(c, i, d)
         on conflict (collection, id) do update set data = excluded.data, version = excluded.version`,
        [cs, ids, datas, v],
      );
      if (!importing) await client.query(`insert into luma_changes (version, collection, id) select $3, c, i from unnest($1::text[], $2::text[]) as t(c, i)`, [cs, ids, v]);
    }
    if (delC.length) {
      await client.query(`delete from luma_docs d using unnest($1::text[], $2::text[]) as t(c, i) where d.collection = t.c and d.id = t.i`, [delC, delI]);
      await client.query(`insert into luma_changes (version, collection, id, deleted) select $3, c, i, true from unnest($1::text[], $2::text[]) as t(c, i)`, [delC, delI, v]);
    }
    if (Math.random() < 0.02) await client.query("delete from luma_changes where at < now() - interval '1 hour'");
    version = v;
    snap = next;
    await client.query("select pg_notify('luma_changed', $1)", [JSON.stringify({ origin: ORIGIN, v })]);
  }

  return {
    name: "postgres",
    load: () => fullLoad(),
    async transact(db, fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("select pg_advisory_xact_lock($1)", [LOCK_KEY]);
        await catchUp(client, db);
        const result = await fn(db);
        await write(client, db);
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release?.();
      }
    },
    async sync(db) {
      await catchUp(pool, db);
    },
    async notifyLive(payload) {
      await pool.query("select pg_notify('luma_live', $1)", [payload]);
    },
    onLive(fn) {
      liveHandlers.push(fn);
    },
    query: (text, params) => pool.query(text, params),
    async listen(channel, fn) {
      if (!/^[a-z_]+$/.test(channel)) throw new Error("bad channel");
      const list = channelHandlers.get(channel) ?? [];
      list.push(fn);
      channelHandlers.set(channel, list);
      if (list.length === 1) await listener.query(`listen ${channel}`);
    },
  };
}
