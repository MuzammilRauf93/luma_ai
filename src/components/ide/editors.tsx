"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import type { editor } from "monaco-editor";
import type { OnMount, DiffOnMount } from "@monaco-editor/react";
import {
  ArrowDown, ArrowUp, ChevronRight, Columns2, Eye, ExternalLink, Minus, MoreHorizontal, Plus, RefreshCw, Rows2, Undo2, Sparkles,
  Monitor, Tablet, Smartphone, X, Undo, FileX2,
} from "lucide-react";
import { api } from "@/lib/client";
import { confirmDialog, toast } from "../Dialogs";
import { SimulatorPreview } from "../SimulatorPreview";
import { useWorkspace } from "../WorkspaceProvider";
import { CodeEditor, DiffCodeEditor, defineThemes, langOf } from "./monaco";
import { FileIcon, baseName, kbd, useContextMenu, type MenuItem } from "./bits";
import { useCommentZones } from "./comments";
import { tabTitle, useIde, type Group, type Tab } from "./ctx";
import type { IdeSettings } from "./settings";

const IMAGE = /\.(png|jpe?g|gif|webp|ico|bmp|avif)$/i;
const BINARY = /\.(woff2?|ttf|otf|eot|pdf|zip|gz|mp3|mp4|mov|wasm|jar|keystore)$/i;

export function editorOptions(s: IdeSettings, readOnly = false): editor.IStandaloneEditorConstructionOptions {
  return {
    readOnly,
    fontSize: s["editor.fontSize"],
    fontFamily: s["editor.fontFamily"],
    fontLigatures: s["editor.fontLigatures"],
    lineHeight: s["editor.lineHeight"] || undefined,
    tabSize: s["editor.tabSize"],
    insertSpaces: s["editor.insertSpaces"],
    wordWrap: s["editor.wordWrap"],
    minimap: { enabled: s["editor.minimap.enabled"] },
    lineNumbers: s["editor.lineNumbers"],
    renderWhitespace: s["editor.renderWhitespace"],
    cursorStyle: s["editor.cursorStyle"],
    cursorBlinking: s["editor.cursorBlinking"],
    bracketPairColorization: { enabled: s["editor.bracketPairColorization.enabled"] },
    guides: { bracketPairs: s["editor.guides.bracketPairs"], indentation: true },
    stickyScroll: { enabled: s["editor.stickyScroll.enabled"] },
    smoothScrolling: s["editor.smoothScrolling"],
    formatOnPaste: s["editor.formatOnPaste"],
    multiCursorModifier: s["editor.multiCursorModifier"],
    rulers: s["editor.rulers"],
    renderLineHighlight: s["editor.renderLineHighlight"],
    automaticLayout: true,
    glyphMargin: true,
    fixedOverflowWidgets: true,
    mouseWheelZoom: true,
    scrollBeyondLastLine: true,
    padding: { top: 4 },
  };
}

// ---------------------------------------------------------------- group (tabs + content)

export interface GroupOps {
  activate: (g: number, id: string) => void;
  close: (g: number, ids: string[]) => void;
  pin: (g: number, id: string) => void;
  move: (from: number, id: string, to: number) => void;
  split: (g: number) => void;
  focus: (g: number) => void;
}

