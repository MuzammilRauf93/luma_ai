"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Columns2, Rows3, RotateCcw, ChevronsUpDown } from "lucide-react";
import { api, agentById, timeAgo } from "@/lib/client";
import { diffLines, diffStats, toHunks, type DiffLine } from "@/lib/diff";
import type { Checkpoint } from "@/lib/types";
import { ErrorNote, Modal } from "./ui";
import { useWorkspace } from "./WorkspaceProvider";

const MonacoDiff = dynamic(
  () =>
    import("@monaco-editor/react").then((m) => {
      m.loader.config({ paths: { vs: `${window.location.origin}/monaco/vs` } });
      return m.DiffEditor;
    }),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading side-by-side view…</div> },
);

const LANG: Record<string, string> = {
  html: "html", css: "css", js: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript", jsx: "javascript",
  dart: "dart", json: "json", md: "markdown", svg: "xml", yaml: "yaml", yml: "yaml", py: "python",
};

export type DiffTarget = { checkpointId: string } | { ticketId: string; path: string };

interface DiffData {
  path: string;
  before: string | null;
  after: string | null;
  checkpoints: Checkpoint[];
}

/** Modal showing what changed in a file (one checkpoint, or everything a ticket did to it), with undo. */
export function DiffModal({ target, onClose, onUndone }: { target: DiffTarget; onClose: () => void; onUndone?: () => void }) {
  const { workspace, agents } = useWorkspace();
  const [data, setData] = useState<DiffData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    const q = "checkpointId" in target ? `checkpointId=${target.checkpointId}` : `ticketId=${target.ticketId}&path=${encodeURIComponent(target.path)}`;
    api<DiffData>(`/api/workspaces/${workspace.id}/diff?${q}`).then(setData).catch((e) => setError((e as Error).message));
  }, [workspace, target]);

  const lines = useMemo(() => (data ? diffLines(data.before, data.after) : []), [data]);
  const stats = diffStats(lines);
  const first = data?.checkpoints[0];
  const last = data?.checkpoints[data.checkpoints.length - 1];
  const actorNames = [...new Set(data?.checkpoints.map((c) => (c.actor === "user" ? "You" : agentById(agents, c.actor)?.name ?? "Agent")) ?? [])];

  const undo = async () => {
    if (!workspace || !data) return;
    const what = data.before === null ? `delete ${data.path} (it didn't exist before)` : `put ${data.path} back the way it was before`;
    if (!confirm(`Undo this? Luma will ${what}. You can redo it from version history.`)) return;
    setBusy(true);
    try {
      const json = "checkpointId" in target ? { checkpointId: target.checkpointId } : { ticketId: target.ticketId, path: target.path };
      await api(`/api/workspaces/${workspace.id}/checkpoints`, { method: "POST", json });
      onUndone?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={data ? data.path : "Changes"} wide>
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        {data && (
          <>
            <span className="text-success font-medium tabular-nums">+{stats.adds}</span>
            <span className="text-danger font-medium tabular-nums">−{stats.dels}</span>
            <span className="text-muted">
              {data.before === null ? "new file" : data.after === null ? "file deleted" : `${data.checkpoints.length} change${data.checkpoints.length > 1 ? "s" : ""}`}
              {" · "}by {actorNames.join(", ")}
              {last && ` · ${timeAgo(last.createdAt)}`}
            </span>
          </>
        )}
        <div className="ml-auto flex rounded-lg border p-0.5">
          <button className={clsx("btn btn-sm !h-7 !border-0", mode === "unified" ? "!bg-panel-2" : "btn-ghost text-muted")} onClick={() => setMode("unified")}>
            <Rows3 size={12} /> Unified
          </button>
          <button className={clsx("btn btn-sm !h-7 !border-0", mode === "split" ? "!bg-panel-2" : "btn-ghost text-muted")} onClick={() => setMode("split")}>
            <Columns2 size={12} /> Side by side
          </button>
        </div>
      </div>
      <ErrorNote message={error} />
      {!data ? (
        <div className="p-6 text-sm text-muted">Loading…</div>
      ) : mode === "unified" ? (
        <UnifiedDiff lines={lines} />
      ) : (
        <div className="h-[60vh] rounded-lg border overflow-hidden">
          <MonacoDiff
            original={data.before ?? ""}
            modified={data.after ?? ""}
            language={LANG[data.path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext"}
            theme={typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "vs-dark" : "light"}
            options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, fontSize: 12.5, scrollBeyondLastLine: false }}
          />
        </div>
      )}
      <div className="flex items-center gap-2 mt-4">
        {first && first.beforeBlob === null && <span className="text-xs text-muted">Undoing removes the file.</span>}
        <button className="btn btn-danger ml-auto" onClick={undo} disabled={busy || !data}>
          <RotateCcw size={13} /> Undo {"checkpointId" in target ? "this change" : "these changes"}
        </button>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

export function UnifiedDiff({ lines, context = 3 }: { lines: DiffLine[]; context?: number }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const hunks = useMemo(() => toHunks(lines, context), [lines, context]);
  if (!lines.length) return <div className="p-6 text-sm text-muted text-center rounded-lg border">The file is empty.</div>;
  if (!lines.some((l) => l.type !== "same")) return <div className="p-6 text-sm text-muted text-center rounded-lg border">No differences.</div>;
  const row = (l: DiffLine, k: string) => (
    <tr key={k} className={clsx(l.type === "add" && "bg-success/10", l.type === "del" && "bg-danger/10")}>
      <td className="select-none text-right pr-2 pl-2 text-muted/70 w-10 tabular-nums">{l.a ?? ""}</td>
      <td className="select-none text-right pr-2 text-muted/70 w-10 tabular-nums border-r">{l.b ?? ""}</td>
      <td className={clsx("select-none w-5 text-center", l.type === "add" ? "text-success" : l.type === "del" ? "text-danger" : "text-muted/50")}>
        {l.type === "add" ? "+" : l.type === "del" ? "−" : ""}
      </td>
      <td className="whitespace-pre-wrap break-all pr-3">{l.text || " "}</td>
    </tr>
  );
  return (
    <div className="max-h-[60vh] overflow-auto scroll-thin rounded-lg border bg-panel">
      <table className="w-full font-mono text-[12px] leading-[1.55]">
        <tbody>
          {hunks.map((h, i) =>
            "skipped" in h ? (
              expanded.has(i) ? (
                <Fragment key={i}>{lines.slice(h.from, h.from + h.skipped).map((l, j) => row(l, `${i}-${j}`))}</Fragment>
              ) : (
                <tr key={i} className="bg-panel-2">
                  <td colSpan={4} className="py-1 text-center">
                    <button className="text-[11px] text-muted hover:text-ink inline-flex items-center gap-1" onClick={() => setExpanded(new Set(expanded).add(i))}>
                      <ChevronsUpDown size={11} /> Show {h.skipped} unchanged line{h.skipped > 1 ? "s" : ""}
                    </button>
                  </td>
                </tr>
              )
            ) : (
              <Fragment key={i}>{h.lines.map((l, j) => row(l, `${i}-${j}`))}</Fragment>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
