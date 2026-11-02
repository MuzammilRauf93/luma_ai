"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AppWindow, Play, RefreshCw, RotateCcw, ScrollText, Smartphone, Square, Zap } from "lucide-react";
import { api } from "@/lib/client";

type SimState = "idle" | "preparing" | "building" | "running" | "reloading" | "error" | "stopped";

interface Status {
  flutter: boolean;
  isMac: boolean;
  state: SimState;
  message: string;
  udid: string | null;
  log: string[];
  tools?: { ok: boolean; problems: string[] };
  devices?: { udid: string; name: string; runtime: string; state: string }[];
  selectedUdid?: string | null;
  autoRun?: boolean;
}

const STATE_LABEL: Record<SimState, { text: string; color: string }> = {
  idle: { text: "Not running", color: "#a8a29e" },
  preparing: { text: "Preparing", color: "#0ea5e9" },
  building: { text: "Building", color: "#2563eb" },
  running: { text: "Live", color: "#059669" },
  reloading: { text: "Hot reloading", color: "#7c3aed" },
  error: { text: "Error", color: "#dc2626" },
  stopped: { text: "Stopped", color: "#a8a29e" },
};

/**
 * Live iPhone preview: runs the Flutter workspace in the iOS Simulator on this Mac
 * and mirrors its screen inside a phone frame.
 */
export function SimulatorPreview({ workspaceId, compact = false }: { workspaceId: string; compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [udid, setUdid] = useState<string>("");
  const [frame, setFrame] = useState(0);
  const [hasImage, setHasImage] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  const loadFull = useCallback(async () => {
    const s = await api<Status>(`/api/workspaces/${workspaceId}/simulator?full=1`);
    setStatus(s);
    setUdid((u) => u || s.udid || s.selectedUdid || "");
  }, [workspaceId]);

  useEffect(() => {
    loadFull().catch((e) => setError(e.message));
  }, [loadFull]);

  // Lightweight status polling.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const s = await api<Status>(`/api/workspaces/${workspaceId}/simulator`);
        setStatus((prev) => (prev ? { ...prev, ...s } : s));
      } catch {}
    }, 2000);
    return () => clearInterval(t);
  }, [workspaceId]);

  useEffect(() => {
    if (showLog) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [status?.log.length, showLog]);

  const live = status && ["running", "reloading", "building", "preparing"].includes(status.state);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setError(null);
    try {
      await api(`/api/workspaces/${workspaceId}/simulator`, { method: "POST", json: { action, udid: udid || undefined, ...extra } });
      const s = await api<Status>(`/api/workspaces/${workspaceId}/simulator`);
      setStatus((prev) => (prev ? { ...prev, ...s } : s));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!status) return <div className="p-4 text-sm text-muted">Checking the simulator…</div>;

  const st = STATE_LABEL[status.state];
  const problems = status.tools && !status.tools.ok ? status.tools.problems : !status.isMac ? ["The iOS Simulator only runs when Luma runs on a Mac."] : [];
  const phoneWidth = compact ? 200 : 300;

  return (
    <div className="flex flex-col h-full min-h-0 bg-panel-2">
      {!compact && (
        <div className="flex flex-wrap items-center gap-1 min-h-10 px-2 py-1 border-b bg-panel shrink-0">
          <Smartphone size={13} className="text-muted ml-1" />
          <select
            className="input !py-0.5 !text-xs !w-auto max-w-[190px]"
            value={udid}
            onChange={(e) => {
              setUdid(e.target.value);
              act("settings", { udid: e.target.value });
            }}
            disabled={!status.devices?.length}
          >
            {!status.devices?.length && <option value="">No simulators</option>}
            {status.devices?.map((d) => (
              <option key={d.udid} value={d.udid}>
                {d.name} · {d.runtime}
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-0.5">
            {live ? (
              <>
                <button className="btn btn-ghost btn-sm !px-2" title="Hot reload" onClick={() => act("reload")}><Zap size={13} /></button>
                <button className="btn btn-ghost btn-sm !px-2" title="Restart app" onClick={() => act("restart")}><RotateCcw size={13} /></button>
                <button className="btn btn-ghost btn-sm !px-2" title="Stop" onClick={() => act("stop")}><Square size={12} /></button>
              </>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => act("run")} disabled={problems.length > 0}>
                <Play size={12} /> Run on iPhone
              </button>
            )}
            <button className="btn btn-ghost btn-sm !px-2" title="Open the Simulator window (to tap and scroll)" onClick={() => act("open")} disabled={!live}>
              <AppWindow size={13} />
            </button>
            <button className={clsx("btn btn-ghost btn-sm !px-2", showLog && "!bg-panel-2")} title="Build log" onClick={() => setShowLog((v) => !v)}>
              <ScrollText size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-start gap-3 p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="chip" style={{ color: st.color, background: `${st.color}18` }}>
            <span className={clsx("w-1.5 h-1.5 rounded-full", status.state === "running" && "live-dot !w-1.5 !h-1.5")} style={{ background: st.color }} />
            {st.text}
          </span>
          {status.message && <span className="text-muted truncate max-w-[260px]">{status.message}</span>}
        </div>

        {/* Phone frame */}
        <div
          className="relative shrink-0 rounded-[44px] p-[10px] shadow-xl"
          style={{ width: phoneWidth, background: "#111", boxShadow: "0 0 0 2px #2a2a2e, 0 20px 50px rgb(0 0 0 / 0.25)" }}
        >
          <div className="relative overflow-hidden rounded-[34px] bg-black" style={{ aspectRatio: "9 / 19.5" }}>
            {live && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={frame}
                src={`/api/workspaces/${workspaceId}/simulator/screen?f=${frame}`}
                alt="iPhone simulator screen"
                className={clsx("absolute inset-0 w-full h-full object-cover", !hasImage && "opacity-0")}
                onLoad={() => {
                  setHasImage(true);
                  setTimeout(() => setFrame((f) => f + 1), 700);
                }}
                onError={() => setTimeout(() => setFrame((f) => f + 1), 1500)}
              />
            )}
            {(!live || !hasImage) && (
              <div className="absolute inset-0 grid place-items-center text-center px-5">
                <div className="text-[12px] text-white/70">
                  {live ? (
                    <>
                      <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-white/60" />
                      {status.state === "building" ? "Building your app…" : "Starting the simulator…"}
                    </>
                  ) : status.state === "error" ? (
                    "The app couldn't start. Open the build log for details."
                  ) : (
                    <>
                      <Smartphone size={22} className="mx-auto mb-2 text-white/50" />
                      {compact ? "Run the app to see it here." : "Press “Run on iPhone”. Luma reloads it automatically when agents change the code."}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {!compact && status.autoRun !== undefined && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={status.autoRun}
              onChange={(e) => {
                setStatus({ ...status, autoRun: e.target.checked });
                act("settings", { autoRun: e.target.checked });
              }}
            />
            Run and hot-reload automatically when agents finish
          </label>
        )}

        {problems.length > 0 && (
          <div className="w-full max-w-md text-xs rounded-lg bg-warning/10 text-ink/80 p-3 space-y-1">
            {problems.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        )}
        {error && <p className="w-full max-w-md text-xs text-danger bg-danger/10 rounded-lg p-3 whitespace-pre-wrap">{error}</p>}

        {!compact && (showLog || status.state === "error") && status.log.length > 0 && (
          <pre ref={logRef} className="w-full max-w-xl text-[11px] leading-snug bg-[#111] text-[#d4d4d8] rounded-lg p-3 max-h-56 overflow-auto scroll-thin whitespace-pre-wrap">
            {status.log.slice(-120).join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
