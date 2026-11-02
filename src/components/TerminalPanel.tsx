"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Lock, LockOpen, Play, Square, TerminalSquare } from "lucide-react";
import { useWorkspace } from "./WorkspaceProvider";
import { AgentAvatar } from "./ui";
import { agentById, api, timeAgo } from "@/lib/client";
import type { CommandRun } from "@/lib/types";

interface Info {
  runs: CommandRun[];
  sandbox: "sandbox-exec" | "bwrap" | "none";
  enabled: boolean;
  allowed: string[];
  extra: string[];
}

const SUGGEST: Record<string, string[]> = {
  flutter: ["flutter analyze", "flutter test", "flutter pub get", "dart format lib"],
  web: ["npx html-validate index.html", "npx prettier --check .", "npm install", "npm test"],
};

const STATUS: Record<CommandRun["status"], { label: string; cls: string }> = {
  running: { label: "running", cls: "text-accent" },
  ok: { label: "ok", cls: "text-success" },
  failed: { label: "failed", cls: "text-danger" },
  refused: { label: "refused", cls: "text-warning" },
  timeout: { label: "timed out", cls: "text-danger" },
};

/** Live terminal for the workspace: agent and user commands, streaming output, run box. */
export function TerminalPanel({ className }: { className?: string }) {
  const { workspace, agents, subscribeLive } = useWorkspace();
  const [info, setInfo] = useState<Info | null>(null);
  const [runs, setRuns] = useState<CommandRun[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cmd, setCmd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    const d = await api<Info>(`/api/workspaces/${workspace.id}/commands`);
    setInfo(d);
    setRuns(d.runs);
  }, [workspace]);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  useEffect(
    () =>
      subscribeLive((e) => {
        if (e.kind === "command") {
          setRuns((rs) => {
            const i = rs.findIndex((r) => r.id === e.run.id);
            if (i < 0) return [...rs.slice(-99), e.run];
            const next = rs.slice();
            next[i] = e.run;
            return next;
          });
          if (e.run.status === "running") setOpen((o) => new Set(o).add(e.run.id));
        } else if (e.kind === "command_output") {
          setRuns((rs) => rs.map((r) => (r.id === e.runId ? { ...r, output: (r.output + e.chunk).slice(-40_000) } : r)));
        }
      }),
    [subscribeLive],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [runs]);

  if (!workspace) return null;

  const submit = async (line = cmd) => {
    if (!line.trim()) return;
    setError(null);
    try {
      await api(`/api/workspaces/${workspace.id}/commands`, { method: "POST", json: { command: line } });
      setCmd("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const stop = (id: string) => api(`/api/commands/${id}`, { method: "DELETE" }).catch(() => undefined);
  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const suggestions = SUGGEST[workspace.platform === "flutter" ? "flutter" : "web"];

  return (
    <div className={clsx("flex flex-col min-h-0 bg-[#0f1117] text-[#d7dae0]", className)}>
      <div className="flex items-center gap-2 h-8 px-3 border-b border-white/10 text-[11px] shrink-0">
        <TerminalSquare size={13} className="text-[#9aa4b2]" />
        <span className="font-semibold uppercase tracking-wider text-[#9aa4b2]">Terminal</span>
        {info && (
          <span
            className={clsx("flex items-center gap-1 ml-2", info.sandbox === "none" ? "text-amber-300" : "text-emerald-300")}
            title={
              info.sandbox === "none"
                ? "No OS sandbox on this computer: only allowlisted tools can run, inside the project folder."
                : "Commands run in an OS sandbox: no writes outside the project, no access to your credentials."
            }
          >
            {info.sandbox === "none" ? <LockOpen size={11} /> : <Lock size={11} />}
            {info.sandbox === "sandbox-exec" ? "macOS sandbox" : info.sandbox === "bwrap" ? "bubblewrap sandbox" : "allowlist only"}
          </span>
        )}
        {info && !info.enabled && <span className="text-amber-300 ml-2">Commands are off (Workspace settings)</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin font-mono text-[12px] leading-[1.5] px-3 py-2 space-y-2">
        {runs.length === 0 && (
          <p className="text-[#7d8590]">
            Commands you and your agents run show up here. Allowed: {info?.allowed.join(", ")}
            {info?.extra.length ? `, ${info.extra.join(", ")}` : ""}.
          </p>
        )}
        {runs.map((r) => {
          const agent = r.actor === "user" ? null : agentById(agents, r.actor);
          const s = STATUS[r.status];
          const isOpen = open.has(r.id) || r.status === "running";
          return (
            <div key={r.id}>
              <button className="w-full flex items-center gap-2 text-left hover:bg-white/5 rounded px-1 -mx-1" onClick={() => toggle(r.id)}>
                {agent ? <AgentAvatar agent={agent} size={16} /> : <span className="w-4 h-4 rounded-full bg-violet-500 text-white grid place-items-center text-[8px] font-bold">Y</span>}
                <span className="text-[#7ee787]">$</span>
                <span className="truncate flex-1">{r.command}</span>
                <span className={clsx("shrink-0", s.cls)}>
                  {r.status === "running" ? <span className="live-dot inline-block mr-1" /> : null}
                  {s.label}
                  {r.exitCode !== null && r.status === "failed" ? ` (${r.exitCode})` : ""}
                </span>
                <span className="text-[#7d8590] shrink-0 w-16 text-right">{r.status === "running" ? "" : `${(r.durationMs / 1000).toFixed(1)}s`}</span>
                <span className="text-[#7d8590] shrink-0 hidden sm:inline">{timeAgo(r.createdAt)}</span>
                {r.status === "running" && (
                  <span role="button" className="text-red-300 hover:text-red-200 shrink-0" onClick={(e) => { e.stopPropagation(); stop(r.id); }} title="Stop">
                    <Square size={11} />
                  </span>
                )}
              </button>
              {isOpen && (
                <pre className="whitespace-pre-wrap break-words text-[#c9d1d9] pl-6 mt-1 max-h-72 overflow-y-auto scroll-thin">
                  {r.output || (r.status === "running" ? "…" : "(no output)")}
                  {r.changedFiles.length > 0 && `\n→ changed ${r.changedFiles.length} file${r.changedFiles.length > 1 ? "s" : ""}: ${r.changedFiles.slice(0, 8).join(", ")}`}
                </pre>
              )}
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <div className="border-t border-white/10 p-2 shrink-0">
        <div className="flex gap-1.5 flex-wrap mb-1.5">
          {suggestions.map((sug) => (
            <button key={sug} className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[#9aa4b2]" onClick={() => submit(sug)}>
              {sug}
            </button>
          ))}
        </div>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <span className="font-mono text-[#7ee787] text-[12px]">$</span>
          <input
            className="flex-1 bg-transparent outline-none font-mono text-[12.5px] placeholder:text-[#5b636e]"
            placeholder={suggestions[0]}
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
          <button className="text-[#9aa4b2] hover:text-white" disabled={!cmd.trim()} aria-label="Run"><Play size={13} /></button>
        </form>
        {error && <p className="text-[11px] text-red-300 mt-1">{error}</p>}
      </div>
    </div>
  );
}
