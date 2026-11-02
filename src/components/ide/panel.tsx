"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info, Maximize2, MessageSquare, Minimize2, X } from "lucide-react";
import { TerminalPanel } from "../TerminalPanel";
import { useWorkspace } from "../WorkspaceProvider";
import { agentById, timeAgo } from "@/lib/client";
import { FileIcon, baseName, dirName } from "./bits";
import { useIde, type PanelTab } from "./ctx";

export function Panel({ tab, setTab, maximized, onMaximize, onClose }: { tab: PanelTab; setTab: (t: PanelTab) => void; maximized: boolean; onMaximize: () => void; onClose: () => void }) {
  const ide = useIde();
  const errors = ide.problems.filter((p) => p.severity === "error").length;
  const openThreads = ide.threads.filter((t) => t.status === "open").length;
  const tabs: [PanelTab, string, number?][] = [
    ["problems", "Problems", ide.problems.length],
    ["output", "Output"],
    ["terminal", "Terminal"],
    ["comments", "Comments", openThreads],
  ];
  return (
    <div className="flex flex-col h-full min-h-0" style={{ background: "var(--ide-panel)", borderTop: "1px solid var(--ide-border)" }}>
      <div className="flex items-center h-[35px] px-2 shrink-0 gap-1">
        {tabs.map(([id, label, n]) => (
          <button
            key={id}
            className="h-[35px] px-2 text-[11px] uppercase tracking-wide flex items-center gap-1.5"
            style={{ color: tab === id ? "var(--ide-fg)" : "var(--ide-muted)", borderBottom: tab === id ? "1px solid var(--ide-focus)" : "1px solid transparent" }}
            onClick={() => setTab(id)}
          >
            {label}
            {!!n && <span className="ide-badge" style={{ background: id === "problems" && errors ? "#f14c4c" : undefined }}>{n}</span>}
          </button>
        ))}
        <span className="ml-auto flex gap-0.5">
          <button className="ide-icon-btn" title={maximized ? "Restore Panel Size" : "Maximize Panel Size"} onClick={onMaximize}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
          <button className="ide-icon-btn" title={`Hide Panel (Ctrl+J)`} onClick={onClose}><X size={15} /></button>
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "problems" && <Problems />}
        {tab === "output" && <Output />}
        {tab === "terminal" && <TerminalPanel className="h-full" />}
        {tab === "comments" && <Comments />}
      </div>
    </div>
  );
}

