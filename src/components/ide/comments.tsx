"use client";

import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Monaco as MonacoNs } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Check, ChevronUp, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { toast } from "../Dialogs";
import { useIde, type Thread } from "./ctx";

/** Tiny Markdown: `code`, **bold**, fenced blocks, line breaks. Text only — no HTML. */
export function Md({ text }: { text: string }) {
  const blocks = text.split(/```[a-z]*\n?/);
  return (
    <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.45 }}>
      {blocks.map((b, i) =>
        i % 2 ? (
          <pre key={i} style={{ background: "rgba(128,128,128,.15)", padding: "6px 8px", borderRadius: 4, margin: "4px 0", fontFamily: "Menlo, monospace", fontSize: 12, overflowX: "auto" }}>{b.replace(/\n$/, "")}</pre>
        ) : (
          <span key={i}>
            {b.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((s, j) =>
              s.startsWith("`") && s.endsWith("`") && s.length > 2 ? (
                <code key={j} style={{ background: "rgba(128,128,128,.18)", padding: "0 4px", borderRadius: 3, fontFamily: "Menlo, monospace", fontSize: "0.92em" }}>{s.slice(1, -1)}</code>
              ) : s.startsWith("**") && s.endsWith("**") && s.length > 4 ? (
                <b key={j}>{s.slice(2, -2)}</b>
              ) : (
                <span key={j}>{s}</span>
              ),
            )}
          </span>
        ),
      )}
    </div>
  );
}

const SEV: Record<string, { label: string; color: string }> = {
  error: { label: "Bug", color: "#f14c4c" },
  warning: { label: "Warning", color: "#cca700" },
  info: { label: "Suggestion", color: "#3794ff" },
};

function Avatar({ name, ai }: { name: string; ai?: boolean }) {
  return (
    <span style={{ width: 20, height: 20, borderRadius: 10, display: "inline-grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0, background: ai ? "linear-gradient(135deg,#7c3aed,#db2777)" : "#0078d4" }}>
      {ai ? <Sparkles size={11} /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

interface WidgetProps {
  wsId: string;
  thread?: Thread;
  draft?: { path: string; line: number; ticketId: string | null };
  ticketLabel?: string;
  canEdit: boolean;
  onDone: () => void;
  onCollapse?: () => void;
}

/** One comment thread (or a new-comment draft) rendered inside the editor. */
export function ThreadWidget({ wsId, thread, draft, ticketLabel, canEdit, onDone, onCollapse }: WidgetProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(!!draft);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (draft) setTimeout(() => ta.current?.focus(), 30);
  }, [draft]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/api/workspaces/${wsId}/review`, { method: "POST", json: body });
      setText("");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (!text.trim()) return;
    if (draft) void post({ action: "comment", path: draft.path, line: draft.line, ticketId: draft.ticketId, text });
    else if (thread) void post({ action: "comment", threadId: thread.id, text });
  };
  const sev = thread?.severity ? SEV[thread.severity] : null;
  const resolved = thread?.status === "resolved";

  return (
    <div
      style={{
        margin: "4px 0 6px 0",
        maxWidth: 780,
        border: "1px solid var(--ide-border)",
        borderTop: `2px solid ${sev?.color ?? "#0078d4"}`,
        borderRadius: 6,
        background: "var(--ide-comment)",
        color: "var(--ide-fg)",
        fontSize: 13,
        boxShadow: "0 2px 8px var(--ide-shadow)",
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {thread && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: "1px solid var(--ide-border)", fontSize: 12 }}>
          {sev && <span style={{ color: sev.color, fontWeight: 600 }}>{sev.label}</span>}
          {ticketLabel && <span style={{ opacity: 0.7 }}>{ticketLabel}</span>}
          {thread.outdated && <span style={{ fontSize: 11, padding: "0 5px", borderRadius: 3, background: "rgba(128,128,128,.25)" }}>Outdated</span>}
          {resolved && <span style={{ fontSize: 11, padding: "0 5px", borderRadius: 3, background: "rgba(46,160,67,.25)" }}>Resolved</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {canEdit && (resolved ? (
              <button className="ide-icon-btn" title="Reopen" onClick={() => post({ action: "reopen", threadId: thread.id })}><RotateCcw size={13} /></button>
            ) : (
              <button className="ide-icon-btn" title="Resolve" onClick={() => post({ action: "resolve", threadId: thread.id })}><Check size={14} /></button>
            ))}
            {canEdit && <button className="ide-icon-btn" title="Delete thread" onClick={() => post({ action: "delete", threadId: thread.id })}><Trash2 size={13} /></button>}
            {onCollapse && <button className="ide-icon-btn" title="Collapse" onClick={onCollapse}><ChevronUp size={14} /></button>}
          </span>
        </div>
      )}
      {thread?.comments.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 8, padding: "8px 10px" }}>
          <Avatar name={c.authorName} ai={c.author === "reviewer"} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, marginBottom: 2 }}>
              <b>{c.authorName}</b> <span style={{ opacity: 0.6 }}>{timeAgo(c.createdAt)}</span>
            </div>
            <Md text={c.text} />
          </div>
        </div>
      ))}
      {canEdit && (
        <div style={{ padding: "6px 10px 8px" }}>
          {replying ? (
            <>
              <textarea
                ref={ta}
                className="ide-input"
                rows={3}
                placeholder={draft ? "Add a review comment… (the agent sees it when you request changes)" : "Reply…"}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  if (e.key === "Escape") draft ? onDone() : setReplying(false);
                }}
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
                <button className="ide-btn ide-btn-2" onClick={() => (draft ? onDone() : setReplying(false))}>Cancel</button>
                <button className="ide-btn" disabled={busy || !text.trim()} onClick={submit}>{draft ? "Add Comment" : "Reply"}</button>
              </div>
            </>
          ) : (
            <input className="ide-input" placeholder="Reply…" onFocus={() => setReplying(true)} readOnly />
          )}
        </div>
      )}
    </div>
  );
}

