import "server-only";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { getDriver, usingPostgres } from "./store";
import type { PgExtras } from "./storePg";

/**
 * Cloud-ready file storage (Phase 6).
 *
 * With Postgres, every workspace file and checkpoint blob is also stored in the database
 * (luma_files / luma_blobs). The folder under .luma/workspaces/<id>/files becomes a local
 * working copy that each process keeps in sync:
 *  - every write/delete through Luma is pushed with a new version number;
 *  - before reading, a process pulls rows newer than the last version it saw
 *    (at most every 2 s, or right away after a NOTIFY luma_files from another host);
 *  - on a fresh host (empty disk) the whole workspace is downloaded on first use;
 *  - workspaces that only exist on disk are uploaded once ("seeding").
 * So the web app and workers can run on different machines, and hosts without a
 * persistent disk (Railway/Render/Fly, or Vercel for the UI with LUMA_DATA_DIR=/tmp/luma)
 * lose nothing. Generated folders (node_modules, build, .dart_tool, .git…) stay local.
 *
 * LUMA_FILES = db (default with Postgres) | disk
 */

const MAX_FILE = 20 * 1024 * 1024;
const PULL_EVERY_MS = 2000;
const ORIGIN = `${os.hostname()}:${process.pid}`;

const SCHEMA = `
create sequence if not exists luma_files_seq;
create table if not exists luma_files (
  workspace_id text not null, path text not null, content bytea, size integer not null default 0,
  deleted boolean not null default false, version bigint not null, updated_at timestamptz not null default now(),
  primary key (workspace_id, path));
create index if not exists luma_files_ws_version on luma_files (workspace_id, version);
create table if not exists luma_blobs (workspace_id text not null, id text not null, content bytea not null, primary key (workspace_id, id));`;

type WsState = { version: number; lastPull: number; dirty: boolean; pulling: Promise<void> | null };
type State = { ready: Promise<PgExtras | null> | null; ws: Map<string, WsState> };
const g = globalThis as unknown as { __lumaFiles?: State };
const st: State = (g.__lumaFiles ??= { ready: null, ws: new Map() });

export function mirrorEnabled() {
  return usingPostgres() && (process.env.LUMA_FILES ?? "db") !== "disk";
}

async function pg(): Promise<PgExtras | null> {
  if (!mirrorEnabled()) return null;
  return (st.ready ??= (async () => {
    const d = (await getDriver()) as unknown as PgExtras;
    await d.query(SCHEMA);
    await d.listen("luma_files", (payload) => {
      try {
        const { w, o } = JSON.parse(payload) as { w: string; o: string };
        if (o !== ORIGIN) wsState(w).dirty = true;
      } catch {}
    });
    return d;
  })());
}

function wsState(id: string): WsState {
  let s = st.ws.get(id);
  if (!s) st.ws.set(id, (s = { version: -1, lastPull: 0, dirty: true, pulling: null }));
  return s;
}

const rootOf = async (id: string) => (await import("./files")).workspaceRoot(id);
const manifestFile = async (id: string) => path.join(path.dirname(await rootOf(id)), "sync.json");

async function loadVersion(id: string) {
  try {
    return Number(JSON.parse(await fs.readFile(await manifestFile(id), "utf8")).version) || 0;
  } catch {
    return 0;
  }
}
async function saveVersion(id: string, version: number) {
  const f = await manifestFile(id);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ version, at: new Date().toISOString() }));
}

