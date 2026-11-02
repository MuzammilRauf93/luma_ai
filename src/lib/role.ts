import os from "os";

/**
 * Which part of Luma this process plays (Phase 5):
 * - "all" (default): web UI + runs agents. The only mode for the JSON database.
 * - "web": UI/API only; agent runs are queued for workers. Needs Postgres.
 * - "worker": runs agents (and the autopilot scheduler) only. Needs Postgres.
 */
export const ROLE = ((process.env.LUMA_ROLE ?? "all") as "all" | "web" | "worker");
export const WORKER_ID = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
export const HEARTBEAT_MS = 5_000;
export const STALE_MS = 45_000;

export function isExecutor() {
  if (ROLE === "web") return !process.env.LUMA_DATABASE_URL; // without Postgres nobody else could run it
  return true;
}