function Problems() {
  const ide = useIde();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const byFile = useMemo(() => {
    const m = new Map<string, typeof ide.problems>();
    for (const p of ide.problems) m.set(p.path, [...(m.get(p.path) ?? []), p]);
    return [...m];
  }, [ide.problems]);
  if (!byFile.length) return <p className="px-5 py-2 text-[13px]" style={{ color: "var(--ide-muted)" }}>No problems have been detected in the workspace so far. (Open a file to check it.)</p>;
  return (
    <div className="h-full overflow-auto pb-2">
      {byFile.map(([path, list]) => (
        <div key={path}>
          <div className="ide-row pl-2 pr-2" onClick={() => setClosed((c) => (c.has(path) ? new Set([...c].filter((x) => x !== path)) : new Set(c).add(path)))}>
            {closed.has(path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <FileIcon path={path} size={14} />
            <span className="ml-1.5">{baseName(path)}</span>
            <span className="ml-1.5 text-[12px]" style={{ color: "var(--ide-muted)" }}>{dirName(path)}</span>
            <span className="ide-badge ml-2">{list.length}</span>
          </div>
          {!closed.has(path) &&
            list.map((p, i) => (
              <div key={i} className="ide-row pr-2 text-[13px]" style={{ paddingLeft: 36 }} onClick={() => ide.openFile(path, { line: p.line, col: p.col, preview: true })}>
                {p.severity === "error" ? <AlertCircle size={14} color="#f14c4c" /> : p.severity === "warning" ? <AlertTriangle size={14} color="#cca700" /> : <Info size={14} color="#3794ff" />}
                <span className="ml-1.5 truncate">{p.message}</span>
                <span className="ml-1.5 shrink-0 text-[12px]" style={{ color: "var(--ide-muted)" }}>
                  {p.source ? `${p.source} ` : ""}[Ln {p.line}, Col {p.col}]
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function Output() {
  const ide = useIde();
  const { activity, agents, tickets } = useWorkspace();
  const [channel, setChannel] = useState<"Luma Agents" | "Source Control" | "Code Review" | "Luma">("Luma Agents");
  const end = useRef<HTMLDivElement>(null);
  const lines =
    channel === "Luma Agents"
      ? activity
          .slice()
          .sort((a, b) => a.at - b.at)
          .map((a) => {
            const t = tickets.find((x) => x.id === a.ticketId);
            return { at: a.at, text: `[${agentById(agents, a.agentId)?.name ?? "Agent"}${t ? ` · LUM-${t.number}` : ""}] ${a.text}` };
          })
      : ide.output.filter((o) => o.channel === channel);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);
  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-end px-3 pb-1">
        <select className="ide-input !w-auto !py-0 !text-[12px]" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
          {["Luma Agents", "Source Control", "Code Review", "Luma"].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 overflow-auto px-4 pb-2 font-mono text-[12px] leading-[18px]" style={{ whiteSpace: "pre-wrap" }}>
        {lines.length === 0 && <span style={{ color: "var(--ide-muted)" }}>No output yet.</span>}
        {lines.map((l, i) => (
          <div key={i}>
            <span style={{ color: "var(--ide-muted)" }}>{new Date(l.at).toLocaleTimeString()}</span> {l.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

function Comments() {
  const ide = useIde();
  const { tickets } = useWorkspace();
  const [show, setShow] = useState<"open" | "all">("open");
  const list = ide.threads.filter((t) => show === "all" || t.status === "open");
  const byFile = useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const t of list) m.set(t.path, [...(m.get(t.path) ?? []), t]);
    return [...m];
  }, [list]);
  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1 px-3 pb-1 text-[12px]">
        {(["open", "all"] as const).map((s) => (
          <button key={s} className={clsx("px-2 rounded-full")} style={{ border: "1px solid var(--ide-border)", background: show === s ? "var(--ide-select)" : "transparent" }} onClick={() => setShow(s)}>
            {s === "open" ? "Unresolved" : "All"}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto pb-2">
        {!byFile.length && <p className="px-5 py-2 text-[13px]" style={{ color: "var(--ide-muted)" }}>No review comments. Hover a line number in any file and click + to add one.</p>}
        {byFile.map(([path, ts]) => (
          <div key={path}>
            <div className="ide-row pl-3 pr-2">
              <FileIcon path={path} size={14} />
              <span className="ml-1.5">{baseName(path)}</span>
              <span className="ml-1.5 text-[12px]" style={{ color: "var(--ide-muted)" }}>{dirName(path)}</span>
              <span className="ide-badge ml-2">{ts.length}</span>
            </div>
            {ts.map((t) => {
              const tk = tickets.find((x) => x.id === t.ticketId);
              return (
                <div
                  key={t.id}
                  className="ide-row pr-2 text-[13px] gap-1.5"
                  style={{ paddingLeft: 30, opacity: t.status === "resolved" ? 0.6 : 1 }}
                  onClick={() => (tk ? ide.openReview(tk.id, tk.number, path) : ide.openFile(path, { line: t.line, preview: true }))}
                  title={t.comments.map((c) => `${c.authorName}: ${c.text}`).join("\n\n")}
                >
                  <MessageSquare size={13} color={t.severity === "error" ? "#f14c4c" : t.severity === "warning" ? "#cca700" : "#3794ff"} />
                  <span className="shrink-0 font-semibold">{t.comments[0]?.authorName}</span>
                  <span className="truncate">{t.comments[0]?.text}</span>
                  <span className="ml-auto pl-2 shrink-0 text-[12px]" style={{ color: "var(--ide-muted)" }}>
                    {tk ? `LUM-${tk.number} · ` : ""}Ln {t.line}
                    {t.outdated ? " · outdated" : ""} · {timeAgo(t.updatedAt)}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
