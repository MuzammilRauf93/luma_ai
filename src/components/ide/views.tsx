"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKE } from "react";
import clsx from "clsx";
import {
  CaseSensitive, Check, ChevronDown, ChevronRight, ChevronsDownUp, CloudDownload, CloudUpload, Ellipsis, ExternalLink, FilePlus2, FolderPlus,
  GitBranch, ListFilter, Minus, Plus, Regex, RefreshCw, Replace, ReplaceAll, Sparkles, Undo, WholeWord, X, FolderOpen, Folder,
} from "lucide-react";
import { api, agentById, STATUS_STYLE, timeAgo } from "@/lib/client";
import { confirmDialog, toast } from "../Dialogs";
import { useWorkspace } from "../WorkspaceProvider";
import { DiffModal } from "../DiffViewer";
import type { Checkpoint } from "@/lib/types";
import { FileIcon, Section, baseName, dirName, kbd, useContextMenu, type MenuItem } from "./bits";
import { useIde, type ScmChange } from "./ctx";

const SCM_COLOR: Record<string, string> = { M: "var(--ide-modified)", A: "var(--ide-added)", U: "var(--ide-untracked)", D: "var(--ide-deleted)", R: "var(--ide-added)", C: "var(--ide-added)" };

function ViewTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center h-[35px] pl-5 pr-2 shrink-0 text-[11px] uppercase tracking-wide" style={{ color: "var(--ide-fg)" }}>
      <span className="truncate">{title}</span>
      <span className="ml-auto flex gap-0.5">{children}</span>
    </div>
  );
}

// ================================================================ EXPLORER

interface Row {
  kind: "dir" | "file";
  path: string;
  name: string;
  depth: number;
}
type Edit = { mode: "new-file" | "new-folder"; dir: string } | { mode: "rename"; path: string; isDir: boolean } | null;