/** Upload (content) or tombstone (null) one file. Called after Luma writes it locally. */
export async function pushFile(workspaceId: string, rel: string, content: Buffer | null) {
  const d = await pg();
  if (!d) return;
  if (content && content.length > MAX_FILE) {
    console.warn(`[luma files] ${rel} is larger than ${MAX_FILE / 1e6} MB; kept on this machine only.`);
    return;
  }
  const r = await d.query(
    `insert into luma_files (workspace_id, path, content, size, deleted, version, updated_at)
     values ($1, $2, $3, $4, $5, nextval('luma_files_seq'), now())
     on conflict (workspace_id, path) do update set content = excluded.content, size = excluded.size,
       deleted = excluded.deleted, version = excluded.version, updated_at = now()
     returning version`,
    [workspaceId, rel, content, content?.length ?? 0, content === null],
  );
  const v = Number(r.rows[0].version);
  const s = wsState(workspaceId);
  // Only advance our watermark if nothing from others is pending in between.
  if (s.version >= 0 && v === s.version + 1) {
    s.version = v;
    await saveVersion(workspaceId, v);
  }
  await d.query("select pg_notify('luma_files', $1)", [JSON.stringify({ w: workspaceId, o: ORIGIN })]);
}

export async function pushBlob(workspaceId: string, id: string, content: string) {
  const d = await pg();
  if (!d) return;
  await d.query("insert into luma_blobs (workspace_id, id, content) values ($1, $2, $3) on conflict do nothing", [workspaceId, id, Buffer.from(content)]);
}

export async function fetchBlob(workspaceId: string, id: string): Promise<string | null> {
  const d = await pg();
  if (!d) return null;
  const r = await d.query("select content from luma_blobs where workspace_id = $1 and id = $2", [workspaceId, id]);
  return r.rows[0] ? (r.rows[0].content as Buffer).toString("utf8") : null;
}

export async function dropWorkspace(workspaceId: string) {
  const d = await pg();
  if (!d) return;
  await d.query("delete from luma_files where workspace_id = $1", [workspaceId]);
  await d.query("delete from luma_blobs where workspace_id = $1", [workspaceId]);
  st.ws.delete(workspaceId);
}

/** Bring this machine's working copy up to date (cheap when nothing changed). */
export async function pull(workspaceId: string, force = false) {
  const d = await pg();
  if (!d) return;
  const s = wsState(workspaceId);
  if (!force && !s.dirty && Date.now() - s.lastPull < PULL_EVERY_MS) return;
  if (s.pulling) return s.pulling;
  s.pulling = (async () => {
    try {
      if (s.version < 0) s.version = await loadVersion(workspaceId);
      s.dirty = false;
      const root = await rootOf(workspaceId);
      const { rows } = await d.query(
        "select path, content, deleted, version from luma_files where workspace_id = $1 and version > $2 order by version",
        [workspaceId, s.version],
      );
      for (const r of rows) {
        const abs = path.join(root, String(r.path));
        if (!abs.startsWith(root + path.sep)) continue;
        if (r.deleted) await fs.rm(abs, { force: true });
        else {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, r.content as Buffer);
        }
        s.version = Number(r.version);
      }
      if (rows.length) await saveVersion(workspaceId, s.version);
      s.lastPull = Date.now();
    } finally {
      s.pulling = null;
    }
  })();
  return s.pulling;
}

/**
 * At start-up: upload workspaces that exist only on this disk (first switch to db files),
 * so other hosts can see them. Workspaces already in the database are left to `pull`.
 */
export async function seed(workspaceIds: string[]) {
  const d = await pg();
  if (!d) return;
  const { listFiles, readFileBuffer } = await import("./files");
  for (const id of workspaceIds) {
    const has = await d.query("select 1 from luma_files where workspace_id = $1 limit 1", [id]);
    if (has.rows.length) continue;
    const files = await listFiles(id, { skipPull: true });
    if (!files.length) continue;
    console.log(`[luma files] uploading ${files.length} files of ${id} to Postgres…`);
    for (const f of files) {
      const buf = await readFileBuffer(id, f.path, { skipPull: true });
      if (buf) await pushFile(id, f.path, buf);
    }
    // Checkpoint blobs too, so history and undo work on other hosts.
    const dir = path.join(path.dirname(await rootOf(id)), "blobs");
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      await pushBlob(id, name, await fs.readFile(path.join(dir, name), "utf8"));
    }
  }
}