export function EditorGroup({ index, group, focused, ops, groupCount }: { index: number; group: Group; focused: boolean; ops: GroupOps; groupCount: number }) {
  const ide = useIde();
  const menu = useContextMenu();
  const [dropping, setDropping] = useState(false);
  const active = group.tabs.find((t) => t.id === group.active) ?? null;
  const dirty = (t: Tab) => (t.kind === "file" || t.kind === "diff" || t.kind === "review") && ide.buffers[t.path] && ide.buffers[t.path].content !== ide.buffers[t.path].saved;

  const tabMenu = (t: Tab): MenuItem[] => {
    const i = group.tabs.indexOf(t);
    const path = "path" in t ? t.path : null;
    return [
      { label: "Close", keys: "Alt+W", onClick: () => ops.close(index, [t.id]) },
      { label: "Close Others", onClick: () => ops.close(index, group.tabs.filter((x) => x.id !== t.id).map((x) => x.id)) },
      { label: "Close to the Right", disabled: i === group.tabs.length - 1, onClick: () => ops.close(index, group.tabs.slice(i + 1).map((x) => x.id)) },
      { label: "Close Saved", onClick: () => ops.close(index, group.tabs.filter((x) => !dirty(x)).map((x) => x.id)) },
      { label: "Close All", onClick: () => ops.close(index, group.tabs.map((x) => x.id)) },
      { sep: true },
      { label: "Copy Path", disabled: !path, onClick: () => path && navigator.clipboard.writeText(path) },
      { label: "Reveal in Explorer View", disabled: !path, onClick: () => { if (path) { void ide.openFile(path, { preview: false }); ide.showView("explorer"); } } },
      { sep: true },
      { label: "Keep Open", disabled: !(t.kind === "file" && t.preview), onClick: () => ops.pin(index, t.id) },
      { label: groupCount > 1 ? "Move to Other Group" : "Split Right", keys: groupCount > 1 ? "" : "Mod+\\", onClick: () => (groupCount > 1 ? ops.move(index, t.id, index === 0 ? 1 : 0) : ops.split(index)) },
    ];
  };

  const onDrop = (e: DragEvent) => {
    setDropping(false);
    const data = e.dataTransfer.getData("application/x-luma-tab");
    if (!data) return;
    const { from, id } = JSON.parse(data) as { from: number; id: string };
    if (from !== index) ops.move(from, id, index);
  };

  return (
    <div className="flex flex-col min-w-0 min-h-0 h-full" onMouseDownCapture={() => ops.focus(index)} style={{ background: "var(--ide-bg)" }}>
      {/* Tabs */}
      <div
        className="flex shrink-0 h-[35px] overflow-x-auto overflow-y-hidden"
        style={{ background: "var(--ide-tab)", borderBottom: "1px solid var(--ide-border)", outline: dropping ? "1px solid var(--ide-focus)" : undefined, outlineOffset: -1 }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-luma-tab")) {
            e.preventDefault();
            setDropping(true);
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        onDoubleClick={(e) => e.target === e.currentTarget && ide.runCommand("file.new")}
      >
        {group.tabs.map((t) => {
          const isActive = t.id === group.active;
          const d = dirty(t);
          return (
            <div
              key={t.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("application/x-luma-tab", JSON.stringify({ from: index, id: t.id }))}
              title={"path" in t ? t.path : tabTitle(t)}
              className="group relative flex items-center gap-1.5 pl-3 pr-1 shrink-0 cursor-pointer select-none"
              style={{
                height: 35,
                maxWidth: 260,
                background: isActive ? "var(--ide-tab-active)" : "transparent",
                color: isActive ? "var(--ide-fg)" : "var(--ide-muted)",
                borderRight: "1px solid var(--ide-border)",
                borderTop: isActive && focused ? "1px solid var(--ide-focus)" : "1px solid transparent",
                marginBottom: isActive ? -1 : 0,
                fontStyle: t.kind === "file" && t.preview ? "italic" : undefined,
              }}
              onClick={() => ops.activate(index, t.id)}
              onDoubleClick={() => ops.pin(index, t.id)}
              onAuxClick={(e) => e.button === 1 && ops.close(index, [t.id])}
              onContextMenu={(e) => menu.open(e, tabMenu(t))}
            >
              <TabIcon tab={t} />
              <span className="truncate">{tabTitle(t)}</span>
              <button
                className={clsx("ide-icon-btn !w-5 !h-5 ml-1", !d && !isActive && "invisible group-hover:visible")}
                onClick={(e) => {
                  e.stopPropagation();
                  ops.close(index, [t.id]);
                }}
                aria-label={`Close ${tabTitle(t)}`}
              >
                {d && <span className="group-hover:hidden" style={{ width: 8, height: 8, borderRadius: 4, background: "currentColor" }} />}
                <X size={14} className={d ? "hidden group-hover:block" : ""} />
              </button>
            </div>
          );
        })}
        <div className="ml-auto flex items-center gap-0.5 px-2 shrink-0 sticky right-0" style={{ background: "var(--ide-tab)" }}>
          {active?.kind === "file" && /\.html?$/.test(active.path) && (
            <button className="ide-icon-btn" title="Open Preview to the Side" onClick={() => ide.openSpecial("preview", true)}><Eye size={15} /></button>
          )}
          {active?.kind === "file" && (
            <button className="ide-icon-btn" title={`Ask an Agent (${kbd("Mod+I")})`} onClick={() => ide.runCommand("luma.askAgent")}><Sparkles size={15} /></button>
          )}
          <button className="ide-icon-btn" title={`Split Editor Right (${kbd("Mod+\\")})`} onClick={() => ops.split(index)}><Columns2 size={15} /></button>
          <button
            className="ide-icon-btn"
            title="More Actions…"
            onClick={(e) =>
              menu.open(e, [
                { label: "Close All", onClick: () => ops.close(index, group.tabs.map((x) => x.id)) },
                { label: "Close Saved", onClick: () => ops.close(index, group.tabs.filter((x) => !dirty(x)).map((x) => x.id)) },
                { sep: true },
                { label: "Save All", keys: "Mod+Alt+S", onClick: () => ide.saveAll() },
              ])
            }
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>
      {active && "path" in active && ide.settings["breadcrumbs.enabled"] && <Breadcrumbs path={active.path} />}
      <div className="flex-1 min-h-0 relative">
        {group.tabs.map((t) => (
          <div key={t.id} className="absolute inset-0" style={{ display: t.id === group.active ? "block" : "none" }}>
            <TabContent tab={t} visible={t.id === group.active} groupIndex={index} />
          </div>
        ))}
        {!active && <Watermark />}
      </div>
      {menu.node}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if ("path" in tab) return <FileIcon path={tab.path} size={14} />;
  const c = { preview: <Eye size={14} color="#3794ff" />, settings: <span style={{ fontSize: 13 }}>⚙</span>, "settings-json": <FileIcon path="settings.json" size={14} />, keybindings: <span style={{ fontSize: 12 }}>⌨</span>, welcome: <span style={{ width: 14, height: 14, borderRadius: 3, background: "linear-gradient(135deg,#7c3aed,#db2777)", display: "inline-block" }} /> };
  return c[tab.kind];
}

function Breadcrumbs({ path }: { path: string }) {
  const ide = useIde();
  const parts = path.split("/");
  return (
    <div className="flex items-center gap-0.5 h-[22px] px-3 shrink-0 text-[12.5px] overflow-hidden" style={{ color: "var(--ide-muted)", background: "var(--ide-bg)" }}>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-0.5 shrink-0">
          {i > 0 && <ChevronRight size={13} style={{ opacity: 0.7 }} />}
          {i === parts.length - 1 && <FileIcon path={p} size={13} />}
          <button className="hover:underline" style={{ color: i === parts.length - 1 ? "var(--ide-fg)" : undefined }} onClick={() => { ide.showView("explorer"); void ide.openFile(path, { preview: false }); }}>
            {p}
          </button>
        </span>
      ))}
    </div>
  );
}