export function ExplorerView() {
  const ide = useIde();
  const menu = useContextMenu();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [edit, setEdit] = useState<Edit>(null);
  const [sections, setSections] = useState({ editors: false, files: true, timeline: false });
  const listRef = useRef<HTMLDivElement>(null);

  // Expand top-level folders the first time files arrive.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !ide.files.length) return;
    seeded.current = true;
    const top = new Set<string>();
    for (const f of ide.files) if (f.path.includes("/") && ide.files.length < 40) top.add(f.path.split("/")[0]);
    setOpen(top);
  }, [ide.files]);

  // Auto-reveal the active editor's file.
  useEffect(() => {
    const p = ide.activePath;
    if (!p) return;
    setSel(p);
    const parts = p.split("/");
    if (parts.length > 1)
      setOpen((o) => {
        const n = new Set(o);
        for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join("/"));
        return n;
      });
    setTimeout(() => listRef.current?.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: "nearest" }), 30);
  }, [ide.activePath, ide.revealPath]);

  const rows = useMemo(() => {
    interface Node { dirs: Map<string, Node>; files: string[] }
    const root: Node = { dirs: new Map(), files: [] };
    for (const f of ide.files) {
      const parts = f.path.split("/");
      let n = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [] });
        n = n.dirs.get(parts[i])!;
      }
      if (parts[parts.length - 1] !== ".gitkeep") n.files.push(f.path);
    }
    const out: Row[] = [];
    const walk = (n: Node, prefix: string, depth: number) => {
      for (const [name, child] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
        const p = prefix ? `${prefix}/${name}` : name;
        out.push({ kind: "dir", path: p, name, depth });
        if (open.has(p)) walk(child, p, depth + 1);
      }
      for (const f of n.files.sort((a, b) => baseName(a).localeCompare(baseName(b)))) out.push({ kind: "file", path: f, name: baseName(f), depth });
    };
    walk(root, "", 0);
    return out;
  }, [ide.files, open]);

  const scmMap = useMemo(() => {
    const m = new Map<string, string>();
    if (ide.scm?.repo) for (const c of [...ide.scm.staged, ...ide.scm.changes]) if (!m.has(c.path) || c.status !== "M") m.set(c.path, c.status);
    return m;
  }, [ide.scm]);
  const dirStatus = (d: string) => {
    for (const [p, s] of scmMap) if (p.startsWith(d + "/")) return s === "D" ? "D" : "M";
    return null;
  };

  const toggle = (p: string) => setOpen((o) => (o.has(p) ? new Set([...o].filter((x) => x !== p)) : new Set(o).add(p)));
  const selectedRow = rows.find((r) => r.path === sel);
  const targetDir = selectedRow ? (selectedRow.kind === "dir" ? selectedRow.path : dirName(selectedRow.path)) : "";
  const startNew = (mode: "new-file" | "new-folder", dir = targetDir) => {
    if (dir) setOpen((o) => new Set(o).add(dir));
    setSections((s) => ({ ...s, files: true }));
    setEdit({ mode, dir });
  };

  useEffect(() => {
    const h = (e: Event) => startNew((e as CustomEvent).detail === "folder" ? "new-folder" : "new-file");
    window.addEventListener("luma-ide:new", h);
    return () => window.removeEventListener("luma-ide:new", h);
  });

  const commit = async (value: string) => {
    const e = edit;
    setEdit(null);
    const v = value.trim().replace(/^\/+|\/+$/g, "");
    if (!e || !v) return;
    try {
      if (e.mode === "rename") {
        const to = dirName(e.path) ? `${dirName(e.path)}/${v}` : v;
        if (to !== e.path) await ide.renameEntry(e.path, to, e.isDir);
      } else await ide.createEntry(e.dir, e.mode === "new-file" ? "file" : "folder", v);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const fileMenu = (r: Row): MenuItem[] =>
    r.kind === "file"
      ? [
          { label: "Open to the Side", keys: "Mod+Enter", onClick: () => ide.openFile(r.path, { side: true }) },
          ...(/\.html?$/.test(r.path) ? [{ label: "Open Preview", onClick: () => ide.openSpecial("preview", true) }] : []),
          ...(ide.scm?.repo && scmMap.has(r.path) ? [{ label: "Open Changes", onClick: () => ide.openDiff(r.path, "working") }] : []),
          { sep: true },
          { label: "Ask an Agent About This File…", disabled: !ide.canEdit, onClick: () => ide.askAgent(r.path) },
          { label: "Review File with AI", disabled: !ide.canEdit, onClick: () => { void ide.openFile(r.path, { preview: false }); setTimeout(() => ide.runCommand("luma.aiReviewFile"), 50); } },
          { sep: true },
          { label: "Copy Path", keys: "Alt+Mod+C", onClick: () => navigator.clipboard.writeText(r.path) },
          { label: "Copy Name", onClick: () => navigator.clipboard.writeText(r.name) },
          { sep: true },
          { label: "Rename…", keys: "F2", disabled: !ide.canEdit, onClick: () => setEdit({ mode: "rename", path: r.path, isDir: false }) },
          { label: "Delete", keys: "Delete", disabled: !ide.canEdit, onClick: () => ide.deleteEntry(r.path, false) },
        ]
      : [
          { label: "New File…", disabled: !ide.canEdit, onClick: () => startNew("new-file", r.path) },
          { label: "New Folder…", disabled: !ide.canEdit, onClick: () => startNew("new-folder", r.path) },
          { label: "Find in Folder…", onClick: () => window.dispatchEvent(new CustomEvent("luma-ide:find-in", { detail: r.path })) },
          { sep: true },
          { label: "Copy Path", onClick: () => navigator.clipboard.writeText(r.path) },
          { sep: true },
          { label: "Rename…", keys: "F2", disabled: !ide.canEdit, onClick: () => setEdit({ mode: "rename", path: r.path, isDir: true }) },
          { label: "Delete", keys: "Delete", disabled: !ide.canEdit, onClick: () => ide.deleteEntry(r.path, true) },
        ];

  const onKey = (e: RKE) => {
    if (edit) return;
    const i = rows.findIndex((r) => r.path === sel);
    const r = rows[i];
    if (e.key === "ArrowDown") setSel(rows[Math.min(rows.length - 1, i + 1)]?.path ?? null);
    else if (e.key === "ArrowUp") setSel(rows[Math.max(0, i - 1)]?.path ?? null);
    else if (e.key === "ArrowRight" && r?.kind === "dir") open.has(r.path) ? setSel(rows[i + 1]?.path ?? r.path) : toggle(r.path);
    else if (e.key === "ArrowLeft" && r) {
      if (r.kind === "dir" && open.has(r.path)) toggle(r.path);
      else setSel(dirName(r.path) || r.path);
    } else if (e.key === "Enter" && r) r.kind === "dir" ? toggle(r.path) : ide.openFile(r.path, { preview: false, side: e.metaKey || e.ctrlKey });
    else if (e.key === " " && r?.kind === "file") ide.openFile(r.path, { preview: true });
    else if (e.key === "F2" && r && ide.canEdit) setEdit({ mode: "rename", path: r.path, isDir: r.kind === "dir" });
    else if ((e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) && r && ide.canEdit) ide.deleteEntry(r.path, r.kind === "dir");
    else return;
    e.preventDefault();
  };

  const inputRow = (depth: number, initial: string, icon: React.ReactNode) => (
    <div className="flex items-center h-[22px] pr-2" style={{ paddingLeft: 8 + depth * 8 + 16 }}>
      {icon}
      <input
        autoFocus
        className="ide-input !py-0 !h-[20px] ml-1.5"
        defaultValue={initial}
        onFocus={(e) => {
          const dot = initial.lastIndexOf(".");
          e.currentTarget.setSelectionRange(0, dot > 0 ? dot : initial.length);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e.currentTarget.value);
          if (e.key === "Escape") setEdit(null);
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
      />
    </div>
  );

  const indent = (d: number) => 8 + d * 8;
  const editors = useOpenEditors();

  return (
    <div className="flex flex-col h-full min-h-0">
      <ViewTitle title="Explorer">
        <button className="ide-icon-btn" title="More Actions…" onClick={(e) => menu.open(e, [{ label: "Open Editors", onClick: () => setSections((s) => ({ ...s, editors: !s.editors })) }])}><Ellipsis size={15} /></button>
      </ViewTitle>
      <Section title="Open Editors" open={sections.editors} onToggle={() => setSections((s) => ({ ...s, editors: !s.editors }))} actions={<button className="ide-icon-btn" title="Save All" onClick={() => ide.saveAll()}><Check size={14} /></button>}>
        <div className="pb-1">
          {editors.map((t) => (
            <div key={t.key} className="ide-row pr-2 group" style={{ paddingLeft: 20 }} onClick={t.open}>
              <button className="ide-icon-btn !w-4 !h-4 mr-1 invisible group-hover:visible" onClick={(e) => { e.stopPropagation(); t.close(); }}><X size={12} /></button>
              {t.path ? <FileIcon path={t.path} size={14} /> : null}
              <span className="ml-1.5 truncate">{t.title}</span>
              {t.path && dirName(t.path) && <span className="ml-1.5 truncate text-[12px]" style={{ color: "var(--ide-muted)" }}>{dirName(t.path)}</span>}
              {t.dirty && <span className="ml-auto w-2 h-2 rounded-full" style={{ background: "var(--ide-fg)" }} />}
            </div>
          ))}
        </div>
      </Section>
      <Section
        title={ide.workspaceName}
        grow
        open={sections.files}
        onToggle={() => setSections((s) => ({ ...s, files: !s.files }))}
        actions={
          <>
            {ide.canEdit && <button className="ide-icon-btn" title="New File…" onClick={() => startNew("new-file")}><FilePlus2 size={15} /></button>}
            {ide.canEdit && <button className="ide-icon-btn" title="New Folder…" onClick={() => startNew("new-folder")}><FolderPlus size={15} /></button>}
            <button className="ide-icon-btn" title="Refresh Explorer" onClick={() => ide.loadFiles()}><RefreshCw size={14} /></button>
            <button className="ide-icon-btn" title="Collapse Folders in Explorer" onClick={() => setOpen(new Set())}><ChevronsDownUp size={15} /></button>
          </>
        }
      >
        <div
          ref={listRef}
          tabIndex={0}
          className={clsx("outline-none min-h-full pb-6", focus && "ide-list-focus")}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={onKey}
          onContextMenu={(e) => ide.canEdit && menu.open(e, [{ label: "New File…", onClick: () => startNew("new-file", "") }, { label: "New Folder…", onClick: () => startNew("new-folder", "") }])}
        >
          {edit && edit.mode !== "rename" && edit.dir === "" && inputRow(0, "", edit.mode === "new-folder" ? <Folder size={15} color="#dcb67a" /> : <FileIcon path="x" />)}
          {rows.map((r) => {
            const st = r.kind === "file" ? scmMap.get(r.path) : dirStatus(r.path);
            if (edit?.mode === "rename" && edit.path === r.path) return <div key={r.path}>{inputRow(r.depth, r.name, r.kind === "dir" ? <Folder size={15} color="#dcb67a" /> : <FileIcon path={r.path} />)}</div>;
            return (
              <div key={r.path}>
                <div
                  data-path={r.path}
                  className={clsx("ide-row pr-2", sel === r.path && "is-active")}
                  style={{ paddingLeft: indent(r.depth), color: st ? SCM_COLOR[st] : undefined, textDecoration: st === "D" ? "line-through" : undefined }}
                  onClick={(e) => {
                    setSel(r.path);
                    if (r.kind === "dir") toggle(r.path);
                    else ide.openFile(r.path, { preview: !(e.metaKey || e.ctrlKey), side: e.metaKey || e.ctrlKey });
                  }}
                  onDoubleClick={() => r.kind === "file" && ide.openFile(r.path, { preview: false })}
                  onContextMenu={(e) => {
                    setSel(r.path);
                    menu.open(e, fileMenu(r));
                  }}
                >
                  <span className="w-4 shrink-0 grid place-items-center" style={{ color: "var(--ide-fg)" }}>
                    {r.kind === "dir" ? open.has(r.path) ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
                  </span>
                  {r.kind === "dir" ? open.has(r.path) ? <FolderOpen size={15} color="#dcb67a" className="shrink-0" /> : <Folder size={15} color="#dcb67a" className="shrink-0" /> : <FileIcon path={r.path} />}
                  <span className="ml-1.5 truncate">{r.name}</span>
                  {st && <span className="ml-auto pl-2 text-[11px] font-semibold">{r.kind === "file" ? st : "●"}</span>}
                </div>
                {edit && edit.mode !== "rename" && edit.dir === r.path && r.kind === "dir" && inputRow(r.depth + 1, "", edit.mode === "new-folder" ? <Folder size={15} color="#dcb67a" /> : <FileIcon path="x" />)}
              </div>
            );
          })}
          {!ide.files.length && <p className="px-5 py-3 text-[13px]" style={{ color: "var(--ide-muted)" }}>This workspace has no files yet.</p>}
        </div>
      </Section>
      <Section title="Timeline" open={sections.timeline} onToggle={() => setSections((s) => ({ ...s, timeline: !s.timeline }))}>
        <Timeline path={ide.activePath} />
      </Section>
      {menu.node}
    </div>
  );
}

/** VS Code's Timeline view: every saved change to the active file (yours and the agents'). */
function Timeline({ path }: { path: string | null }) {
  const ide = useIde();
  const { agents, openTicket } = useWorkspace();
  const menu = useContextMenu();
  const [list, setList] = useState<Checkpoint[] | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return setList(null);
    api<{ checkpoints: Checkpoint[] }>(`/api/workspaces/${ide.wsId}/checkpoints?path=${encodeURIComponent(path)}`).then((d) => setList(d.checkpoints)).catch(() => setList([]));
  }, [path, ide.wsId, ide.previewVersion]);
  const restore = async (cp: Checkpoint) => {
    if (!(await confirmDialog({ title: `Restore ${baseName(cp.path)} to before this change?`, confirmLabel: "Restore" }))) return;
    await api(`/api/workspaces/${ide.wsId}/checkpoints`, { method: "POST", json: { checkpointId: cp.id } }).catch((e) => toast(e.message, "error"));
  };
  if (!path) return <p className="px-5 py-1 text-[12.5px]" style={{ color: "var(--ide-muted)" }}>The active editor cannot provide timeline information.</p>;
  return (
    <div className="max-h-[220px] overflow-auto pb-1">
      {list?.length === 0 && <p className="px-5 py-1 text-[12.5px]" style={{ color: "var(--ide-muted)" }}>No changes recorded yet.</p>}
      {list?.map((cp) => {
        const who = cp.actor === "user" ? "You" : agentById(agents, cp.actor)?.name ?? "Agent";
        const what = cp.beforeBlob === null ? "created" : cp.afterBlob === null ? "deleted" : "edited";
        return (
          <div
            key={cp.id}
            className="ide-row pr-2 text-[13px]"
            style={{ paddingLeft: 20 }}
            onClick={() => setDiff(cp.id)}
            onContextMenu={(e) => menu.open(e, [{ label: "Open Changes", onClick: () => setDiff(cp.id) }, { label: "Restore Contents Before This Change", disabled: !ide.canEdit, onClick: () => restore(cp) }, ...(cp.ticketId ? [{ label: "Open Ticket", onClick: () => openTicket(cp.ticketId) }] : [])])}
            title={new Date(cp.createdAt).toLocaleString()}
          >
            <span className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ border: `2px solid ${cp.actor === "user" ? "#3794ff" : "#c586c0"}` }} />
            <span className="truncate">{who} {what}</span>
            <span className="ml-auto pl-2 text-[11.5px] shrink-0" style={{ color: "var(--ide-muted)" }}>{timeAgo(cp.createdAt)}</span>
          </div>
        );
      })}
      {diff && <DiffModal target={{ checkpointId: diff }} onClose={() => setDiff(null)} onUndone={() => setDiff(null)} />}
      {menu.node}
    </div>
  );
}

