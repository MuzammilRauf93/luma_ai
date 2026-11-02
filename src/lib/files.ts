import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { DATA_DIR, mutate, newId, now } from "./store";
import { currentUser } from "./auth";
import { dropWorkspace, fetchBlob, pull, pushBlob, pushFile } from "./fileMirror";

type ReadOpts = { skipPull?: boolean };

/**
 * Per-workspace file storage on disk, with a checkpoint written for every change
 * so any agent edit can be rolled back (plan §5 "Version history").
 */

export function workspaceRoot(workspaceId: string) {
  if (!/^ws_[a-f0-9]+$/.test(workspaceId)) throw new Error("Invalid workspace id");
  return path.join(DATA_DIR, "workspaces", workspaceId, "files");
}

function blobDir(workspaceId: string) {
  return path.join(DATA_DIR, "workspaces", workspaceId, "blobs");
}

/** Normalise a user/agent supplied path and refuse anything escaping the workspace. */
export function safePath(workspaceId: string, rel: string) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean || clean.split("/").some((p) => p === ".." || p === "")) {
    throw new Error(`Invalid path: "${rel}"`);
  }
  const root = workspaceRoot(workspaceId);
  const abs = path.resolve(root, clean);
  if (!abs.startsWith(root + path.sep)) throw new Error(`Path escapes workspace: "${rel}"`);
  return { abs, rel: clean };
}

/** Generated / tool folders that agents and the file tree should never see. */
const IGNORED_DIRS = new Set([
  ".git", "node_modules", "build", ".dart_tool", "Pods", ".symlinks", "ephemeral", "DerivedData",
  "xcuserdata", ".idea", ".gradle", ".luma-sim",
]);

export interface FileEntry {
  path: string;
  size: number;
}

export async function listFiles(workspaceId: string, opts: ReadOpts = {}): Promise<FileEntry[]> {
  const root = workspaceRoot(workspaceId);
  if (!opts.skipPull) await pull(workspaceId);
  const out: FileEntry[] = [];
  async function walk(dir: string) {
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".DS_Store") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) await walk(abs);
      }
      else if (e.isFile()) {
        const st = await fs.stat(abs);
        out.push({ path: path.relative(root, abs).split(path.sep).join("/"), size: st.size });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readFile(workspaceId: string, rel: string, opts: ReadOpts = {}): Promise<string | null> {
  const { abs } = safePath(workspaceId, rel);
  if (!opts.skipPull) await pull(workspaceId);
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function readFileBuffer(workspaceId: string, rel: string, opts: ReadOpts = {}): Promise<Buffer | null> {
  const { abs } = safePath(workspaceId, rel);
  if (!opts.skipPull) await pull(workspaceId);
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

async function putBlob(workspaceId: string, content: string) {
  const id = crypto.createHash("sha256").update(content).digest("hex").slice(0, 24);
  const dir = blobDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, id);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, content);
    await pushBlob(workspaceId, id, content);
  }
  return id;
}

export async function getBlob(workspaceId: string, blobId: string) {
  if (!/^[a-f0-9]+$/.test(blobId)) throw new Error("Invalid blob id");
  const file = path.join(blobDir(workspaceId), blobId);
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    // Fresh host: fetch the checkpoint from Postgres and cache it.
    const remote = await fetchBlob(workspaceId, blobId);
    if (remote === null) throw err;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, remote);
    return remote;
  }
}

interface ChangeOpts {
  actor: string;
  ticketId?: string | null;
}

export async function recordCheckpoint(
  workspaceId: string,
  rel: string,
  before: string | null,
  after: string | null,
  opts: ChangeOpts,
) {
  const beforeBlob = before === null ? null : await putBlob(workspaceId, before);
  const afterBlob = after === null ? null : await putBlob(workspaceId, after);
  await mutate((db) => {
    db.checkpoints.push({
      id: newId("cp"),
      workspaceId,
      path: rel,
      beforeBlob,
      afterBlob,
      actor: opts.actor,
      ticketId: opts.ticketId ?? null,
      userId: opts.actor === "user" ? currentUser()?.id : undefined,
      createdAt: now(),
    });
  });
}

export async function writeFile(workspaceId: string, relIn: string, content: string, opts: ChangeOpts) {
  const { abs, rel } = safePath(workspaceId, relIn);
  const before = await readFile(workspaceId, rel);
  if (before === content) return { rel, created: false, changed: false };
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
  await pushFile(workspaceId, rel, Buffer.from(content));
  await recordCheckpoint(workspaceId, rel, before, content, opts);
  return { rel, created: before === null, changed: true };
}

export async function deleteFile(workspaceId: string, relIn: string, opts: ChangeOpts) {
  const { abs, rel } = safePath(workspaceId, relIn);
  const before = await readFile(workspaceId, rel);
  if (before === null) return false;
  await fs.unlink(abs);
  await pushFile(workspaceId, rel, null);
  await recordCheckpoint(workspaceId, rel, before, null, opts);
  // tidy up now-empty folders
  let dir = path.dirname(abs);
  const root = workspaceRoot(workspaceId);
  while (dir !== root) {
    const left = await fs.readdir(dir).catch(() => ["x"]);
    if (left.length) break;
    await fs.rmdir(dir).catch(() => undefined);
    dir = path.dirname(dir);
  }
  return true;
}

export async function renameFile(workspaceId: string, from: string, to: string, opts: ChangeOpts) {
  const content = await readFile(workspaceId, from);
  if (content === null) throw new Error(`File not found: ${from}`);
  if ((await readFile(workspaceId, to)) !== null) throw new Error(`A file already exists at ${to}`);
  await writeFile(workspaceId, to, content, opts);
  await deleteFile(workspaceId, from, opts);
}

/** Restore a file to the state it had *before* a checkpoint. */
export async function revertCheckpoint(workspaceId: string, checkpointId: string, actor = "user") {
  const { read } = await import("./store");
  const db = await read();
  const cp = db.checkpoints.find((c) => c.id === checkpointId && c.workspaceId === workspaceId);
  if (!cp) throw new Error("Checkpoint not found");
  if (cp.beforeBlob === null) await deleteFile(workspaceId, cp.path, { actor });
  else await writeFile(workspaceId, cp.path, await getBlob(workspaceId, cp.beforeBlob), { actor });
  return cp.path;
}

export async function initWorkspaceFiles(workspaceId: string, files: Record<string, string>) {
  await fs.mkdir(workspaceRoot(workspaceId), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const { abs } = safePath(workspaceId, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
    await pushFile(workspaceId, rel, Buffer.from(content));
  }
}

/** Mirror files that something other than Luma's file functions changed (commands, git pull). */
export async function syncChanged(workspaceId: string, rels: string[]) {
  for (const rel of rels) {
    const { abs } = safePath(workspaceId, rel);
    const buf = await fs.readFile(abs).catch(() => null);
    await pushFile(workspaceId, rel, buf);
  }
}

export async function removeWorkspaceFiles(workspaceId: string) {
  workspaceRoot(workspaceId); // validates id
  await dropWorkspace(workspaceId);
  await fs.rm(path.join(DATA_DIR, "workspaces", workspaceId), { recursive: true, force: true });
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
};

export function mimeFor(rel: string) {
  return MIME[rel.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}