function Watermark() {
  const rows: [string, string][] = [
    ["Show All Commands", "Mod+Shift+P"],
    ["Go to File", "Mod+P"],
    ["Find in Files", "Mod+Shift+F"],
    ["Toggle Terminal", "Ctrl+`"],
    ["Ask an Agent", "Mod+I"],
  ];
  return (
    <div className="absolute inset-0 grid place-content-center gap-3 select-none" style={{ color: "var(--ide-muted)" }}>
      <div className="mx-auto mb-4 w-24 h-24 rounded-3xl opacity-[0.12]" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }} />
      {rows.map(([l, k]) => (
        <div key={l} className="grid grid-cols-[150px_auto] gap-4 text-[13px]">
          <span className="text-right">{l}</span>
          <span style={{ opacity: 0.85 }}>{kbd(k)}</span>
        </div>
      ))}
    </div>
  );
}

function TabContent({ tab, visible, groupIndex }: { tab: Tab; visible: boolean; groupIndex: number }) {
  switch (tab.kind) {
    case "file":
      return <FilePane path={tab.path} tabKey={`${groupIndex}:${tab.id}`} visible={visible} />;
    case "diff":
    case "review":
      return <DiffPane tab={tab} tabKey={`${groupIndex}:${tab.id}`} visible={visible} />;
    case "preview":
      return <PreviewPane />;
    case "welcome":
      return <WelcomePane />;
    default:
      return <SettingsSlot kind={tab.kind} />;
  }
}

// Settings panes are provided by IDE.tsx (avoids a circular import).
let settingsRenderer: ((kind: "settings" | "settings-json" | "keybindings") => React.ReactNode) | null = null;
export function setSettingsRenderer(fn: typeof settingsRenderer) {
  settingsRenderer = fn;
}
function SettingsSlot({ kind }: { kind: "settings" | "settings-json" | "keybindings" }) {
  return <>{settingsRenderer?.(kind)}</>;
}