/** Open tabs across both groups (for the OPEN EDITORS section). Filled in by IDE.tsx. */
export interface OpenEditorItem {
  key: string;
  title: string;
  path: string | null;
  dirty: boolean;
  open: () => void;
  close: () => void;
}
let openEditorsSource: () => OpenEditorItem[] = () => [];
export function setOpenEditorsSource(fn: () => OpenEditorItem[]) {
  openEditorsSource = fn;
}
function useOpenEditors() {
  return openEditorsSource();
}

// ================================================================ SEARCH

interface SearchResult {
  path: string;
  matches: { line: number; col: number; length: number; text: string }[];
}

export function SearchView() {
  const ide = useIde();
  const [q, setQ] = useState("");
  const [rep, setRep] = useState("");
  const [showRep, setShowRep] = useState(false);
  const [opts, setOpts] = useState({ regex: false, case: false, word: false });
  const [details, setDetails] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [res, setRes] = useState<{ results: SearchResult[]; total: number; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!ide.searchSeed) return;
    if (ide.searchSeed.q) setQ(ide.searchSeed.q);
    setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 20);
  }, [ide.searchSeed]);
  useEffect(() => {
    const h = (e: Event) => {
      setInclude((e as CustomEvent).detail);
      setDetails(true);
      input.current?.focus();
    };
    window.addEventListener("luma-ide:find-in", h);
    return () => window.removeEventListener("luma-ide:find-in", h);
  }, []);

  const params = useCallback(
    () => new URLSearchParams({ q, regex: opts.regex ? "1" : "", case: opts.case ? "1" : "", word: opts.word ? "1" : "", include, exclude }),
    [q, opts, include, exclude],
  );
  const run = useCallback(async () => {
    if (!q) {
      setRes(null);
      setError(null);
      return;
    }
    setBusy(true);
    try {
      setRes(await api(`/api/workspaces/${ide.wsId}/search?${params()}`));
      setError(null);
      setDismissed(new Set());
    } catch (e) {
      setError((e as Error).message);
      setRes(null);
    } finally {
      setBusy(false);
    }
  }, [q, params, ide.wsId]);
  useEffect(() => {
    const t = setTimeout(run, 280);
    return () => clearTimeout(t);
  }, [run]);

  const results = res?.results.filter((r) => !dismissed.has(r.path)) ?? [];
  const total = results.reduce((n, r) => n + r.matches.length, 0);

  const replace = async (paths?: string[]) => {
    const count = paths ? results.filter((r) => paths.includes(r.path)).reduce((n, r) => n + r.matches.length, 0) : total;
    const files = paths?.length ?? results.length;
    if (!(await confirmDialog({ title: `Replace ${count} occurrence${count === 1 ? "" : "s"} across ${files} file${files === 1 ? "" : "s"} with '${rep}'?`, confirmLabel: "Replace" }))) return;
    try {
      const r = await api<{ replacements: number; files: number }>(`/api/workspaces/${ide.wsId}/search`, {
        method: "POST",
        json: { query: q, replace: rep, regex: opts.regex, caseSensitive: opts.case, wholeWord: opts.word, include, exclude, paths: paths ?? results.map((x) => x.path) },
      });
      toast(`Replaced ${r.replacements} occurrence${r.replacements === 1 ? "" : "s"} in ${r.files} file${r.files === 1 ? "" : "s"}.`);
      run();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const Toggle = ({ k, title, Icon }: { k: keyof typeof opts; title: string; Icon: typeof Regex }) => (
    <button className={clsx("ide-icon-btn !w-5 !h-5", opts[k] && "is-on")} title={title} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}><Icon size={14} /></button>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <ViewTitle title="Search">
        <button className="ide-icon-btn" title="Refresh" onClick={run}><RefreshCw size={14} /></button>
        <button className="ide-icon-btn" title="Clear Search Results" onClick={() => { setQ(""); setRep(""); }}><ListFilter size={14} /></button>
        <button className="ide-icon-btn" title="Collapse All" onClick={() => setClosed(new Set(results.map((r) => r.path)))}><ChevronsDownUp size={15} /></button>
      </ViewTitle>
      <div className="flex gap-1 pl-1 pr-3 pb-2">
        <button className="ide-icon-btn !h-auto self-stretch" title="Toggle Replace" onClick={() => setShowRep((s) => !s)}>{showRep ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="relative">
            <textarea
              ref={input}
              rows={1}
              className="ide-input !pr-[74px] resize-none block"
              placeholder="Search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  run();
                }
              }}
            />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
              <Toggle k="case" title="Match Case (Alt+C)" Icon={CaseSensitive} />
              <Toggle k="word" title="Match Whole Word (Alt+W)" Icon={WholeWord} />
              <Toggle k="regex" title="Use Regular Expression (Alt+R)" Icon={Regex} />
            </span>
          </div>
          {showRep && (
            <div className="flex gap-1 items-center">
              <input className="ide-input" placeholder="Replace" value={rep} onChange={(e) => setRep(e.target.value)} />
              <button className="ide-icon-btn" title={`Replace All (${kbd("Mod+Alt+Enter")})`} disabled={!total || !ide.canEdit} onClick={() => replace()}><ReplaceAll size={15} /></button>
            </div>
          )}
          <div className="flex justify-end">
            <button className="ide-icon-btn !w-auto px-1" title="Toggle Search Details" onClick={() => setDetails((d) => !d)}><Ellipsis size={14} /></button>
          </div>
          {details && (
            <>
              <label className="block text-[11px]" style={{ color: "var(--ide-muted)" }}>files to include</label>
              <input className="ide-input" placeholder="e.g. *.ts, src/**/include" value={include} onChange={(e) => setInclude(e.target.value)} />
              <label className="block text-[11px]" style={{ color: "var(--ide-muted)" }}>files to exclude</label>
              <input className="ide-input" placeholder="e.g. *.min.js, assets" value={exclude} onChange={(e) => setExclude(e.target.value)} />
            </>
          )}
        </div>
      </div>
      <div className="px-5 pb-1 text-[12px]" style={{ color: error ? "var(--ide-deleted)" : "var(--ide-muted)" }}>
        {error ?? (busy && !res ? "Searching…" : res ? (total ? `${total} result${total === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}${res.truncated ? " (more not shown)" : ""}` : "No results found. Review your settings for configured exclusions.") : "")}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-4">
        {results.map((r) => (
          <div key={r.path}>
            <div className="ide-row group pr-2 pl-2" onClick={() => setClosed((c) => (c.has(r.path) ? new Set([...c].filter((x) => x !== r.path)) : new Set(c).add(r.path)))}>
              {closed.has(r.path) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <FileIcon path={r.path} size={14} />
              <span className="ml-1.5 truncate">{baseName(r.path)}</span>
              <span className="ml-1.5 truncate text-[12px]" style={{ color: "var(--ide-muted)" }}>{dirName(r.path)}</span>
              <span className="ml-auto flex items-center gap-0.5">
                {showRep && ide.canEdit && <button className="ide-icon-btn invisible group-hover:visible" title="Replace All in File" onClick={(e) => { e.stopPropagation(); replace([r.path]); }}><Replace size={13} /></button>}
                <button className="ide-icon-btn invisible group-hover:visible" title="Dismiss" onClick={(e) => { e.stopPropagation(); setDismissed((d) => new Set(d).add(r.path)); }}><X size={13} /></button>
                <span className="ide-badge">{r.matches.length}</span>
              </span>
            </div>
            {!closed.has(r.path) &&
              r.matches.map((m, i) => {
                const lead = Math.max(0, m.col - 1 - 40);
                const before = m.text.slice(lead, m.col - 1).trimStart();
                const hit = m.text.slice(m.col - 1, m.col - 1 + m.length);
                const after = m.text.slice(m.col - 1 + m.length, m.col - 1 + m.length + 160);
                return (
                  <div key={i} className="ide-row pr-2 text-[13px]" style={{ paddingLeft: 36 }} title={`${r.path}:${m.line}`} onClick={() => ide.openFile(r.path, { preview: true, line: m.line, col: m.col, endCol: m.col + m.length })}>
                    <span className="truncate">
                      {lead > 0 && "…"}
                      {before}
                      {showRep && rep !== "" ? (
                        <>
                          <span style={{ textDecoration: "line-through", background: "rgba(255,0,0,.2)" }}>{hit}</span>
                          <span style={{ background: "rgba(156,204,44,.3)" }}>{rep}</span>
                        </>
                      ) : (
                        <span className="ide-match">{hit}</span>
                      )}
                      {after}
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

// ================================================================ SOURCE CONTROL

export function ScmView() {
  const ide = useIde();
  const menu = useContextMenu();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sec, setSec] = useState({ staged: true, changes: true, commits: false });
  const [commits, setCommits] = useState<{ sha: string; author: string; date: string; subject: string }[]>([]);
  const scm = ide.scm;

  useEffect(() => {
    if (!sec.commits) return;
    api<{ commits?: typeof commits }>(`/api/workspaces/${ide.wsId}/git`).then((d) => setCommits(d.commits ?? [])).catch(() => undefined);
  }, [sec.commits, ide.wsId, scm]);

  const act = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, "error");
      ide.log("Source Control", `${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      await ide.refreshScm();
    }
  };
  const post = (json: Record<string, unknown>) => api(`/api/workspaces/${ide.wsId}/scm`, { method: "POST", json });
  const git = (json: Record<string, unknown>) => api<{ message?: string }>(`/api/workspaces/${ide.wsId}/git`, { method: "POST", json });

  if (!scm) return <div className="p-5 text-[13px]" style={{ color: "var(--ide-muted)" }}>Loading source control…</div>;
  if (!scm.repo)
    return (
      <div className="flex flex-col h-full">
        <ViewTitle title="Source Control" />
        <div className="px-5 text-[13px] space-y-3" style={{ color: "var(--ide-fg)" }}>
          {scm.installed ? (
            <>
              <p>This workspace doesn&apos;t have version control turned on yet.</p>
              <button className="ide-btn w-full" disabled={!ide.canEdit || !!busy} onClick={() => act("Initialize", () => git({ action: "enable" }), "Repository initialized")}>Initialize Repository</button>
              <p style={{ color: "var(--ide-muted)" }}>Luma will keep a git history of every change. Agents commit their work automatically, and you can push to GitHub from here.</p>
            </>
          ) : (
            <p>Git isn&apos;t installed on the Luma server. An admin can check it in Settings → System.</p>
          )}
        </div>
      </div>
    );

  const stagedPaths = scm.staged.map((c) => c.path);
  const changedPaths = scm.changes.map((c) => c.path);
  const commit = (push: boolean, all?: boolean) =>
    act("Commit", async () => {
      const useAll = all ?? !scm.staged.length;
      await post({ action: "commit", message: msg, all: useAll });
      setMsg("");
      ide.log("Source Control", `Committed: ${msg.split("\n")[0]}`);
      if (push) {
        const r = await git({ action: "push" });
        ide.log("Source Control", r.message ?? "Pushed");
      }
    }, push ? "Committed and pushed" : "Committed");

  const Row = ({ c }: { c: ScmChange }) => (
    <div
      className="ide-row group pr-2"
      style={{ paddingLeft: 20 }}
      onClick={() => ide.openDiff(c.path, c.staged ? "staged" : "working")}
      onContextMenu={(e) =>
        menu.open(e, [
          { label: "Open Changes", onClick: () => ide.openDiff(c.path, c.staged ? "staged" : "working") },
          { label: "Open File", disabled: c.status === "D", onClick: () => ide.openFile(c.path, { preview: false }) },
          { sep: true },
          c.staged
            ? { label: "Unstage Changes", onClick: () => act("Unstage", () => post({ action: "unstage", paths: [c.path] })) }
            : { label: "Stage Changes", onClick: () => act("Stage", () => post({ action: "stage", paths: [c.path] })) },
          ...(!c.staged ? [{ label: "Discard Changes", onClick: () => discard([c.path]) }] : []),
        ])
      }
      title={`${c.path} • ${{ M: "Modified", A: "Added", U: "Untracked", D: "Deleted", R: "Renamed", C: "Copied" }[c.status]}`}
    >
      <FileIcon path={c.path} size={14} />
      <span className="ml-1.5 truncate" style={{ color: SCM_COLOR[c.status], textDecoration: c.status === "D" ? "line-through" : undefined }}>{baseName(c.path)}</span>
      <span className="ml-1.5 truncate text-[12px]" style={{ color: "var(--ide-muted)" }}>{dirName(c.path)}</span>
      <span className="ml-auto flex items-center">
        {ide.canEdit && (
          <span className="hidden group-hover:flex">
            {c.status !== "D" && <button className="ide-icon-btn" title="Open File" onClick={(e) => { e.stopPropagation(); ide.openFile(c.path, { preview: false }); }}><ExternalLink size={13} /></button>}
            {!c.staged && <button className="ide-icon-btn" title="Discard Changes" onClick={(e) => { e.stopPropagation(); discard([c.path]); }}><Undo size={13} /></button>}
            {c.staged ? (
              <button className="ide-icon-btn" title="Unstage Changes" onClick={(e) => { e.stopPropagation(); act("Unstage", () => post({ action: "unstage", paths: [c.path] })); }}><Minus size={14} /></button>
            ) : (
              <button className="ide-icon-btn" title="Stage Changes" onClick={(e) => { e.stopPropagation(); act("Stage", () => post({ action: "stage", paths: [c.path] })); }}><Plus size={14} /></button>
            )}
          </span>
        )}
        <span className="w-4 text-center text-[12px] font-semibold" style={{ color: SCM_COLOR[c.status] }}>{c.status}</span>
      </span>
    </div>
  );
  const discard = async (paths: string[]) => {
    const n = paths.length;
    if (!(await confirmDialog({ title: n === 1 ? `Discard changes in ${baseName(paths[0])}?` : `Discard all ${n} changes?`, body: "Files go back to the last commit. Luma's History keeps a copy.", confirmLabel: n === 1 ? "Discard File" : "Discard All Files", danger: true }))) return;
    await act("Discard", () => post({ action: "discard", paths }));
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <ViewTitle title="Source Control">
        <button className="ide-icon-btn" title="Commit" disabled={!msg.trim() || !ide.canEdit} onClick={() => commit(false)}><Check size={15} /></button>
        <button className="ide-icon-btn" title="Refresh" onClick={() => ide.refreshScm()}><RefreshCw size={14} className={busy ? "animate-spin" : ""} /></button>
        <button
          className="ide-icon-btn"
          title="More Actions…"
          onClick={(e) =>
            menu.open(e, [
              { label: "Pull", disabled: !scm.remote, onClick: () => act("Pull", () => git({ action: "pull" }), "Pulled") },
              { label: "Push", disabled: !scm.remote, onClick: () => act("Push", () => git({ action: "push" }), "Pushed") },
              { label: "Open Pull Request", disabled: !scm.remote, onClick: () => act("Pull request", async () => { const r = await git({ action: "pr" }) as { url?: string }; if (r.url) window.open(r.url, "_blank"); }) },
              { sep: true },
              { label: "Commit Staged", disabled: !msg.trim(), onClick: () => commit(false, false) },
              { label: "Commit All", disabled: !msg.trim(), onClick: () => commit(false, true) },
              { label: "Commit & Push", disabled: !msg.trim() || !scm.remote, onClick: () => commit(true) },
              { sep: true },
              { label: "Stage All Changes", onClick: () => act("Stage", () => post({ action: "stage", paths: changedPaths })) },
              { label: "Unstage All Changes", onClick: () => act("Unstage", () => post({ action: "unstage", paths: stagedPaths })) },
              { label: "Discard All Changes", onClick: () => discard(changedPaths) },
              { sep: true },
              { label: `${scm.autoCommit ? "Turn Off" : "Turn On"} Agent Auto-Commit`, onClick: () => act("Settings", () => git({ action: "settings", autoCommit: !scm.autoCommit })) },
              { label: "Remote & GitHub Settings…", onClick: () => (window.location.href = `/w/${ide.wsId}/ship`) },
            ])
          }
        >
          <Ellipsis size={15} />
        </button>
      </ViewTitle>
      <div className="px-3 pb-2 space-y-1.5">
        <textarea
          className="ide-input resize-none block"
          rows={Math.min(6, Math.max(1, msg.split("\n").length))}
          placeholder={`Message (${kbd("Mod+Enter")} to commit on "${scm.branch}")`}
          value={msg}
          disabled={!ide.canEdit}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (msg.trim()) commit(false);
            }
          }}
        />
        <div className="flex">
          <button className="ide-btn flex-1 !rounded-r-none" disabled={!msg.trim() || !!busy || !ide.canEdit || (!scm.staged.length && !scm.changes.length)} onClick={() => commit(false)} title={scm.staged.length ? "Commit staged changes" : "Stage all changes and commit"}>
            <Check size={14} /> Commit
          </button>
          <button
            className="ide-btn !px-1.5 !rounded-l-none"
            style={{ borderLeft: "1px solid rgba(255,255,255,.3)" }}
            disabled={!msg.trim() || !!busy || !ide.canEdit}
            onClick={(e) => menu.open(e, [{ label: "Commit & Push", disabled: !scm.remote, onClick: () => commit(true) }, { label: "Commit All", onClick: () => commit(false, true) }, { label: "Commit Staged", onClick: () => commit(false, false) }])}
          >
            <ChevronDown size={14} />
          </button>
        </div>
        {scm.remote && (scm.ahead ?? 0) + (scm.behind ?? 0) > 0 && !scm.staged.length && !scm.changes.length && (
          <button className="ide-btn w-full" disabled={!!busy} onClick={() => act("Sync", async () => { if (scm.behind) await git({ action: "pull" }); if (scm.ahead) await git({ action: "push" }); }, "Synced")}>
            <RefreshCw size={13} /> Sync Changes {scm.behind ? `${scm.behind}↓` : ""} {scm.ahead ? `${scm.ahead}↑` : ""}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {scm.staged.length > 0 && (
          <div>
            <div className="ide-row group pl-1 pr-2 text-[13px]" onClick={() => setSec((s) => ({ ...s, staged: !s.staged }))}>
              {sec.staged ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <span className="ml-1">Staged Changes</span>
              <span className="ml-auto flex items-center gap-0.5">
                {ide.canEdit && <button className="ide-icon-btn hidden group-hover:grid" title="Unstage All Changes" onClick={(e) => { e.stopPropagation(); act("Unstage", () => post({ action: "unstage", paths: stagedPaths })); }}><Minus size={14} /></button>}
                <span className="ide-badge">{scm.staged.length}</span>
              </span>
            </div>
            {sec.staged && scm.staged.map((c) => <Row key={`s-${c.path}`} c={c} />)}
          </div>
        )}
        <div>
          <div className="ide-row group pl-1 pr-2 text-[13px]" onClick={() => setSec((s) => ({ ...s, changes: !s.changes }))}>
            {sec.changes ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <span className="ml-1">Changes</span>
            <span className="ml-auto flex items-center gap-0.5">
              {ide.canEdit && scm.changes.length > 0 && (
                <span className="hidden group-hover:flex">
                  <button className="ide-icon-btn" title="Discard All Changes" onClick={(e) => { e.stopPropagation(); discard(changedPaths); }}><Undo size={13} /></button>
                  <button className="ide-icon-btn" title="Stage All Changes" onClick={(e) => { e.stopPropagation(); act("Stage", () => post({ action: "stage", paths: changedPaths })); }}><Plus size={14} /></button>
                </span>
              )}
              <span className="ide-badge">{scm.changes.length}</span>
            </span>
          </div>
          {sec.changes && scm.changes.map((c) => <Row key={`c-${c.path}`} c={c} />)}
          {sec.changes && !scm.changes.length && !scm.staged.length && <p className="px-5 py-1 text-[12.5px]" style={{ color: "var(--ide-muted)" }}>No changes since the last commit{scm.autoCommit ? " (agents commit their own work automatically)" : ""}.</p>}
        </div>
        <div className="mt-2" style={{ borderTop: "1px solid var(--ide-border)" }}>
          <div className="ide-section" onClick={() => setSec((s) => ({ ...s, commits: !s.commits }))}>
            <span style={{ width: 16, display: "inline-block", transform: sec.commits ? "rotate(90deg)" : undefined }}>›</span> Graph
          </div>
          {sec.commits &&
            commits.map((c) => (
              <div key={c.sha} className="ide-row pr-2 text-[13px]" style={{ paddingLeft: 20 }} title={`${c.sha} · ${c.author} · ${new Date(c.date).toLocaleString()}`}>
                <span className="w-2 h-2 rounded-full shrink-0 mr-2" style={{ border: "2px solid #3794ff" }} />
                <span className="truncate">{c.subject}</span>
                <span className="ml-auto pl-2 text-[11.5px] shrink-0" style={{ color: "var(--ide-muted)" }}>{c.author} · {timeAgo(c.date)}</span>
              </div>
            ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 px-4 h-[26px] text-[12px] shrink-0" style={{ color: "var(--ide-muted)", borderTop: "1px solid var(--ide-border)" }}>
        <GitBranch size={13} /> {scm.branch}
        {scm.remote ? (
          <span className="ml-auto flex items-center gap-2">
            <button className="flex items-center gap-0.5 hover:underline" title="Pull" onClick={() => act("Pull", () => git({ action: "pull" }), "Pulled")}><CloudDownload size={13} />{scm.behind ?? 0}</button>
            <button className="flex items-center gap-0.5 hover:underline" title="Push" onClick={() => act("Push", () => git({ action: "push" }), "Pushed")}><CloudUpload size={13} />{scm.ahead ?? 0}</button>
          </span>
        ) : (
          <a className="ml-auto hover:underline" href={`/w/${ide.wsId}/ship`}>Publish to GitHub…</a>
        )}
      </div>
      {menu.node}
    </div>
  );
}

// ================================================================ CODE REVIEW

interface ChangeSet {
  ticketId: string;
  number: number;
  title: string;
  status: keyof typeof STATUS_STYLE;
  assigneeId: string | null;
  files: number;
  lastAt: string;
  openThreads: number;
  review: { viewed?: string[]; verdict?: "approved" | "changes_requested"; by?: string; at?: string } | null;
}
interface FileChange {
  path: string;
  adds: number;
  dels: number;
  created: boolean;
  deleted: boolean;
  changedLater: boolean;
}

export function ReviewView() {
  const ide = useIde();
  const { agents, tickets, openTicket, reload } = useWorkspace();
  const [sets, setSets] = useState<ChangeSet[] | null>(null);
  const [filter, setFilter] = useState<"review" | "all">("review");
  const [openSet, setOpenSet] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ changeSets: ChangeSet[] }>(`/api/workspaces/${ide.wsId}/review?changesets=1`);
    setSets(d.changeSets);
  }, [ide.wsId]);
  const ticketSig = tickets.map((t) => `${t.id}:${t.status}:${t.review?.verdict}:${t.review?.viewed?.length}`).join(",");
  useEffect(() => {
    load().catch(() => setSets([]));
  }, [load, ide.threads, ticketSig]);

  const shown = (sets ?? []).filter((s) => filter === "all" || s.status === "in_review" || s.status === "waiting_for_user");
  useEffect(() => {
    if (!openSet && shown[0]) setOpenSet(shown[0].ticketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, filter]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <ViewTitle title="Code Review">
        <button className="ide-icon-btn" title="Refresh" onClick={() => load()}><RefreshCw size={14} /></button>
      </ViewTitle>
      <div className="flex gap-1 px-3 pb-2 text-[12px]">
        {(["review", "all"] as const).map((f) => (
          <button key={f} className={clsx("px-2 py-0.5 rounded-full", filter === f && "is-on")} style={{ background: filter === f ? "var(--ide-select)" : "transparent", border: "1px solid var(--ide-border)" }} onClick={() => setFilter(f)}>
            {f === "review" ? `Needs review (${(sets ?? []).filter((s) => s.status === "in_review" || s.status === "waiting_for_user").length})` : `All changes (${sets?.length ?? 0})`}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto pb-6">
        {sets === null && <p className="px-5 text-[13px]" style={{ color: "var(--ide-muted)" }}>Loading…</p>}
        {sets && !shown.length && (
          <div className="px-5 py-2 text-[13px] space-y-2" style={{ color: "var(--ide-muted)" }}>
            <p>{filter === "review" ? "Nothing is waiting for review." : "Agents haven't changed any files yet."}</p>
            {filter === "review" && sets.length > 0 && <button className="hover:underline" style={{ color: "#3794ff" }} onClick={() => setFilter("all")}>Show all {sets.length} change sets</button>}
          </div>
        )}
        {shown.map((s) => (
          <ChangeSetItem
            key={s.ticketId}
            set={s}
            agentName={agentById(agents, s.assigneeId)?.name}
            agentAvatar={agentById(agents, s.assigneeId)?.avatar}
            open={openSet === s.ticketId}
            onToggle={() => setOpenSet(openSet === s.ticketId ? null : s.ticketId)}
            onChanged={() => {
              load();
              reload();
            }}
            openTicket={() => openTicket(s.ticketId)}
          />
        ))}
      </div>
    </div>
  );
}

function ChangeSetItem({ set, agentName, agentAvatar, open, onToggle, onChanged, openTicket }: { set: ChangeSet; agentName?: string; agentAvatar?: string; open: boolean; onToggle: () => void; onChanged: () => void; openTicket: () => void }) {
  const ide = useIde();
  const menu = useContextMenu();
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const viewed = new Set(set.review?.viewed ?? []);

  useEffect(() => {
    if (!open) return;
    api<{ files: FileChange[] }>(`/api/workspaces/${ide.wsId}/diff?ticketId=${set.ticketId}`).then((d) => setFiles(d.files)).catch(() => setFiles([]));
  }, [open, ide.wsId, set.ticketId, set.lastAt, ide.previewVersion]);

  const post = async (label: string, json: Record<string, unknown>) => {
    setBusy(label);
    try {
      const r = await api<{ started?: boolean; message?: string; summary?: string; comments?: number }>(`/api/workspaces/${ide.wsId}/review`, { method: "POST", json });
      return r;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    } finally {
      setBusy(null);
    }
  };
  const approve = async () => {
    if (!(await confirmDialog({ title: `Approve LUM-${set.number}?`, body: "The ticket moves to Done.", confirmLabel: "Approve" }))) return;
    if (await post("approve", { action: "verdict", ticketId: set.ticketId, verdict: "approve" })) {
      toast(`LUM-${set.number} approved`);
      ide.log("Code Review", `Approved LUM-${set.number}`);
      onChanged();
    }
  };
  const requestChanges = async () => {
    const r = await post("changes", { action: "verdict", ticketId: set.ticketId, verdict: "request_changes", note });
    if (!r) return;
    setAsking(false);
    setNote("");
    ide.log("Code Review", `Requested changes on LUM-${set.number}${r.started ? " — agent started" : r.message ? ` — ${r.message}` : ""}`);
    toast(r.started ? `Sent back to ${agentName ?? "the agent"} — working on it now` : r.message ?? "Changes requested", r.started ? "success" : "info");
    onChanged();
  };
  const aiReview = async () => {
    ide.log("Code Review", `AI reviewing LUM-${set.number}…`);
    const r = await post("ai", { action: "ai", ticketId: set.ticketId });
    if (!r) return;
    ide.log("Code Review", `LUM-${set.number}: ${r.summary} (${r.comments} line comments)`);
    toast(`AI review done: ${r.comments} comment${r.comments === 1 ? "" : "s"}`);
    ide.refreshThreads();
    onChanged();
  };
  const rejectAll = async () => {
    if (!(await confirmDialog({ title: `Reject all of LUM-${set.number}'s changes?`, body: "Every file it changed goes back to how it was before. You can undo this from History.", confirmLabel: "Reject all changes", danger: true }))) return;
    await api(`/api/workspaces/${ide.wsId}/checkpoints`, { method: "POST", json: { ticketId: set.ticketId } }).catch((e) => toast(e.message, "error"));
    ide.log("Code Review", `Rejected all changes from LUM-${set.number}`);
    onChanged();
  };

  const st = STATUS_STYLE[set.status];
  const verdict = set.review?.verdict;
  return (
    <div style={{ borderBottom: "1px solid var(--ide-border)" }}>
      <div
        className="flex items-start gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[var(--ide-hover)]"
        onClick={onToggle}
        onContextMenu={(e) => menu.open(e, [{ label: "Open Ticket", onClick: openTicket }, { label: "Review with AI", onClick: aiReview }, { sep: true }, { label: "Reject All Changes…", onClick: rejectAll }])}
      >
        <span className="mt-0.5">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px]">
            <span className="font-semibold shrink-0">LUM-{set.number}</span>
            <span className="truncate">{set.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] mt-0.5 whitespace-nowrap" style={{ color: "var(--ide-muted)" }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: st.dot }} />{st.label}</span>
            {agentName && <span>· {agentAvatar} {agentName}</span>}
            <span>· {set.files} file{set.files === 1 ? "" : "s"}</span>
            {verdict && <span style={{ color: verdict === "approved" ? "var(--ide-added)" : "var(--ide-modified)" }}>· {verdict === "approved" ? "Approved" : "Changes requested"}</span>}
          </div>
        </div>
        {set.openThreads > 0 && <span className="ide-badge mt-0.5" title="Open comments">{set.openThreads}</span>}
      </div>
      {open && (
        <div className="pb-2">
          {files === null && <p className="px-7 text-[12px]" style={{ color: "var(--ide-muted)" }}>Loading files…</p>}
          {files?.map((f) => (
            <div key={f.path} className="ide-row pr-2 group" style={{ paddingLeft: 22 }} onClick={() => ide.openReview(set.ticketId, set.number, f.path)} title={f.changedLater ? "Changed again after this ticket" : f.path}>
              <input
                type="checkbox"
                className="mr-1.5"
                title="Mark as viewed"
                checked={viewed.has(f.path)}
                disabled={!ide.canEdit}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => post("viewed", { action: "viewed", ticketId: set.ticketId, path: f.path, viewed: e.target.checked }).then(onChanged)}
              />
              <FileIcon path={f.path} size={14} />
              <span className="ml-1.5 truncate" style={{ opacity: viewed.has(f.path) ? 0.6 : 1, textDecoration: f.deleted ? "line-through" : undefined }}>{baseName(f.path)}</span>
              <span className="ml-1.5 truncate text-[11.5px]" style={{ color: "var(--ide-muted)" }}>{dirName(f.path)}</span>
              <span className="ml-auto pl-2 text-[11.5px] shrink-0 font-mono">
                <span style={{ color: "var(--ide-added)" }}>+{f.adds}</span> <span style={{ color: "var(--ide-deleted)" }}>−{f.dels}</span>
                {f.changedLater && <span title="Changed again later" style={{ color: "var(--ide-modified)" }}> •</span>}
              </span>
            </div>
          ))}
          {files && files.length > 0 && (
            <p className="px-7 pt-1 text-[11.5px]" style={{ color: "var(--ide-muted)" }}>
              {files.filter((f) => viewed.has(f.path)).length} of {files.length} files viewed · click a file to see the diff and comment on lines
            </p>
          )}
          {ide.canEdit && (
            <div className="px-7 pt-2 space-y-1.5">
              {asking ? (
                <>
                  <textarea
                    autoFocus
                    className="ide-input resize-y"
                    rows={3}
                    placeholder={set.openThreads ? `Optional summary — your ${set.openThreads} line comment${set.openThreads === 1 ? "" : "s"} are sent too` : "What should change?"}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && requestChanges()}
                  />
                  <div className="flex gap-1.5">
                    <button className="ide-btn flex-1" disabled={!!busy || (!note.trim() && !set.openThreads)} onClick={requestChanges}>{busy === "changes" ? "Sending…" : "Send to Agent"}</button>
                    <button className="ide-btn ide-btn-2" onClick={() => setAsking(false)}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-1.5">
                    <button className="ide-btn flex-1 whitespace-nowrap !px-2" disabled={!!busy} onClick={approve}><Check size={14} /> Approve</button>
                    <button className="ide-btn ide-btn-2 flex-1 whitespace-nowrap !px-2" disabled={!!busy} onClick={() => setAsking(true)}>Request Changes</button>
                  </div>
                  <button className="ide-btn ide-btn-2 w-full" disabled={!!busy} onClick={aiReview}><Sparkles size={13} /> {busy === "ai" ? "Reviewing…" : "Review with AI"}</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {menu.node}
    </div>
  );
}
