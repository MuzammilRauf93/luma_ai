"use client";

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Pause, Play, Zap } from "lucide-react";
import { useWorkspace } from "./WorkspaceProvider";
import { api } from "@/lib/client";
import { APPROVAL_MODES } from "@/lib/types";

/**
 * Autopilot status for a workspace: approval mode, how many agents are working
 * (out of the parallel limit), what's queued, and a pause/resume switch.
 */
export function AutopilotBar({ compact = false }: { compact?: boolean }) {
  const { workspace, tickets, reload } = useWorkspace();
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;

  const running = tickets.filter((t) => t.running).length;
  const queued = tickets.filter((t) => t.queued && !t.running).length;
  const approvals = tickets.filter((t) => t.pendingHandoff).length;
  const limit = workspace.maxParallelRuns ?? 2;
  const mode = APPROVAL_MODES.find((m) => m.id === workspace.approvalMode) ?? APPROVAL_MODES[1];
  const paused = Boolean(workspace.autopilotPaused);

  const toggle = async () => {
    setBusy(true);
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: "PATCH", json: { autopilotPaused: !paused } });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {paused && workspace.autopilotNote && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
          <span className="flex-1">{workspace.autopilotNote}</span>
          <button className="btn btn-sm" onClick={toggle} disabled={busy}>
            <Play size={12} /> Resume
          </button>
        </div>
      )}
      <div className={clsx("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", compact ? "" : "rounded-xl border bg-panel px-3 py-2")}>
        <span className="flex items-center gap-1.5 font-medium">
          <Zap size={13} className={paused ? "text-muted" : "text-accent"} />
          Autopilot {paused ? "paused" : workspace.approvalMode === "manual" ? "off" : "on"}
        </span>
        <span className="text-muted" title={mode.hint}>{mode.label}</span>
        <span className="text-muted">·</span>
        <span className="tabular-nums">
          <b className={running ? "text-success" : ""}>{running}</b>
          <span className="text-muted">/{limit} working</span>
        </span>
        {queued > 0 && (
          <span className="tabular-nums">
            <b>{queued}</b> <span className="text-muted">queued</span>
          </span>
        )}
        {approvals > 0 && (
          <span className="chip !bg-warning/15 !text-warning">
            {approvals} handoff{approvals > 1 ? "s" : ""} to approve
          </span>
        )}
        <button className="btn btn-sm btn-ghost ml-auto" onClick={toggle} disabled={busy} title={paused ? "Let Luma start queued tickets again" : "Stop Luma from starting new tickets on its own. Running agents finish their current step."}>
          {paused ? <><Play size={12} /> Resume autopilot</> : <><Pause size={12} /> Pause autopilot</>}
        </button>
      </div>
    </div>
  );
}
