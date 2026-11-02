import "server-only";
import { getDriver, initStore, mutate, onRemoteChange, read, usingPostgres } from "./store";
import { receiveLive, setLiveBridge } from "./bus";
import { HEARTBEAT_MS, isExecutor, ROLE, STALE_MS, WORKER_ID } from "./role";
import { addEvent, updateTicket } from "./repo";
import { cancelRun, localRunTicketIds } from "./engine/orchestrator";
import { kick } from "./engine/scheduler";

/**
 * Server start-up and background loop (Phase 5), called from src/instrumentation.ts.
 *
 * - Connects the store (JSON or Postgres) and, with Postgres, the cross-process live bridge.
 * - In executor processes (role "all" or "worker"):
 *   - heartbeats the runs it owns every 5 s and honours stop requests from other processes;
 *   - recovers runs whose process died (stale heartbeat, or a dead pid on this machine) and
 *     resumes them automatically (up to 2 times per ticket), so runs survive restarts;
 *   - kicks the autopilot scheduler for every workspace with queued work.
 */

const MAX_RESUMES = 2;
const g = globalThis as unknown as { __lumaBooted?: boolean };

function pidAlive(workerId: string) {
  const [host, pid] = workerId.split(":");
  if (host !== WORKER_ID.split(":")[0]) return null; // another machine: rely on heartbeats
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function heartbeat() {
  const mine = new Set(localRunTicketIds());
  if (!mine.size) return; // nothing to heartbeat: don't rewrite the database
  const toCancel = await mutate((db) => {
    const cancel: string[] = [];
    const t = new Date().toISOString();
    for (const r of db.runs) {
      if (r.workerId !== WORKER_ID || r.status !== "running") continue;
      if (!mine.has(r.ticketId)) continue; // finished between the snapshot and now
      r.heartbeatAt = t;
      if (r.cancelRequested) cancel.push(r.ticketId);
    }
    return cancel;
  });
  for (const id of toCancel) await cancelRun(id);
}

export async function recover() {
  const now = Date.now();
  const mine = new Set(localRunTicketIds());
  const snapshot = await read();
  const maybe =
    snapshot.runs.some((r) => r.status === "running" && (r.workerId === WORKER_ID ? !mine.has(r.ticketId) : true)) ||
    snapshot.tickets.some((t) => t.status === "in_progress" && !mine.has(t.id));
  if (!maybe) return; // cheap read-only check first
  const interrupted = await mutate((db) => {
    const out: { ticketId: string; agentId: string }[] = [];
    for (const r of db.runs) {
      if (r.status !== "running") continue;
      const local = r.workerId === WORKER_ID;
      const stale = now - new Date(r.heartbeatAt).getTime() > STALE_MS;
      const dead = !local && pidAlive(r.workerId) === false;
      if ((local && !mine.has(r.ticketId)) || dead || (!local && stale)) {
        r.status = "interrupted";
        r.finishedAt = new Date().toISOString();
        out.push({ ticketId: r.ticketId, agentId: r.agentId });
      }
    }
    // Tickets stuck "In Progress" with no run record at all (e.g. data from before Phase 5).
    for (const t of db.tickets) {
      if (t.status !== "in_progress") continue;
      if (db.runs.some((r) => r.ticketId === t.id && r.status === "running")) continue;
      if (out.some((o) => o.ticketId === t.id)) continue;
      if (now - new Date(t.updatedAt).getTime() < STALE_MS) continue;
      out.push({ ticketId: t.id, agentId: t.assigneeId ?? "" });
    }
    return out;
  });
  if (!interrupted.length) return;
  const db = await read();
  for (const { ticketId, agentId } of interrupted) {
    const t = db.tickets.find((x) => x.id === ticketId);
    if (!t) continue;
    const who = db.agents.find((a) => a.id === agentId)?.name ?? "The agent";
    const n = t.resumeCount ?? 0;
    if (n < MAX_RESUMES && t.assigneeId && t.status !== "done") {
      await addEvent(ticketId, "system", "comment", `Luma restarted while ${who} was working on this. Picking up where they left off (attempt ${n + 2}).`);
      await updateTicket(ticketId, { status: "todo", queued: true, forceStart: true, resumeCount: n + 1 }, "system");
    } else {
      await addEvent(ticketId, "system", "error", `${who}'s run was interrupted again. Run it again when you're ready.`);
      await updateTicket(ticketId, { status: "todo", queued: false }, "system");
    }
  }
}

async function kickAll() {
  const db = await read();
  const ids = new Set(db.tickets.filter((t) => t.queued).map((t) => t.workspaceId));
  for (const id of ids) await kick(id);
}

export async function boot() {
  if (g.__lumaBooted) return;
  g.__lumaBooted = true;
  const driverName = await initStore();
  if (usingPostgres()) {
    const d = (await getDriver()) as unknown as { notifyLive: (p: string) => Promise<void>; onLive: (fn: (p: string) => void) => void };
    setLiveBridge((p) => void d.notifyLive(p).catch(() => undefined));
    d.onLive(receiveLive);
    if (!process.env.LUMA_SECRET)
      console.warn("[luma] Using Postgres without LUMA_SECRET: keys saved by one process can't be read by another. Set the same LUMA_SECRET everywhere.");
  } else if (ROLE !== "all") {
    console.warn(`[luma] LUMA_ROLE=${ROLE} needs Postgres (LUMA_DATABASE_URL). Running as a single process instead.`);
  }
  const { mirrorEnabled, seed } = await import("./fileMirror");
  if (mirrorEnabled()) {
    await seed((await read()).workspaces.map((w) => w.id)).catch((err) => console.error("[luma files] seeding failed:", err));
  }
  console.log(`[luma] ${ROLE} process ${WORKER_ID} · store: ${driverName} · files: ${mirrorEnabled() ? "postgres + local cache" : "disk"}${isExecutor() ? " · runs agents" : " · UI only"}`);
  if (!isExecutor()) return;

  // React quickly when the web process queues work (instead of waiting for the next loop).
  let pending: ReturnType<typeof setTimeout> | null = null;
  onRemoteChange(() => {
    pending ??= setTimeout(() => {
      pending = null;
      void kickAll().catch(() => undefined);
    }, 250);
  });

  await recover().catch((err) => console.error("[luma] recovery failed:", err));
  await kickAll().catch(() => undefined);
  let tickNo = 0;
  const timer = setInterval(async () => {
    tickNo++;
    try {
      await heartbeat();
      if (tickNo % 3 === 0) {
        await recover();
        await kickAll();
      }
      if (tickNo % 720 === 1) {
        // Hourly: daily notification digests (only does anything once per person per day).
        const { sendDigests } = await import("./mail");
        await sendDigests();
      }
    } catch (err) {
      console.error("[luma] background loop:", err);
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
}