interface ZoneRec {
  zoneId: string;
  zone: editor.IViewZone;
  dom: HTMLDivElement;
  root: Root;
  ro: ResizeObserver;
  line: number;
}

/**
 * Review comments inside a Monaco editor: a "+" in the gutter to start a thread, a colored
 * bar on commented lines, and the thread itself rendered between lines (view zones).
 */
export function useCommentZones(ed: editor.IStandaloneCodeEditor | null, monaco: MonacoNs | null, path: string | null, ticketId: string | null, ticketLabel: (id: string | null) => string | undefined) {
  const ide = useIde();
  const [draft, setDraft] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const zones = useRef(new Map<string, ZoneRec>());
  const theme = ide.monacoTheme;

  // Gutter "+" on hover; click to start a comment.
  useEffect(() => {
    if (!ed || !monaco || !path || !ide.canEdit) return;
    const hover = ed.createDecorationsCollection();
    const T = monaco.editor.MouseTargetType;
    const inGutter = (t: editor.IMouseTarget) => t.type === T.GUTTER_GLYPH_MARGIN || t.type === T.GUTTER_LINE_DECORATIONS;
    const d1 = ed.onMouseMove((e) => {
      const ln = e.target.position?.lineNumber;
      if (ln && (inGutter(e.target) || e.target.type === T.GUTTER_LINE_NUMBERS))
        hover.set([{ range: new monaco.Range(ln, 1, ln, 1), options: { glyphMarginClassName: "ide-comment-glyph", glyphMarginHoverMessage: { value: "Add a review comment" } } }]);
      else hover.clear();
    });
    const d2 = ed.onMouseDown((e) => {
      if (inGutter(e.target) && e.target.position) setDraft(e.target.position.lineNumber);
    });
    const d3 = ed.onMouseLeave(() => hover.clear());
    const act = ed.addAction({
      id: "luma.addComment",
      label: "Add Review Comment",
      contextMenuGroupId: "9_luma",
      contextMenuOrder: 2,
      run: (e: editor.ICodeEditor) => setDraft(e.getPosition()?.lineNumber ?? 1),
    });
    return () => {
      d1.dispose();
      d2.dispose();
      d3.dispose();
      act.dispose();
      hover.clear();
    };
  }, [ed, monaco, path, ide.canEdit]);

  const threads = path ? ide.threads.filter((t) => t.path === path && (t.status === "open" || collapsed[t.id] === false)) : [];
  const key = JSON.stringify(threads.map((t) => [t.id, t.line, t.status, t.comments.length, t.outdated])) + `|${draft}|${JSON.stringify(collapsed)}|${theme}`;

  // Colored bars on commented lines.
  useEffect(() => {
    if (!ed || !monaco) return;
    const deco = ed.createDecorationsCollection(
      threads.map((t) => ({
        range: new monaco.Range(t.line, 1, t.line, 1),
        options: { isWholeLine: true, className: "ide-thread-line", glyphMarginClassName: `ide-thread-glyph sev-${t.severity ?? "info"}`, glyphMarginHoverMessage: { value: `${t.comments.length} comment(s) — click the line's bar to show` } },
      })),
    );
    const d = ed.onMouseDown((e) => {
      const ln = e.target.position?.lineNumber;
      const hit = threads.find((t) => t.line === ln);
      if (hit && collapsed[hit.id] && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        setCollapsed((c) => ({ ...c, [hit.id]: false }));
        setDraft(null);
      }
    });
    return () => {
      deco.clear();
      d.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, monaco, key]);

  // Threads between the lines.
  useEffect(() => {
    if (!ed || !path) return;
    const want = new Map<string, { line: number; el: React.ReactElement }>();
    for (const t of threads) {
      if (collapsed[t.id]) continue;
      want.set(t.id, {
        line: t.line,
        el: <ThreadWidget wsId={ide.wsId} thread={t} ticketLabel={ticketLabel(t.ticketId)} canEdit={ide.canEdit} onDone={() => ide.refreshThreads()} onCollapse={() => setCollapsed((c) => ({ ...c, [t.id]: true }))} />,
      });
    }
    if (draft)
      want.set("draft", {
        line: draft,
        el: <ThreadWidget wsId={ide.wsId} draft={{ path, line: draft, ticketId }} canEdit onDone={() => { setDraft(null); ide.refreshThreads(); }} />,
      });
    const map = zones.current;
    const themeCls = document.querySelector(".ide[data-theme]")?.getAttribute("data-theme") ?? "dark-modern";
    ed.changeViewZones((acc) => {
      for (const [k, z] of map) {
        if (!want.has(k) || want.get(k)!.line !== z.line) {
          acc.removeZone(z.zoneId);
          if (!want.has(k)) {
            z.ro.disconnect();
            const r = z.root;
            setTimeout(() => r.unmount());
            map.delete(k);
          }
        }
      }
      for (const [k, w] of want) {
        let z = map.get(k);
        if (z && z.line === w.line) {
          z.root.render(<div data-theme={themeCls} className="ide" style={{ background: "transparent" }}>{w.el}</div>);
          continue;
        }
        if (!z) {
          const dom = document.createElement("div");
          dom.style.zIndex = "5";
          // React renders into an auto-height child we can measure; Monaco fixes the zone's own height.
          const inner = document.createElement("div");
          inner.style.width = `${Math.max(320, ed.getLayoutInfo().contentWidth - 30)}px`;
          dom.appendChild(inner);
          const root = createRoot(inner);
          const zone: editor.IViewZone = { afterLineNumber: w.line, heightInPx: 120, domNode: dom, suppressMouseDown: true };
          const ro = new ResizeObserver(() => {
            const h = inner.offsetHeight;
            const rec = map.get(k);
            if (!h || !rec || Math.abs((rec.zone.heightInPx ?? 0) - (h + 4)) < 2) return;
            rec.zone.heightInPx = h + 4;
            ed.changeViewZones((a) => a.layoutZone(rec.zoneId));
          });
          ro.observe(inner);
          z = { zoneId: "", zone, dom, root, ro, line: w.line };
          map.set(k, z);
        }
        z.line = w.line;
        z.zone.afterLineNumber = w.line;
        z.zoneId = acc.addZone(z.zone);
        z.root.render(<div data-theme={themeCls} className="ide" style={{ background: "transparent", paddingLeft: 8, paddingRight: 24 }}>{w.el}</div>);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed, path, key]);

  useEffect(() => {
    if (!ed) return;
    const d = ed.onDidLayoutChange((l) => {
      for (const z of zones.current.values()) (z.dom.firstElementChild as HTMLElement | null)?.style.setProperty("width", `${Math.max(320, l.contentWidth - 30)}px`);
    });
    return () => d.dispose();
  }, [ed]);

  // Remove everything when the editor goes away.
  useEffect(
    () => () => {
      const map = zones.current;
      for (const z of map.values()) {
        z.ro.disconnect();
        const r = z.root;
        setTimeout(() => r.unmount());
      }
      map.clear();
    },
    [ed],
  );

  return { startComment: (line: number) => setDraft(line) };
}
