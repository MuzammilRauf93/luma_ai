import "server-only";
import { EventEmitter } from "events";
import type { LiveEvent } from "./types";

/**
 * Pub/sub for live agent activity. The UI subscribes per workspace over Server-Sent Events.
 * With Postgres (Phase 5) events also cross processes: a bridge forwards them over
 * NOTIFY luma_live so the web process can stream what a background worker is doing.
 */
type BusState = { bus: EventEmitter; bridge: ((payload: string) => void) | null; origin: string };
const g = globalThis as unknown as { __lumaBus?: BusState };
const st: BusState = (g.__lumaBus ??= {
  bus: new EventEmitter().setMaxListeners(500),
  bridge: null,
  origin: Math.random().toString(36).slice(2),
});

const LIMIT = 7800; // Postgres NOTIFY payloads must stay under 8000 bytes

function shrink(v: unknown, max: number): unknown {
  if (typeof v === "string") return v.length > max ? v.slice(0, max) + "…" : v;
  if (Array.isArray(v)) return v.map((x) => shrink(x, max));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x, max)]));
  return v;
}

function forward(workspaceId: string, event: LiveEvent) {
  if (!st.bridge) return;
  if (event.kind === "command_output" && event.chunk.length > 3000) {
    for (let i = 0; i < event.chunk.length; i += 3000) forward(workspaceId, { ...event, chunk: event.chunk.slice(i, i + 3000) });
    return;
  }
  let payload = JSON.stringify({ o: st.origin, w: workspaceId, e: event });
  for (const max of [1500, 400]) {
    if (Buffer.byteLength(payload) <= LIMIT) break;
    payload = JSON.stringify({ o: st.origin, w: workspaceId, e: shrink(event, max) });
  }
  if (Buffer.byteLength(payload) <= LIMIT) st.bridge(payload);
}

export function publish(workspaceId: string, event: LiveEvent) {
  st.bus.emit(workspaceId, event);
  forward(workspaceId, event);
}

export function subscribe(workspaceId: string, fn: (e: LiveEvent) => void) {
  st.bus.on(workspaceId, fn);
  return () => {
    st.bus.off(workspaceId, fn);
  };
}

/** Wire cross-process forwarding (called once at startup when Postgres is used). */
export function setLiveBridge(send: (payload: string) => void) {
  st.bridge = send;
}

/** Handle an event forwarded by another process. */
export function receiveLive(payload: string) {
  try {
    const { o, w, e } = JSON.parse(payload) as { o: string; w: string; e: LiveEvent };
    if (o !== st.origin) st.bus.emit(w, e);
  } catch {
    // ignore malformed payloads
  }
}