// ---------------------------------------------------------------- file editor

function useEditorBasics(tabKey: string) {
  const ide = useIde();
  const ideRef = useRef(ide);
  ideRef.current = ide;
  const [ed, setEd] = useState<editor.IStandaloneCodeEditor | null>(null);
  useEffect(() => () => ideRef.current.registerEditor(tabKey, null), [tabKey]);

  const wire = (e: editor.IStandaloneCodeEditor, monaco: Parameters<OnMount>[1]) => {
    setEd(e);
    ideRef.current.registerEditor(tabKey, e);
    const K = monaco.KeyMod;
    const C = monaco.KeyCode;
    const run = (id: string) => () => ideRef.current.runCommand(id);
    // Workbench shortcuts that Monaco would otherwise swallow while the editor has focus.
    e.addAction({ id: "luma.palette", label: "Show All Commands", keybindings: [C.F1, K.CtrlCmd | K.Shift | C.KeyP], run: run("workbench.action.showCommands") });
    e.addAction({ id: "luma.quickOpen", label: "Go to File…", keybindings: [K.CtrlCmd | C.KeyP], run: run("workbench.action.quickOpen") });
    e.addAction({ id: "luma.theme", label: "Color Theme", keybindings: [K.chord(K.CtrlCmd | C.KeyK, K.CtrlCmd | C.KeyT)], run: run("workbench.action.selectTheme") });
    e.addAction({ id: "luma.saveAll", label: "Save All", keybindings: [K.chord(K.CtrlCmd | C.KeyK, C.KeyS), K.CtrlCmd | K.Alt | C.KeyS], run: run("workbench.action.files.saveAll") });
    e.addAction({ id: "luma.zen", label: "Toggle Zen Mode", keybindings: [K.chord(K.CtrlCmd | C.KeyK, C.KeyZ)], run: run("workbench.action.toggleZenMode") });
    e.addAction({ id: "luma.shortcuts", label: "Keyboard Shortcuts", keybindings: [K.chord(K.CtrlCmd | C.KeyK, K.CtrlCmd | C.KeyS)], run: run("workbench.action.openGlobalKeybindings") });
    e.addAction({ id: "luma.closeAll", label: "Close All Editors", keybindings: [K.chord(K.CtrlCmd | C.KeyK, K.CtrlCmd | C.KeyW)], run: run("workbench.action.closeAllEditors") });
    e.addAction({ id: "luma.ask", label: "Ask an Agent…", keybindings: [K.CtrlCmd | C.KeyI], contextMenuGroupId: "9_luma", contextMenuOrder: 1, run: run("luma.askAgent") });
    e.addAction({ id: "luma.aiReviewFile", label: "Review This File with AI", contextMenuGroupId: "9_luma", contextMenuOrder: 3, run: run("luma.aiReviewFile") });
    e.onDidFocusEditorText(() => ideRef.current.registerEditor(tabKey, e));
    e.onDidChangeCursorSelection((ev) => {
      const sel = e.getModel()?.getValueInRange(ev.selection).length ?? 0;
      ideRef.current.setCursor({ line: ev.selection.positionLineNumber, col: ev.selection.positionColumn, sel });
    });
  };
  return { ed, wire, ide };
}

function FilePane({ path, tabKey, visible }: { path: string; tabKey: string; visible: boolean }) {
  const { ed, wire, ide } = useEditorBasics(tabKey);
  const { tickets } = useWorkspace();
  const buf = ide.buffers[path];
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (IMAGE.test(path) || BINARY.test(path) || ide.buffers[path]) return;
    ide.ensureBuffer(path).then((b) => setMissing(!b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // Jump to a line (search results, problems, comments).
  useEffect(() => {
    const r = ide.reveal;
    if (!ed || !r || r.path !== path || !visible) return;
    const col = r.col ?? 1;
    ed.setSelection({ startLineNumber: r.line, startColumn: col, endLineNumber: r.line, endColumn: r.endCol ?? col });
    ed.revealLineInCenterIfOutsideViewport(r.line);
    ed.focus();
  }, [ed, ide.reveal, path, visible]);
  useEffect(() => {
    if (visible && ed) setTimeout(() => ed.layout(), 0);
  }, [visible, ed]);

  const label = (id: string | null) => (id ? `LUM-${tickets.find((t) => t.id === id)?.number ?? "?"}` : undefined);
  useCommentZones(ed, ide.monaco, buf ? path : null, null, label);

  if (IMAGE.test(path))
    return (
      <div className="h-full grid place-items-center overflow-auto p-6" style={{ background: "repeating-conic-gradient(rgba(128,128,128,.12) 0 25%, transparent 0 50%) 0 0/16px 16px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/preview/${ide.wsId}/${path.split("/").map(encodeURIComponent).join("/")}`} alt={path} style={{ maxWidth: "100%", imageRendering: "auto" }} />
      </div>
    );
  if (BINARY.test(path)) return <div className="p-6 text-[13px]" style={{ color: "var(--ide-muted)" }}>The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.</div>;
  if (missing) return <div className="p-6 text-[13px]" style={{ color: "var(--ide-muted)" }}>Unable to open “{baseName(path)}”: the file no longer exists.</div>;
  if (!buf) return null;
  return (
    <CodeEditor
      path={path}
      language={langOf(path)}
      value={buf.content}
      theme={ide.monacoTheme}
      keepCurrentModel
      options={editorOptions(ide.settings, !ide.canEdit)}
      beforeMount={(m) => {
        defineThemes(m);
        ide.setMonaco(m);
      }}
      onMount={wire}
      onChange={(v) => ide.setBuffer(path, v ?? "")}
    />
  );
}

// ---------------------------------------------------------------- diff editor (source control + review)

function DiffPane({ tab, tabKey, visible }: { tab: Extract<Tab, { kind: "diff" | "review" }>; tabKey: string; visible: boolean }) {
  const { ide, wire, ed } = useEditorBasics(tabKey);
  const { tickets, reload } = useWorkspace();
  const [original, setOriginal] = useState<string | null>(null);
  const [staged, setStaged] = useState<string | null>(null);
  const [exists, setExists] = useState(true);
  const [ver, setVer] = useState(0);
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const path = tab.path;
  const ticket = tab.kind === "review" ? tickets.find((t) => t.id === tab.ticketId) : undefined;
  const viewed = tab.kind === "review" && !!ticket?.review?.viewed?.includes(path);
  const buf = ide.buffers[path];
  const sideBySide = ide.settings["diffEditor.renderSideBySide"];

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (tab.kind === "review") {
          const d = await api<{ before: string | null }>(`/api/workspaces/${ide.wsId}/diff?ticketId=${tab.ticketId}&path=${encodeURIComponent(path)}`);
          if (!off) setOriginal(d.before ?? "");
        } else {
          const head = await api<{ content: string | null }>(`/api/workspaces/${ide.wsId}/scm?path=${encodeURIComponent(path)}&ref=HEAD`);
          if (off) return;
          setOriginal(head.content ?? "");
          if (tab.source === "staged") {
            const idx = await api<{ content: string | null }>(`/api/workspaces/${ide.wsId}/scm?path=${encodeURIComponent(path)}&ref=INDEX`);
            if (!off) setStaged(idx.content ?? "");
          }
        }
        if (tab.kind === "review" || tab.source === "working") {
          const b = await ide.ensureBuffer(path);
          if (!off) setExists(!!b);
        }
      } catch (e) {
        toast((e as Error).message, "error");
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, ver, ide.scm]);

  useEffect(() => {
    if (visible && ed) setTimeout(() => diffRef.current?.layout(), 0);
  }, [visible, ed]);

  const label = (id: string | null) => (id ? `LUM-${tickets.find((t) => t.id === id)?.number ?? "?"}` : undefined);
  const editable = tab.kind === "review" || tab.source === "working";
  useCommentZones(ed, ide.monaco, editable && exists ? path : null, tab.kind === "review" ? tab.ticketId : null, label);

  const onMount: DiffOnMount = (d, monaco) => {
    diffRef.current = d;
    const mod = d.getModifiedEditor();
    wire(mod, monaco);
    if (editable) mod.onDidChangeModelContent(() => ide.setBuffer(path, mod.getValue()));
  };

  /** Put one change block back the way it was (like the arrow in VS Code's diff gutter). */
  const revertHunk = () => {
    const d = diffRef.current;
    const changes = d?.getLineChanges();
    const mod = d?.getModifiedEditor();
    const orig = d?.getOriginalEditor().getModel();
    if (!d || !changes?.length || !mod || !orig) return;
    const line = mod.getPosition()?.lineNumber ?? 1;
    const c =
      changes.find((x) => (x.modifiedEndLineNumber === 0 ? line === x.modifiedStartLineNumber : line >= x.modifiedStartLineNumber && line <= x.modifiedEndLineNumber)) ??
      changes.find((x) => x.modifiedStartLineNumber >= line) ??
      changes[changes.length - 1];
    const model = mod.getModel()!;
    const origText = c.originalEndLineNumber === 0 ? "" : orig.getValueInRange({ startLineNumber: c.originalStartLineNumber, startColumn: 1, endLineNumber: c.originalEndLineNumber, endColumn: orig.getLineMaxColumn(c.originalEndLineNumber) });
    let range;
    let text;
    if (c.modifiedEndLineNumber === 0) {
      // Lines were deleted: insert them back after modifiedStartLineNumber.
      const after = c.modifiedStartLineNumber;
      range = after === 0 ? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } : { startLineNumber: after, startColumn: model.getLineMaxColumn(after), endLineNumber: after, endColumn: model.getLineMaxColumn(after) };
      text = after === 0 ? origText + "\n" : "\n" + origText;
    } else if (c.originalEndLineNumber === 0) {
      // Lines were added: remove them.
      const s = c.modifiedStartLineNumber;
      const e = c.modifiedEndLineNumber;
      range = e < model.getLineCount() ? { startLineNumber: s, startColumn: 1, endLineNumber: e + 1, endColumn: 1 } : { startLineNumber: Math.max(1, s - 1), startColumn: s > 1 ? model.getLineMaxColumn(s - 1) : 1, endLineNumber: e, endColumn: model.getLineMaxColumn(e) };
      text = "";
    } else {
      range = { startLineNumber: c.modifiedStartLineNumber, startColumn: 1, endLineNumber: c.modifiedEndLineNumber, endColumn: model.getLineMaxColumn(c.modifiedEndLineNumber) };
      text = origText;
    }
    mod.pushUndoStop();
    mod.executeEdits("luma.revertHunk", [{ range, text }]);
    mod.pushUndoStop();
    toast("Change reverted — save to keep it", "info");
  };

  const markViewed = async (v: boolean) => {
    if (tab.kind !== "review") return;
    await api(`/api/workspaces/${ide.wsId}/review`, { method: "POST", json: { action: "viewed", ticketId: tab.ticketId, path, viewed: v } }).catch((e) => toast(e.message, "error"));
    reload();
  };
  const rejectFile = async () => {
    if (tab.kind !== "review") return;
    if (!(await confirmDialog({ title: `Reject all of LUM-${tab.ticketNumber}'s changes to ${baseName(path)}?`, body: "The file goes back to how it was before this ticket. You can undo this from History.", confirmLabel: "Reject changes", danger: true }))) return;
    await api(`/api/workspaces/${ide.wsId}/checkpoints`, { method: "POST", json: { ticketId: tab.ticketId, path } });
    ide.log("Code Review", `Rejected LUM-${tab.ticketNumber}'s changes to ${path}`);
    setVer((v) => v + 1);
  };
  const aiReview = async () => {
    if (tab.kind !== "review") return;
    ide.log("Code Review", `AI reviewing ${path} (LUM-${tab.ticketNumber})…`);
    toast("Reviewing with AI…", "info");
    try {
      const r = await api<{ summary: string; comments: number }>(`/api/workspaces/${ide.wsId}/review`, { method: "POST", json: { action: "ai", ticketId: tab.ticketId, path } });
      ide.log("Code Review", `${r.summary} (${r.comments} comments)`);
      toast(`AI review: ${r.comments} comment${r.comments === 1 ? "" : "s"}`);
      ide.refreshThreads();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const scmAction = async (action: "stage" | "unstage" | "discard") => {
    if (action === "discard" && !(await confirmDialog({ title: `Discard changes in ${baseName(path)}?`, body: "This is permanent for uncommitted work (Luma's History still keeps a copy).", confirmLabel: "Discard File", danger: true }))) return;
    await api(`/api/workspaces/${ide.wsId}/scm`, { method: "POST", json: { action, paths: [path] } }).catch((e) => toast(e.message, "error"));
    await ide.refreshScm();
  };

  if (original === null || (tab.kind === "diff" && tab.source === "staged" && staged === null)) return <div className="p-4 text-[13px]" style={{ color: "var(--ide-muted)" }}>Loading changes…</div>;
  const modified = tab.kind === "diff" && tab.source === "staged" ? staged ?? "" : exists ? buf?.content ?? "" : "";
  const modifiedPath = tab.kind === "diff" && tab.source === "staged" ? `inmemory://index/${encodeURIComponent(path)}` : exists ? path : `inmemory://deleted/${encodeURIComponent(path)}`;
  const dirtyFile = buf && buf.content !== buf.saved;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 h-[30px] px-3 shrink-0 text-[12px]" style={{ borderBottom: "1px solid var(--ide-border)", background: "var(--ide-bg)", color: "var(--ide-muted)" }}>
        <span className="truncate">
          {tab.kind === "review" ? (
            <>
              <b style={{ color: "var(--ide-fg)" }}>LUM-{tab.ticketNumber}</b> {ticket?.title} — before ↔ now
            </>
          ) : tab.source === "staged" ? "Last commit ↔ Staged" : "Last commit ↔ Working tree"}
          {!exists && " (deleted)"}
        </span>
        <span className="ml-auto flex items-center gap-0.5 shrink-0">
          <button className="ide-icon-btn" title="Previous Change (Shift+Alt+F5)" onClick={() => diffRef.current?.goToDiff("previous")}><ArrowUp size={14} /></button>
          <button className="ide-icon-btn" title="Next Change (Alt+F5)" onClick={() => diffRef.current?.goToDiff("next")}><ArrowDown size={14} /></button>
          {editable && exists && <button className="ide-icon-btn" title="Revert This Change (at the cursor)" onClick={revertHunk}><Undo2 size={14} /></button>}
          <button className="ide-icon-btn" title={sideBySide ? "Inline View" : "Side by Side View"} onClick={() => ide.updateSettings({ "diffEditor.renderSideBySide": !sideBySide })}>{sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}</button>
          {dirtyFile && <button className="ide-btn !py-0.5 !px-2 !text-[12px] ml-1" onClick={() => ide.save(path)}>Save</button>}
          {tab.kind === "review" && ide.canEdit && (
            <>
              <span style={{ width: 1, height: 16, background: "var(--ide-border)", margin: "0 4px" }} />
              <button className="ide-icon-btn !w-auto px-1.5 gap-1 !flex items-center" title="AI review of this file" onClick={aiReview}><Sparkles size={13} /> AI Review</button>
              <button className="ide-icon-btn !w-auto px-1.5 gap-1 !flex items-center" title="Reject this ticket's changes to the file" onClick={rejectFile}><FileX2 size={13} /> Reject</button>
              <label className="flex items-center gap-1 px-1.5 cursor-pointer select-none" style={{ color: viewed ? "var(--ide-fg)" : undefined }}>
                <input type="checkbox" checked={viewed} onChange={(e) => markViewed(e.target.checked)} /> Viewed
              </label>
            </>
          )}
          {tab.kind === "diff" && ide.canEdit && (
            tab.source === "staged" ? (
              <button className="ide-icon-btn" title="Unstage Changes" onClick={() => scmAction("unstage")}><Minus size={14} /></button>
            ) : (
              <>
                <button className="ide-icon-btn" title="Discard Changes" onClick={() => scmAction("discard")}><Undo size={14} /></button>
                <button className="ide-icon-btn" title="Stage Changes" onClick={() => scmAction("stage")}><Plus size={14} /></button>
              </>
            )
          )}
          {tab.kind === "diff" && <button className="ide-icon-btn" title="Open File" onClick={() => ide.openFile(path, { preview: false })}><ExternalLink size={13} /></button>}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <DiffCodeEditor
          original={original}
          modified={modified}
          language={langOf(path)}
          originalModelPath={`inmemory://original/${encodeURIComponent(tab.id)}/${ver}`}
          modifiedModelPath={modifiedPath}
          keepCurrentModifiedModel
          keepCurrentOriginalModel
          theme={ide.monacoTheme}
          beforeMount={(m) => {
            defineThemes(m);
            ide.setMonaco(m);
          }}
          onMount={onMount}
          options={{
            ...editorOptions(ide.settings, !editable || !exists || !ide.canEdit),
            renderSideBySide: sideBySide,
            ignoreTrimWhitespace: ide.settings["diffEditor.ignoreTrimWhitespace"],
            renderMarginRevertIcon: true,
            originalEditable: false,
            enableSplitViewResizing: true,
            useInlineViewWhenSpaceIsLimited: true,
            renderGutterMenu: false,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- preview

function PreviewPane() {
  const ide = useIde();
  const { workspace } = useWorkspace();
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [page, setPage] = useState("");
  const [n, setN] = useState(0);
  const html = useMemo(() => ide.files.filter((f) => /\.html?$/.test(f.path)), [ide.files]);
  const isFlutter = workspace?.platform === "flutter" || ide.files.some((f) => f.path === "pubspec.yaml");
  if (isFlutter) return <SimulatorPreview workspaceId={ide.wsId} />;
  const src = `/preview/${ide.wsId}/${page}`;
  const width = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 h-[30px] px-2 shrink-0" style={{ borderBottom: "1px solid var(--ide-border)" }}>
        <button className="ide-icon-btn" title="Reload" onClick={() => setN((x) => x + 1)}><RefreshCw size={13} /></button>
        <select className="ide-input !w-auto !py-0 !text-[12px] max-w-[220px]" value={page} onChange={(e) => setPage(e.target.value)}>
          {html.map((f) => (
            <option key={f.path} value={f.path === "index.html" ? "" : f.path}>/{f.path === "index.html" ? "" : f.path}</option>
          ))}
        </select>
        <span className="ml-auto flex">
          {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
            <button key={d} className={clsx("ide-icon-btn", device === d && "is-on")} onClick={() => setDevice(d)} title={d}><Icon size={13} /></button>
          ))}
          <a className="ide-icon-btn" href={src} target="_blank" rel="noreferrer" title="Open in Browser"><ExternalLink size={13} /></a>
        </span>
      </div>
      <div className="flex-1 min-h-0 flex justify-center overflow-auto" style={{ background: width ? "var(--ide-side)" : "#fff" }}>
        <iframe key={`${n}-${ide.previewVersion}`} src={src} title="Preview" className="h-full border-0 bg-white" style={{ width: width ?? "100%", boxShadow: width ? "0 0 0 1px var(--ide-border)" : undefined }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- welcome

function WelcomePane() {
  const ide = useIde();
  const start: [string, string, string][] = [
    ["New File…", "file.new", "Mod+Alt+N"],
    ["Go to File…", "workbench.action.quickOpen", "Mod+P"],
    ["Show All Commands", "workbench.action.showCommands", "Mod+Shift+P"],
    ["Open Settings", "workbench.action.openSettings", "Mod+,"],
    ["Import VS Code Settings…", "workbench.action.openSettingsJson", ""],
  ];
  const tips: [string, string][] = [
    ["Review what your agents changed", "Open Code Review in the activity bar, read the diff, comment on lines, then Approve or Request Changes."],
    ["Ask an agent about the code", "Select code and press " + kbd("Mod+I") + "."],
    ["Same shortcuts as VS Code", "Multi-cursor, Find/Replace, Go to Line (" + kbd("Ctrl+G") + "), Format (" + kbd("Shift+Alt+F") + "), Comment (" + kbd("Mod+/") + ")."],
  ];
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-10 py-14">
        <h1 className="text-[32px] font-light" style={{ color: "var(--ide-fg)" }}>Luma Code</h1>
        <p className="text-[17px] mb-10" style={{ color: "var(--ide-muted)" }}>Editing evolved — with an AI team</p>
        <div className="grid sm:grid-cols-2 gap-10">
          <div>
            <h2 className="text-[19px] font-light mb-2">Start</h2>
            {start.map(([l, id, k]) => (
              <button key={id} className="flex items-center gap-2 py-1 text-[13px] hover:underline" style={{ color: "#3794ff" }} onClick={() => ide.runCommand(id)}>
                {l} {k && <span style={{ color: "var(--ide-muted)" }}>{kbd(k)}</span>}
              </button>
            ))}
          </div>
          <div>
            <h2 className="text-[19px] font-light mb-2">Walkthroughs</h2>
            {tips.map(([t, d]) => (
              <div key={t} className="rounded-md p-3 mb-2" style={{ background: "var(--ide-side)", border: "1px solid var(--ide-border)" }}>
                <div className="text-[13px] font-semibold">{t}</div>
                <div className="text-[12.5px] mt-0.5" style={{ color: "var(--ide-muted)" }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
