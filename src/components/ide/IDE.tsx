"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { Monaco as MonacoNs } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  AlertCircle, AlertTriangle, Bell, Eye, Files, GitBranch, GitPullRequestArrow, Loader2, Maximize2, MessageSquare, Minimize2, PanelBottom, PanelLeft,
  RefreshCw, Search, Settings, Sparkles,
} from "lucide-react";
import { api } from "@/lib/client";
import { confirmDialog, toast } from "../Dialogs";
import { useWorkspace } from "../WorkspaceProvider";
import { ErrorNote, Modal } from "../ui";
import { EditorGroup, setSettingsRenderer, type GroupOps } from "./editors";
import { ExplorerView, ReviewView, ScmView, SearchView, setOpenEditorsSource } from "./views";
import { Panel } from "./panel";
import { Palette, type PaletteMode } from "./palette";
import { KeybindingsEditor, SettingsEditor, SettingsJsonEditor } from "./settingsEditor";
import { kbd, matches, useContextMenu, baseName, dirName, type MenuItem } from "./bits";
import { LANG_NAMES, langOf } from "./monaco";
import { resolveTheme, useIdeSettings } from "./settings";
import {
  IdeCtx, tabId, tabTitle, type Buffer, type Command, type FileEntry, type Group, type Ide, type OutputLine, type PanelTab, type Problem, type ScmState, type Tab, type Thread, type View,
  useIde,
} from "./ctx";

setSettingsRenderer((kind) => (kind === "settings" ? <SettingsEditor /> : kind === "settings-json" ? <SettingsJsonEditor /> : <KeybindingsEditor />));

const LAYOUT_KEY = "luma-ide-layout";
interface Layout {
  view: View | null;
  sidebar: number;
  panel: boolean;
  panelTab: PanelTab;
  panelHeight: number;
  split: number;
}
const DEFAULT_LAYOUT: Layout = { view: "explorer", sidebar: 260, panel: false, panelTab: "terminal", panelHeight: 260, split: 0.55 };

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

export function IDE({ onSimpleMode }: { onSimpleMode: () => void }) {
  const ws = useWorkspace();
  const { workspace, fileVersion, subscribeLive, canEdit, tickets, agents, activity } = ws;
  const wsId = workspace!.id;
  const router = useRouter();
  const [settings, updateSettings] = useIdeSettings();
  const [lumaDark, setLumaDark] = useState(true);
  const theme = resolveTheme(settings["workbench.colorTheme"], lumaDark);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const [groups, setGroups] = useState<Group[]>([{ tabs: [], active: null }]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const [focusedGroup, setFocusedGroup] = useState(0);
  const [layout, setLayoutState] = useState<Layout>(DEFAULT_LAYOUT);
  const [zen, setZen] = useState(false);
  const [maxPanel, setMaxPanel] = useState(false);
  const [fullWindow, setFullWindow] = useState(false);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const [scm, setScm] = useState<ScmState | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [cursor, setCursor] = useState<{ line: number; col: number; sel: number } | null>(null);
  const [searchSeed, setSearchSeed] = useState<{ q: string; n: number } | null>(null);
  const [reveal, setReveal] = useState<Ide["reveal"]>(null);
  const [revealPath, setRevealPath] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [monaco, setMonacoState] = useState<MonacoNs | null>(null);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [ask, setAsk] = useState<{ path: string; selection: string } | null>(null);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const editors = useRef(new Map<string, editor.IStandaloneCodeEditor>());
  const lastEditor = useRef<string | null>(null);
  const chord = useRef<{ at: number } | null>(null);
  const restored = useRef(false);
  const gearMenu = useContextMenu();

  const setLayout = useCallback((p: Partial<Layout>) => {
    setLayoutState((l) => {
      const n = { ...l, ...p };
      writeJson(LAYOUT_KEY, n);
      return n;
    });
  }, []);

  useEffect(() => {
    setLayoutState(readJson(LAYOUT_KEY, DEFAULT_LAYOUT));
    const sync = () => setLumaDark(document.documentElement.classList.contains("dark"));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const log = useCallback((channel: OutputLine["channel"], text: string) => setOutput((o) => [...o.slice(-400), { at: Date.now(), channel, text }]), []);

  // ------------------------------------------------------------ data

  const loadFiles = useCallback(async () => {
    const d = await api<{ files: FileEntry[] }>(`/api/workspaces/${wsId}/files`);
    setFiles(d.files);
    return d.files;
  }, [wsId]);
  const refreshScm = useCallback(async () => {
    try {
      setScm(await api<ScmState>(`/api/workspaces/${wsId}/scm`));
    } catch {
      setScm({ repo: false, installed: false });
    }
  }, [wsId]);
  const refreshThreads = useCallback(async () => {
    const d = await api<{ threads: Thread[] }>(`/api/workspaces/${wsId}/review`).catch(() => ({ threads: [] }));
    setThreads(d.threads);
  }, [wsId]);

  const fetchFile = useCallback(async (path: string) => {
    try {
      const d = await api<{ content: string }>(`/api/workspaces/${wsId}/file?path=${encodeURIComponent(path)}`);
      return d.content;
    } catch {
      return null;
    }
  }, [wsId]);

  const ensureBuffer = useCallback(
    async (path: string) => {
      const have = buffersRef.current[path];
      if (have) return have;
      const content = await fetchFile(path);
      if (content === null) return null;
      const b = { content, saved: content };
      setBuffers((x) => (x[path] ? x : { ...x, [path]: b }));
      return b;
    },
    [fetchFile],
  );
  const setBuffer = useCallback((path: string, content: string) => {
    setBuffers((b) => (b[path] && b[path].content !== content ? { ...b, [path]: { ...b[path], content } } : b));
  }, []);

  useEffect(() => {
    loadFiles();
    refreshScm();
    refreshThreads();
  }, [loadFiles, refreshScm, refreshThreads]);

  // Someone else (an agent, another tab) changed files.
  const scmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshScmSoon = useCallback(() => {
    if (scmTimer.current) clearTimeout(scmTimer.current);
    scmTimer.current = setTimeout(() => refreshScm(), 600);
  }, [refreshScm]);
  useEffect(() => {
    if (!fileVersion) return;
    loadFiles();
    setPreviewVersion((v) => v + 1);
    refreshScmSoon();
    refreshThreads();
    for (const [path, buf] of Object.entries(buffersRef.current)) {
      if (buf.content !== buf.saved) continue; // keep unsaved edits
      fetchFile(path).then((c) => {
        if (c === null) return;
        setBuffers((b) => (b[path] && b[path].content === b[path].saved && b[path].saved !== c ? { ...b, [path]: { content: c, saved: c } } : b));
      });
    }
  }, [fileVersion, loadFiles, fetchFile, refreshScmSoon, refreshThreads]);
  useEffect(
    () =>
      subscribeLive((e) => {
        if (e.kind === "git") refreshScmSoon();
        if (e.kind === "review") refreshThreads();
      }),
    [subscribeLive, refreshScmSoon, refreshThreads],
  );

  // Problems from Monaco's language services.
  useEffect(() => {
    if (!monaco) return;
    const sev = (s: number) => (s >= 8 ? "error" : s >= 4 ? "warning" : "info") as Problem["severity"];
    const compute = () => {
      const known = new Set(files.map((f) => f.path));
      const list: Problem[] = [];
      for (const m of monaco.editor.getModelMarkers({})) {
        const p = m.resource.path.replace(/^\//, "");
        if (m.resource.scheme === "inmemory" || !known.has(p) || m.severity < 2) continue;
        list.push({ path: p, line: m.startLineNumber, col: m.startColumn, severity: sev(m.severity), message: m.message, source: m.source });
      }
      list.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
      setProblems(list);
    };
    compute();
    const d = monaco.editor.onDidChangeMarkers(compute);
    return () => d.dispose();
  }, [monaco, files]);

  // ------------------------------------------------------------ tabs

  const updateGroup = useCallback((g: number, fn: (grp: Group) => Group) => {
    setGroups((gs) => {
      const n = gs.slice();
      while (n.length <= g) n.push({ tabs: [], active: null });
      n[g] = fn(n[g]);
      return n;
    });
  }, []);

  const placeTab = useCallback(
    (tab: Tab, opts: { preview?: boolean; side?: boolean } = {}) => {
      const gs = groupsRef.current;
      let g = opts.side ? (gs.length > 1 ? (focusedGroup === 0 ? 1 : 0) : 1) : Math.min(focusedGroup, gs.length - 1);
      // Already open in another group and not asked for a side? Reuse it like VS Code.
      if (!opts.side && !gs[g]?.tabs.some((t) => t.id === tab.id)) {
        const other = gs.findIndex((x) => x.tabs.some((t) => t.id === tab.id));
        if (other >= 0 && other !== g && tab.kind !== "file") g = other;
      }
      updateGroup(g, (grp) => {
        const existing = grp.tabs.find((t) => t.id === tab.id);
        if (existing) {
          const tabs = opts.preview === false && existing.kind === "file" && existing.preview ? grp.tabs.map((t) => (t.id === tab.id ? { ...t, preview: false } : t)) : grp.tabs;
          return { tabs, active: tab.id };
        }
        const t = tab.kind === "file" ? { ...tab, preview: !!opts.preview } : tab;
        let tabs = grp.tabs;
        if (t.kind === "file" && t.preview) {
          const old = tabs.find((x) => x.kind === "file" && x.preview);
          const oldDirty = old && old.kind === "file" && buffersRef.current[old.path] && buffersRef.current[old.path].content !== buffersRef.current[old.path].saved;
          if (old && !oldDirty) return { tabs: tabs.map((x) => (x === old ? t : x)), active: t.id };
        }
        const at = tabs.findIndex((x) => x.id === grp.active);
        tabs = at >= 0 ? [...tabs.slice(0, at + 1), t, ...tabs.slice(at + 1)] : [...tabs, t];
        return { tabs, active: t.id };
      });
      setFocusedGroup(g);
    },
    [focusedGroup, updateGroup],
  );

  const openFile = useCallback<Ide["openFile"]>(
    async (path, opts = {}) => {
      placeTab({ id: tabId.file(path), kind: "file", path }, { preview: opts.preview ?? false, side: opts.side });
      setRecentFiles((r) => [path, ...r.filter((x) => x !== path)].slice(0, 20));
      setRevealPath(path);
      if (opts.line) setReveal({ path, line: opts.line, col: opts.col, endCol: opts.endCol, n: Date.now() });
      await ensureBuffer(path);
    },
    [placeTab, ensureBuffer],
  );
  const openDiff = useCallback((path: string, source: "working" | "staged") => placeTab({ id: tabId.diff(path, source), kind: "diff", path, source }, { preview: false }), [placeTab]);
  const openReview = useCallback((ticketId: string, ticketNumber: number, path: string) => placeTab({ id: tabId.review(ticketId, path), kind: "review", path, ticketId, ticketNumber }), [placeTab]);
  const openSpecial = useCallback((kind: "preview" | "settings" | "settings-json" | "keybindings" | "welcome", side?: boolean) => placeTab({ id: kind, kind } as Tab, { side }), [placeTab]);

  const isDirty = (path: string) => !!buffersRef.current[path] && buffersRef.current[path].content !== buffersRef.current[path].saved;

  // ------------------------------------------------------------ saving

  const editorFor = (path: string) => {
    for (const [key, ed] of editors.current) {
      const m = ed.getModel();
      if (m && m.uri.scheme !== "inmemory" && m.uri.path.replace(/^\//, "") === path && key) return ed;
    }
    return null;
  };

  const save = useCallback(
    async (pathIn?: string) => {
      const gs = groupsRef.current;
      const activeTab = gs[focusedGroup]?.tabs.find((t) => t.id === gs[focusedGroup]?.active);
      const path = pathIn ?? (activeTab && "path" in activeTab ? activeTab.path : null);
      if (!path || !canEdit) return;
      const buf = buffersRef.current[path];
      if (!buf) return;
      let content = buf.content;
      const ed = editorFor(path);
      if (settings["editor.formatOnSave"] && ed) {
        try {
          await ed.getAction("editor.action.formatDocument")?.run();
          content = ed.getModel()?.getValue() ?? content;
        } catch {}
      }
      if (settings["files.trimTrailingWhitespace"]) content = content.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n");
      if (settings["files.insertFinalNewline"] && content && !content.endsWith("\n")) content += "\n";
      if (content === buf.saved) {
        setBuffers((b) => ({ ...b, [path]: { content, saved: content } }));
        return;
      }
      try {
        await api(`/api/workspaces/${wsId}/file`, { method: "PUT", json: { path, content } });
        setBuffers((b) => ({ ...b, [path]: { content: b[path]?.content === buf.content ? content : b[path]?.content ?? content, saved: content } }));
        setPreviewVersion((v) => v + 1);
        refreshScmSoon();
      } catch (e) {
        toast(`Failed to save '${baseName(path)}': ${(e as Error).message}`, "error");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedGroup, wsId, settings, canEdit, refreshScmSoon],
  );
  const saveAll = useCallback(async () => {
    for (const p of Object.keys(buffersRef.current)) if (isDirty(p)) await save(p);
  }, [save]);
  const revert = useCallback(
    async (path: string) => {
      const c = await fetchFile(path);
      if (c !== null) setBuffers((b) => ({ ...b, [path]: { content: c, saved: c } }));
    },
    [fetchFile],
  );

  // Auto save.
  const autoSave = settings["files.autoSave"];
  useEffect(() => {
    if (autoSave !== "afterDelay") return;
    const dirty = Object.keys(buffers).filter((p) => buffers[p].content !== buffers[p].saved);
    if (!dirty.length) return;
    const t = setTimeout(() => dirty.forEach((p) => save(p)), settings["files.autoSaveDelay"]);
    return () => clearTimeout(t);
  }, [buffers, autoSave, settings, save]);
  useEffect(() => {
    if (autoSave !== "onWindowChange" && autoSave !== "onFocusChange") return;
    const h = () => saveAll();
    window.addEventListener("blur", h);
    return () => window.removeEventListener("blur", h);
  }, [autoSave, saveAll]);
  const activeKey = groups.map((g) => g.active).join("|");
  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    if (autoSave === "onFocusChange" && prevActive.current) {
      const prev = prevActive.current.replace(/^file:/, "");
      if (prevActive.current.startsWith("file:") && isDirty(prev)) save(prev);
    }
    prevActive.current = groups[focusedGroup]?.active ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, focusedGroup]);

  // Hot exit: unsaved edits survive navigating away or reloading (kept in this browser only).
  const DIRTY_KEY = `luma-ide-dirty:${wsId}`;
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      const dirty: Record<string, string> = {};
      for (const [p, b] of Object.entries(buffers)) if (b.content !== b.saved && b.content.length < 500_000) dirty[p] = b.content;
      try {
        if (Object.keys(dirty).length) localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty));
        else localStorage.removeItem(DIRTY_KEY);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [buffers, DIRTY_KEY]);

  // Don't lose unsaved work when leaving the page.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (Object.keys(buffersRef.current).some(isDirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // ------------------------------------------------------------ closing tabs

  const closeTabs = useCallback(
    async (g: number, ids: string[]) => {
      const gs = groupsRef.current;
      const grp = gs[g];
      if (!grp) return;
      const closing = grp.tabs.filter((t) => ids.includes(t.id));
      const elsewhere = (t: Tab) => "path" in t && gs.some((x, gi) => x.tabs.some((o) => o.id !== t.id && "path" in o && o.path === t.path && (gi !== g || !ids.includes(o.id))));
      const keep: string[] = [];
      for (const t of closing) {
        if ((t.kind === "file" || t.kind === "review" || t.kind === "diff") && isDirty(t.path) && !elsewhere(t)) {
          const yes = await confirmDialog({ title: `Do you want to save the changes you made to ${baseName(t.path)}?`, body: "Your changes will be lost if you don't save them. Choose Keep Open to decide later.", confirmLabel: "Save & Close", cancelLabel: "Keep Open" });
          if (yes) await save(t.path);
          else keep.push(t.id);
        }
      }
      const gone = closing.filter((t) => !keep.includes(t.id));
      if (!gone.length) return;
      setClosedTabs((c) => [...gone, ...c].slice(0, 20));
      setGroups((cur) => {
        const n = cur.map((x, i) => {
          if (i !== g) return x;
          const idx = x.tabs.findIndex((t) => t.id === x.active);
          const tabs = x.tabs.filter((t) => !gone.some((o) => o.id === t.id));
          const active = tabs.some((t) => t.id === x.active) ? x.active : tabs[Math.min(Math.max(0, idx - 1), tabs.length - 1)]?.id ?? null;
          return { tabs, active };
        });
        if (n.length > 1 && !n[g].tabs.length) {
          n.splice(g, 1);
          setFocusedGroup(0);
        }
        // Free memory for files no longer open anywhere.
        const stillOpen = new Set(n.flatMap((x) => x.tabs.filter((t) => "path" in t).map((t) => (t as { path: string }).path)));
        for (const t of gone) {
          if (!("path" in t) || stillOpen.has(t.path) || isDirty(t.path)) continue;
          setBuffers((b) => {
            const c = { ...b };
            delete c[t.path];
            return c;
          });
          try {
            monaco?.editor.getModel(monaco.Uri.parse(t.path))?.dispose();
          } catch {}
        }
        return n;
      });
    },
    [save, monaco],
  );

  const ops: GroupOps = {
    activate: (g, id) => updateGroup(g, (grp) => ({ ...grp, active: id })),
    close: (g, ids) => void closeTabs(g, ids),
    pin: (g, id) => updateGroup(g, (grp) => ({ ...grp, tabs: grp.tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, preview: false } : t)) })),
    focus: (g) => setFocusedGroup(g),
    split: (g) => {
      const grp = groupsRef.current[g];
      const t = grp?.tabs.find((x) => x.id === grp.active);
      if (groupsRef.current.length > 1) {
        if (t) updateGroup(g === 0 ? 1 : 0, (o) => ({ tabs: o.tabs.some((x) => x.id === t.id) ? o.tabs : [...o.tabs, { ...t, ...(t.kind === "file" ? { preview: false } : {}) } as Tab], active: t.id }));
        setFocusedGroup(g === 0 ? 1 : 0);
        return;
      }
      setGroups((gs) => [...gs, t ? { tabs: [{ ...t, ...(t.kind === "file" ? { preview: false } : {}) } as Tab], active: t.id } : { tabs: [{ id: "welcome", kind: "welcome" }], active: "welcome" }]);
      setFocusedGroup(1);
    },
    move: (from, id, to) => {
      setGroups((gs) => {
        const n = gs.map((g) => ({ ...g, tabs: g.tabs.slice() }));
        while (n.length <= to) n.push({ tabs: [], active: null });
        const t = n[from].tabs.find((x) => x.id === id);
        if (!t) return gs;
        n[from].tabs = n[from].tabs.filter((x) => x.id !== id);
        if (n[from].active === id) n[from].active = n[from].tabs[0]?.id ?? null;
        if (!n[to].tabs.some((x) => x.id === id)) n[to].tabs.push(t);
        n[to].active = id;
        const out = n.filter((g, i) => g.tabs.length || i === 0);
        setFocusedGroup(Math.min(to, out.length - 1));
        return out;
      });
    },
  };

  // Restore tabs from last time (per workspace), or open sensible defaults.
  useEffect(() => {
    if (restored.current || !files.length) return;
    restored.current = true;
    const known = new Set(files.map((f) => f.path));
    const saved = readJson<{ groups: Group[] | null }>(`luma-ide-tabs:${wsId}`, { groups: null }).groups;
    const valid = (t: Tab) => !("path" in t) || known.has(t.path) || t.kind === "diff";
    // Bring back unsaved edits from last time.
    const dirty = readJson<Record<string, string>>(DIRTY_KEY, {});
    for (const [p, content] of Object.entries(dirty)) {
      if (!known.has(p)) continue;
      fetchFile(p).then((server) => {
        if (server === null || server === content) return;
        setBuffers((b) => ({ ...b, [p]: { content, saved: server } }));
      });
    }
    if (Object.keys(dirty).length) log("Luma", `Restored unsaved changes in ${Object.keys(dirty).join(", ")}`);
    if (saved?.length) {
      const gs = saved.map((g) => ({ tabs: g.tabs.filter(valid), active: g.active })).filter((g, i) => g.tabs.length || i === 0);
      gs.forEach((g) => !g.tabs.some((t) => t.id === g.active) && (g.active = g.tabs[0]?.id ?? null));
      setGroups(gs.length ? gs : [{ tabs: [], active: null }]);
      for (const g of gs) for (const t of g.tabs) if (t.kind === "file") void ensureBuffer(t.path);
      return;
    }
    const first = files.find((f) => f.path === "index.html")?.path ?? files.find((f) => f.path === "lib/main.dart")?.path ?? files.find((f) => /\.(html|tsx?|jsx?|dart|py)$/.test(f.path))?.path;
    const g0: Group = first ? { tabs: [{ id: tabId.file(first), kind: "file", path: first }], active: tabId.file(first) } : { tabs: [{ id: "welcome", kind: "welcome" }], active: "welcome" };
    const web = files.some((f) => /\.html?$/.test(f.path)) || files.some((f) => f.path === "pubspec.yaml");
    setGroups(web ? [g0, { tabs: [{ id: "preview", kind: "preview" }], active: "preview" }] : [g0]);
    if (first) void ensureBuffer(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, wsId, ensureBuffer]);
  useEffect(() => {
    if (!restored.current) return;
    writeJson(`luma-ide-tabs:${wsId}`, { groups: groups.map((g) => ({ ...g, tabs: g.tabs.map((t) => (t.kind === "file" ? { ...t, preview: false } : t)) })) });
  }, [groups, wsId]);

  // Deep link: ?file=path&line=n (after tabs are restored).
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !restored.current) return;
    deepLinked.current = true;
    const u = new URLSearchParams(window.location.search);
    const f = u.get("file");
    if (f && files.some((x) => x.path === f)) setTimeout(() => void openFile(f, { line: Number(u.get("line")) || undefined }), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  // ------------------------------------------------------------ files

  const createEntry = useCallback<Ide["createEntry"]>(
    async (dir, kind, name) => {
      const path = (dir ? `${dir}/${name}` : name).replace(/\/+/g, "/");
      if (files.some((f) => f.path === path || f.path.startsWith(path + "/"))) throw new Error(`A file or folder ${name} already exists at this location.`);
      await api(`/api/workspaces/${wsId}/file`, { method: "PUT", json: { path: kind === "folder" ? `${path}/.gitkeep` : path, content: "" } });
      await loadFiles();
      if (kind === "file") await openFile(path, { preview: false });
    },
    [files, wsId, loadFiles, openFile],
  );
  const renameEntry = useCallback<Ide["renameEntry"]>(
    async (from, to, isDir) => {
      const moves = isDir ? files.filter((f) => f.path.startsWith(from + "/")).map((f) => [f.path, to + f.path.slice(from.length)]) : [[from, to]];
      for (const [a, b] of moves) {
        if (isDirty(a)) await save(a);
        await api(`/api/workspaces/${wsId}/file`, { method: "PATCH", json: { from: a, to: b } });
      }
      const map = new Map(moves.map(([a, b]) => [a, b]));
      setGroups((gs) =>
        gs.map((g) => {
          const tabs = g.tabs.map((t) => (t.kind === "file" && map.has(t.path) ? { ...t, path: map.get(t.path)!, id: tabId.file(map.get(t.path)!) } : t));
          const act = g.tabs.find((t) => t.id === g.active);
          return { tabs, active: act?.kind === "file" && map.has(act.path) ? tabId.file(map.get(act.path)!) : g.active };
        }),
      );
      setBuffers((b) => {
        const n = { ...b };
        for (const [a, c] of map) if (n[a]) {
          n[c] = n[a];
          delete n[a];
        }
        return n;
      });
      await loadFiles();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, wsId, loadFiles, save],
  );
  const deleteEntry = useCallback<Ide["deleteEntry"]>(
    async (path, isDir) => {
      const list = isDir ? files.filter((f) => f.path.startsWith(path + "/")).map((f) => f.path) : [path];
      if (!(await confirmDialog({ title: isDir ? `Are you sure you want to delete '${baseName(path)}' and its contents?` : `Are you sure you want to delete '${baseName(path)}'?`, body: "You can restore it from History.", confirmLabel: "Delete", danger: true }))) return;
      for (const p of list) await api(`/api/workspaces/${wsId}/file?path=${encodeURIComponent(p)}`, { method: "DELETE" }).catch((e) => toast(e.message, "error"));
      for (const [gi, g] of groupsRef.current.entries()) {
        const ids = g.tabs.filter((t) => t.kind === "file" && list.includes(t.path)).map((t) => t.id);
        if (ids.length) {
          setBuffers((b) => {
            const n = { ...b };
            list.forEach((p) => delete n[p]);
            return n;
          });
          updateGroup(gi, (grp) => {
            const tabs = grp.tabs.filter((t) => !ids.includes(t.id));
            return { tabs, active: tabs.some((t) => t.id === grp.active) ? grp.active : tabs[0]?.id ?? null };
          });
        }
      }
      await loadFiles();
    },
    [files, wsId, loadFiles, updateGroup],
  );

  // ------------------------------------------------------------ views & panel

  const showView = useCallback((v: View, toggle = false) => {
    setZen(false);
    setLayoutState((l) => {
      const n = { ...l, view: toggle && l.view === v ? null : v };
      writeJson(LAYOUT_KEY, n);
      return n;
    });
  }, []);
  const showPanel = useCallback((t: PanelTab) => setLayout({ panel: true, panelTab: t }), [setLayout]);
  const togglePanel = (t?: PanelTab) => setLayout(t && (!layout.panel || layout.panelTab !== t) ? { panel: true, panelTab: t } : { panel: !layout.panel });

  const focusedEditor = useCallback(() => {
    const k = lastEditor.current;
    const ed = k ? editors.current.get(k) : null;
    if (ed) return ed;
    const g = groupsRef.current[focusedGroup];
    for (const [key, e] of editors.current) if (g && key === `${focusedGroup}:${g.active}`) return e;
    return null;
  }, [focusedGroup]);

  const activeTab = groups[focusedGroup]?.tabs.find((t) => t.id === groups[focusedGroup]?.active) ?? null;
  const activePath = activeTab && "path" in activeTab ? activeTab.path : null;

  const askAgent = useCallback((path: string, selection = "") => setAsk({ path, selection }), []);

  // ------------------------------------------------------------ commands

  const edAction = (id: string) => () => {
    const ed = focusedEditor();
    if (!ed) return;
    ed.focus();
    ed.getAction(id)?.run() ?? ed.trigger("luma", id, null);
  };
  const changeFont = (d: number) => updateSettings({ "editor.fontSize": d === 0 ? 14 : Math.max(8, Math.min(40, settings["editor.fontSize"] + d)) });
  const git = (action: string) => async () => {
    try {
      const r = await api<{ message?: string }>(`/api/workspaces/${wsId}/git`, { method: "POST", json: { action } });
      toast(r.message ?? "Done");
      log("Source Control", `${action}: ${r.message ?? "done"}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
    refreshScm();
  };

  const commands: Command[] = useMemo(
    () => [
      { id: "workbench.action.showCommands", category: "View", title: "Show All Commands", keys: "Mod+Shift+P", run: () => setPalette({ kind: "quick", text: ">" }) },
      { id: "workbench.action.quickOpen", category: "Go", title: "Go to File…", keys: "Mod+P", run: () => setPalette({ kind: "quick", text: "" }) },
      { id: "workbench.action.gotoLine", category: "Go", title: "Go to Line/Column…", keys: "Ctrl+G", run: () => setPalette({ kind: "quick", text: ":" }) },
      { id: "workbench.action.gotoSymbol", category: "Go", title: "Go to Symbol in Editor…", keys: "Mod+Shift+O", run: edAction("editor.action.quickOutline") },
      { id: "editor.action.marker.nextInFiles", category: "Go", title: "Go to Next Problem", keys: "F8", run: edAction("editor.action.marker.nextInFiles") },
      { id: "file.new", category: "File", title: "New File…", keys: "Mod+Alt+N", when: () => canEdit, run: () => { showView("explorer"); setTimeout(() => window.dispatchEvent(new CustomEvent("luma-ide:new", { detail: "file" })), 30); } },
      { id: "file.newFolder", category: "File", title: "New Folder…", when: () => canEdit, run: () => { showView("explorer"); setTimeout(() => window.dispatchEvent(new CustomEvent("luma-ide:new", { detail: "folder" })), 30); } },
      { id: "workbench.action.files.save", category: "File", title: "Save", keys: "Mod+S", run: () => save() },
      { id: "workbench.action.files.saveAll", category: "File", title: "Save All", keys: "Mod+Alt+S", run: () => saveAll() },
      { id: "workbench.action.files.revert", category: "File", title: "Revert File", when: () => !!activePath, run: () => activePath && revert(activePath) },
      { id: "workbench.action.closeActiveEditor", category: "View", title: "Close Editor", keys: "Alt+W", run: () => activeTab && closeTabs(focusedGroup, [activeTab.id]) },
      { id: "workbench.action.closeAllEditors", category: "View", title: "Close All Editors", keys: "Mod+K Mod+W", run: () => groupsRef.current.forEach((g, i) => closeTabs(i, g.tabs.map((t) => t.id))) },
      { id: "workbench.action.reopenClosedEditor", category: "View", title: "Reopen Closed Editor", keys: "Alt+Shift+T", run: () => { const t = closedTabs[0]; if (t) { setClosedTabs((c) => c.slice(1)); placeTab(t); if ("path" in t) void ensureBuffer(t.path); } } },
      { id: "workbench.action.splitEditor", category: "View", title: "Split Editor", keys: "Mod+\\", run: () => ops.split(focusedGroup) },
      { id: "workbench.action.nextEditor", category: "View", title: "Open Next Editor", keys: "Alt+]", run: () => cycleTab(1) },
      { id: "workbench.action.previousEditor", category: "View", title: "Open Previous Editor", keys: "Alt+[", run: () => cycleTab(-1) },
      { id: "workbench.view.explorer", category: "View", title: "Show Explorer", keys: "Mod+Shift+E", run: () => showView("explorer") },
      { id: "workbench.view.search", category: "View", title: "Show Search", keys: "Mod+Shift+F", run: () => { showView("search"); const ed = focusedEditor(); const sel = ed?.getSelection(); const q = sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber ? ed?.getModel()?.getValueInRange(sel) ?? "" : ""; setSearchSeed({ q, n: Date.now() }); } },
      { id: "workbench.view.scm", category: "View", title: "Show Source Control", keys: "Ctrl+Shift+G", run: () => showView("scm") },
      { id: "luma.view.review", category: "View", title: "Show Code Review", keys: "Mod+Alt+R", run: () => showView("review") },
      { id: "workbench.action.toggleSidebarVisibility", category: "View", title: "Toggle Primary Side Bar Visibility", keys: "Mod+B", run: () => setLayout({ view: layout.view ? null : "explorer" }) },
      { id: "workbench.action.togglePanel", category: "View", title: "Toggle Panel Visibility", keys: "Mod+J", run: () => togglePanel() },
      { id: "workbench.action.terminal.toggleTerminal", category: "View", title: "Toggle Terminal", keys: "Ctrl+`", run: () => togglePanel("terminal") },
      { id: "workbench.actions.view.problems", category: "View", title: "Focus on Problems View", keys: "Mod+Shift+M", run: () => togglePanel("problems") },
      { id: "workbench.action.output.toggleOutput", category: "View", title: "Toggle Output", keys: "Mod+Shift+U", run: () => togglePanel("output") },
      { id: "workbench.panel.comments", category: "View", title: "Show Comments", run: () => showPanel("comments") },
      { id: "workbench.action.toggleZenMode", category: "View", title: "Toggle Zen Mode", keys: "Mod+K Z", run: () => setZen((z) => !z) },
      { id: "workbench.action.toggleFullWindow", category: "View", title: "Toggle Full Window (hide Luma navigation)", keys: "F11", run: () => setFullWindow((f) => !f) },
      { id: "workbench.action.toggleMaximizedPanel", category: "View", title: "Toggle Maximized Panel", run: () => { setLayout({ panel: true }); setMaxPanel((m) => !m); } },
      { id: "editor.action.toggleWordWrap", category: "View", title: "Toggle Word Wrap", keys: "Alt+Z", run: () => updateSettings({ "editor.wordWrap": settings["editor.wordWrap"] === "off" ? "on" : "off" }) },
      { id: "editor.action.toggleMinimap", category: "View", title: "Toggle Minimap", run: () => updateSettings({ "editor.minimap.enabled": !settings["editor.minimap.enabled"] }) },
      { id: "breadcrumbs.toggle", category: "View", title: "Toggle Breadcrumbs", run: () => updateSettings({ "breadcrumbs.enabled": !settings["breadcrumbs.enabled"] }) },
      { id: "workbench.action.zoomIn", category: "View", title: "Zoom In (Editor Font)", keys: "Mod+=", run: () => changeFont(1) },
      { id: "workbench.action.zoomOut", category: "View", title: "Zoom Out (Editor Font)", keys: "Mod+-", run: () => changeFont(-1) },
      { id: "workbench.action.zoomReset", category: "View", title: "Reset Zoom", keys: "Mod+0", run: () => changeFont(0) },
      { id: "workbench.action.openSettings", category: "Preferences", title: "Open Settings (UI)", keys: "Mod+,", run: () => openSpecial("settings") },
      { id: "workbench.action.openSettingsJson", category: "Preferences", title: "Open User Settings (JSON)", run: () => openSpecial("settings-json") },
      { id: "workbench.action.openGlobalKeybindings", category: "Preferences", title: "Open Keyboard Shortcuts", keys: "Mod+K Mod+S", run: () => openSpecial("keybindings") },
      { id: "workbench.action.selectTheme", category: "Preferences", title: "Color Theme", keys: "Mod+K Mod+T", run: () => setPalette({ kind: "theme" }) },
      { id: "editor.action.formatDocument", category: "Edit", title: "Format Document", keys: "Shift+Alt+F", run: edAction("editor.action.formatDocument") },
      { id: "actions.find", category: "Edit", title: "Find", keys: "Mod+F", run: edAction("actions.find") },
      { id: "editor.action.startFindReplaceAction", category: "Edit", title: "Replace", keys: "Mod+H", run: edAction("editor.action.startFindReplaceAction") },
      { id: "editor.action.commentLine", category: "Edit", title: "Toggle Line Comment", keys: "Mod+/", run: edAction("editor.action.commentLine") },
      { id: "workbench.action.replaceInFiles", category: "Edit", title: "Replace in Files", keys: "Mod+Shift+H", run: () => { showView("search"); setSearchSeed({ q: "", n: Date.now() }); } },
      { id: "luma.preview", category: "Luma", title: "Open Preview to the Side", run: () => openSpecial("preview", true) },
      { id: "luma.askAgent", category: "Luma", title: "Ask an Agent…", keys: "Mod+I", when: () => canEdit, run: () => { const ed = focusedEditor(); const sel = ed?.getSelection(); const text = sel && ed?.getModel() ? ed.getModel()!.getValueInRange(sel) : ""; setAsk({ path: activePath ?? "", selection: text }); } },
      { id: "luma.aiReviewFile", category: "Luma", title: "Review Current File with AI", when: () => canEdit && !!activePath, run: async () => { if (!activePath) return; log("Code Review", `AI reviewing ${activePath}…`); toast("Reviewing with AI…", "info"); try { const r = await api<{ summary: string; comments: number }>(`/api/workspaces/${wsId}/review`, { method: "POST", json: { action: "ai", path: activePath } }); log("Code Review", `${activePath}: ${r.summary} (${r.comments} comments)`); toast(`AI review: ${r.comments} comment${r.comments === 1 ? "" : "s"}`); refreshThreads(); } catch (e) { toast((e as Error).message, "error"); } } },
      { id: "luma.addComment", category: "Luma", title: "Add Review Comment on Current Line", when: () => canEdit, run: () => focusedEditor()?.getAction("luma.addComment")?.run() },
      { id: "luma.simpleMode", category: "Luma", title: "Switch to Simple Mode (Preview Only)", run: onSimpleMode },
      { id: "luma.openBoard", category: "Luma", title: "Open Board", run: () => router.push(`/w/${wsId}/board`) },
      { id: "luma.openAgents", category: "Luma", title: "Open Agents", run: () => router.push(`/w/${wsId}/agents`) },
      { id: "luma.openShip", category: "Luma", title: "Open Ship (GitHub & Deploy)", run: () => router.push(`/w/${wsId}/ship`) },
      { id: "git.init", category: "Git", title: "Initialize Repository", when: () => !!scm && !scm.repo && canEdit, run: git("enable") },
      { id: "git.commit", category: "Git", title: "Commit", run: () => showView("scm") },
      { id: "git.pull", category: "Git", title: "Pull", when: () => !!scm?.repo && !!scm.remote, run: git("pull") },
      { id: "git.push", category: "Git", title: "Push", when: () => !!scm?.repo && !!scm.remote, run: git("push") },
      { id: "git.refresh", category: "Git", title: "Refresh", run: () => refreshScm() },
      { id: "workbench.action.openWalkthrough", category: "Help", title: "Welcome", run: () => openSpecial("welcome") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, layout, focusedGroup, activeTab, activePath, canEdit, scm, closedTabs, wsId, save, saveAll, closeTabs, openSpecial, showView],
  );
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const runCommand = useCallback((id: string) => commandsRef.current.find((c) => c.id === id)?.run(), []);

  function cycleTab(d: number) {
    const g = groupsRef.current[focusedGroup];
    if (!g?.tabs.length) return;
    const i = g.tabs.findIndex((t) => t.id === g.active);
    ops.activate(focusedGroup, g.tabs[(i + d + g.tabs.length) % g.tabs.length].id);
  }

  // Global keyboard shortcuts (Monaco handles its own while focused).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (palette) return;
      const t = e.target as HTMLElement;
      const inField = /INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.closest(".monaco-editor");
      if (chord.current && Date.now() - chord.current.at < 2000) {
        chord.current = null;
        for (const c of commandsRef.current) {
          const parts = c.keys?.split(" ");
          if (parts?.length === 2 && matches(e, parts[1])) {
            e.preventDefault();
            c.run();
            return;
          }
        }
        return;
      }
      if (matches(e, "Mod+K") && !t.closest(".monaco-editor")) {
        chord.current = { at: Date.now() };
        e.preventDefault();
        return;
      }
      for (const c of commandsRef.current) {
        if (!c.keys || c.keys.includes(" ")) continue;
        if (inField && !/Mod|F\d|Ctrl/.test(c.keys)) continue;
        if (["Mod+F", "Mod+H", "Mod+/", "Shift+Alt+F", "F8"].includes(c.keys) && !t.closest(".monaco-editor")) continue;
        if (matches(e, c.keys) || (c.keys === "Mod+Shift+P" && e.key === "F1")) {
          if (c.when && !c.when()) return;
          e.preventDefault();
          e.stopPropagation();
          c.run();
          return;
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [palette]);

  // ------------------------------------------------------------ open editors list (explorer)

  setOpenEditorsSource(() =>
    groups.flatMap((g, gi) =>
      g.tabs.map((t) => ({
        key: `${gi}:${t.id}`,
        title: tabTitle(t),
        path: "path" in t ? t.path : null,
        dirty: "path" in t && !!buffers[t.path] && buffers[t.path].content !== buffers[t.path].saved,
        open: () => {
          ops.activate(gi, t.id);
          setFocusedGroup(gi);
        },
        close: () => ops.close(gi, [t.id]),
      })),
    ),
  );

  // ------------------------------------------------------------ context value

  const ide: Ide = {
    wsId,
    workspaceName: workspace?.name ?? "Workspace",
    canEdit,
    files,
    buffers,
    settings,
    updateSettings,
    monacoTheme: theme.monaco,
    dark: theme.dark,
    monaco,
    setMonaco: (m) => setMonacoState((cur) => cur ?? m),
    view: layout.view,
    showView,
    openFile,
    openDiff,
    openReview,
    openSpecial,
    ensureBuffer,
    setBuffer,
    save,
    saveAll,
    revert,
    loadFiles,
    activePath,
    revealPath,
    createEntry,
    renameEntry,
    deleteEntry,
    scm,
    refreshScm,
    threads,
    refreshThreads,
    problems,
    output,
    log,
    showPanel,
    commands,
    runCommand,
    askAgent,
    registerEditor: (key, ed) => {
      if (ed) {
        editors.current.set(key, ed);
        lastEditor.current = key;
      } else {
        editors.current.delete(key);
        if (lastEditor.current === key) lastEditor.current = null;
      }
    },
    focusedEditor,
    setCursor,
    searchSeed,
    reveal,
    previewVersion,
    bumpPreview: () => setPreviewVersion((v) => v + 1),
  };

  // ------------------------------------------------------------ render

  const changes = scm?.repo ? scm.staged.length + scm.changes.length : 0;
  const needsReview = tickets.filter((t) => t.status === "in_review").length;
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const openThreads = threads.filter((t) => t.status === "open").length;
  const running = tickets.filter((t) => t.running);
  const lastActivity = activity[activity.length - 1];
  const showSidebar = !zen && !!layout.view;
  const showPanelArea = !zen && layout.panel;
  const right = settings["workbench.sideBar.location"] === "right";

  const activity_: [View, ReactNode, string, number][] = [
    ["explorer", <Files key="e" size={24} strokeWidth={1.5} />, `Explorer (${kbd("Mod+Shift+E")})`, 0],
    ["search", <Search key="s" size={24} strokeWidth={1.5} />, `Search (${kbd("Mod+Shift+F")})`, 0],
    ["scm", <GitBranch key="g" size={24} strokeWidth={1.5} />, `Source Control (${kbd("Ctrl+Shift+G")})`, changes],
    ["review", <GitPullRequestArrow key="r" size={24} strokeWidth={1.5} />, `Code Review (${kbd("Mod+Alt+R")})`, needsReview],
  ];

  const sidebarEl = showSidebar && (
    <>
      <div className="shrink-0 min-h-0 flex flex-col" style={{ width: layout.sidebar, background: "var(--ide-side)", [right ? "borderLeft" : "borderRight"]: "1px solid var(--ide-border)" }}>
        {layout.view === "explorer" && <ExplorerView />}
        {layout.view === "search" && <SearchView />}
        {layout.view === "scm" && <ScmView />}
        {layout.view === "review" && <ReviewView />}
      </div>
      <Splitter dir="x" onDrag={(dx) => setLayoutState((l) => ({ ...l, sidebar: Math.max(170, Math.min(640, l.sidebar + (right ? -dx : dx))) }))} onEnd={() => writeJson(LAYOUT_KEY, layout)} />
    </>
  );

  return (
    <IdeCtx.Provider value={ide}>
      <div
        className={clsx("ide flex flex-col min-h-0 select-none", fullWindow ? "fixed inset-0 z-50" : "h-full")}
        data-theme={theme.cls}
        style={{ colorScheme: theme.dark ? "dark" : "light" }}
      >
        <TitleBar
          fullWindow={fullWindow}
          onToggleFull={() => setFullWindow((f) => !f)}
          onSimpleMode={onSimpleMode}
          sidebar={!!layout.view}
          panel={layout.panel}
          onToggleSidebar={() => runCommand("workbench.action.toggleSidebarVisibility")}
          onTogglePanel={() => togglePanel()}
          onCommandCenter={() => setPalette({ kind: "quick", text: "" })}
        />
        <div className={clsx("flex-1 min-h-0 flex", right && "flex-row-reverse")}>
          {!zen && (
            <div className="w-12 shrink-0 flex flex-col items-center" style={{ background: "var(--ide-act)", [right ? "borderLeft" : "borderRight"]: "1px solid var(--ide-border)" }}>
              {activity_.map(([v, icon, title, badge]) => (
                <button
                  key={v}
                  title={title}
                  className="relative w-12 h-12 grid place-items-center"
                  style={{ color: layout.view === v ? "var(--ide-act-fg)" : "var(--ide-act-dim)", boxShadow: layout.view === v ? `inset ${right ? "-2px" : "2px"} 0 0 var(--ide-act-fg)` : undefined }}
                  onClick={() => showView(v, true)}
                >
                  {icon}
                  {badge > 0 && <span className="ide-badge absolute bottom-2 right-1.5" style={{ background: "#0078d4" }}>{badge > 99 ? "99+" : badge}</span>}
                </button>
              ))}
              <div className="mt-auto" />
              <button
                title="Manage"
                className="w-12 h-12 grid place-items-center"
                style={{ color: "var(--ide-act-dim)" }}
                onClick={(e) =>
                  gearMenu.open({ clientX: e.clientX + 30, clientY: e.clientY - 200, preventDefault: () => undefined }, [
                    { label: "Command Palette…", keys: "Mod+Shift+P", onClick: () => runCommand("workbench.action.showCommands") },
                    { sep: true },
                    { label: "Settings", keys: "Mod+,", onClick: () => openSpecial("settings") },
                    { label: "Keyboard Shortcuts", keys: "Mod+K Mod+S", onClick: () => openSpecial("keybindings") },
                    { label: "Themes", keys: "Mod+K Mod+T", onClick: () => setPalette({ kind: "theme" }) },
                    { label: "Import VS Code Settings…", onClick: () => openSpecial("settings-json") },
                    { sep: true },
                    { label: "Luma Settings (Claude, GitHub, Team)…", onClick: () => router.push("/settings") },
                  ])
                }
              >
                <Settings size={22} strokeWidth={1.5} />
              </button>
            </div>
          )}
          {sidebarEl}
          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            {!(showPanelArea && maxPanel) && (
              <div className="flex-1 min-h-0 flex">
                {groups.map((g, i) => (
                  <div key={i} className="min-w-0 min-h-0 flex" style={{ flex: groups.length > 1 ? (i === 0 ? layout.split : 1 - layout.split) : 1 }}>
                    {i > 0 && <Splitter dir="x" onDrag={(dx, el) => { const w = el.parentElement?.parentElement?.clientWidth ?? 1000; setLayoutState((l) => ({ ...l, split: Math.max(0.15, Math.min(0.85, l.split + dx / w)) })); }} onEnd={() => writeJson(LAYOUT_KEY, layout)} />}
                    <div className="flex-1 min-w-0 min-h-0" style={{ borderLeft: i > 0 ? "1px solid var(--ide-border)" : undefined }}>
                      <EditorGroup index={i} group={g} focused={focusedGroup === i} ops={ops} groupCount={groups.length} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showPanelArea && (
              <>
                {!maxPanel && <Splitter dir="y" onDrag={(_, __, dy) => setLayoutState((l) => ({ ...l, panelHeight: Math.max(100, Math.min(window.innerHeight - 200, l.panelHeight - dy)) }))} onEnd={() => writeJson(LAYOUT_KEY, layout)} />}
                <div className={clsx("shrink-0 min-h-0", maxPanel && "flex-1")} style={{ height: maxPanel ? undefined : layout.panelHeight }}>
                  <Panel tab={layout.panelTab} setTab={(t) => setLayout({ panelTab: t })} maximized={maxPanel} onMaximize={() => setMaxPanel((m) => !m)} onClose={() => { setLayout({ panel: false }); setMaxPanel(false); }} />
                </div>
              </>
            )}
          </div>
        </div>
        {/* Status bar */}
        <div className="h-[22px] shrink-0 flex items-center text-[12px] select-none overflow-hidden" style={{ background: "var(--ide-status)", color: "var(--ide-status-fg)", borderTop: "1px solid var(--ide-status-border)" }}>
          <span className="h-full px-2.5 flex items-center gap-1 text-white shrink-0" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }} title={`Luma workspace: ${workspace?.name}`}>
            <Sparkles size={12} /> Luma
          </span>
          {scm?.repo && (
            <SBItem title="Source Control" onClick={() => showView("scm")}>
              <GitBranch size={13} /> {scm.branch}
              {changes > 0 && "*"}
            </SBItem>
          )}
          {scm?.repo && scm.remote && (
            <SBItem title="Synchronize Changes" onClick={() => showView("scm")}>
              <RefreshCw size={12} /> {scm.behind ?? 0}↓ {scm.ahead ?? 0}↑
            </SBItem>
          )}
          <SBItem title="Problems" onClick={() => togglePanel("problems")}>
            <AlertCircle size={13} /> {errors} <AlertTriangle size={13} className="ml-1" /> {warnings}
          </SBItem>
          {running.length > 0 && (
            <SBItem title="Show agent output" onClick={() => showPanel("output")}>
              <Loader2 size={12} className="animate-spin" />
              <span className="truncate max-w-[320px]">
                {running.length === 1 ? `${agents.find((a) => a.id === running[0].assigneeId)?.name ?? "Agent"} working on LUM-${running[0].number}` : `${running.length} agents working`}
                {lastActivity && running.length === 1 ? ` — ${lastActivity.text.slice(0, 60)}` : ""}
              </span>
            </SBItem>
          )}
          <span className="ml-auto" />
          {openThreads > 0 && (
            <SBItem title="Review comments" onClick={() => showPanel("comments")}>
              <MessageSquare size={12} /> {openThreads}
            </SBItem>
          )}
          {cursor && activePath && (
            <SBItem title="Go to Line/Column" onClick={() => setPalette({ kind: "quick", text: ":" })}>
              Ln {cursor.line}, Col {cursor.col}
              {cursor.sel ? ` (${cursor.sel} selected)` : ""}
            </SBItem>
          )}
          {activePath && (
            <>
              <SBItem title="Select Indentation" onClick={() => openSpecial("settings")}>
                {settings["editor.insertSpaces"] ? "Spaces" : "Tab Size"}: {settings["editor.tabSize"]}
              </SBItem>
              <SBItem title="Select Encoding">UTF-8</SBItem>
              <SBItem title="Select End of Line Sequence">LF</SBItem>
              <SBItem title="Select Language Mode">{LANG_NAMES[langOf(activePath)] ?? "Plain Text"}</SBItem>
            </>
          )}
          <SBItem title={`Layout: ${groups.length > 1 ? "Split" : "Single"} editor`} onClick={() => setPalette({ kind: "theme" })}>
            {theme.dark ? "◐" : "◑"}
          </SBItem>
          <SBItem title="Notifications" onClick={() => showPanel("output")}>
            <Bell size={12} />
          </SBItem>
        </div>
        {palette && <Palette mode={palette} onClose={() => setPalette(null)} recentFiles={recentFiles} />}
        {gearMenu.node}
        {ask && <AskAgentModal path={ask.path} selection={ask.selection} onClose={() => setAsk(null)} />}
      </div>
    </IdeCtx.Provider>
  );
}

function SBItem({ children, title, onClick }: { children: ReactNode; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} className="h-full px-2 flex items-center gap-1 shrink-0 hover:bg-[rgba(255,255,255,.12)]" style={{ cursor: onClick ? "pointer" : "default" }}>
      {children}
    </button>
  );
}

function Splitter({ dir, onDrag, onEnd }: { dir: "x" | "y"; onDrag: (dx: number, el: HTMLElement, dy: number) => void; onEnd?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  return (
    <div
      ref={ref}
      className={clsx("shrink-0 relative z-10", dir === "x" ? "w-[4px] -mx-[2px] cursor-col-resize" : "h-[4px] -my-[2px] cursor-row-resize")}
      style={{ background: active ? "var(--ide-focus)" : "transparent" }}
      onMouseEnter={(e) => e.currentTarget.style.setProperty("background", "var(--ide-focus)")}
      onMouseLeave={(e) => !active && e.currentTarget.style.setProperty("background", "transparent")}
      onMouseDown={(e) => {
        e.preventDefault();
        setActive(true);
        let x = e.clientX;
        let y = e.clientY;
        document.body.style.cursor = dir === "x" ? "col-resize" : "row-resize";
        const move = (ev: MouseEvent) => {
          onDrag(ev.clientX - x, ref.current!, ev.clientY - y);
          x = ev.clientX;
          y = ev.clientY;
        };
        const up = () => {
          setActive(false);
          document.body.style.cursor = "";
          if (ref.current) ref.current.style.background = "transparent";
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          onEnd?.();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

// ---------------------------------------------------------------- title bar with VS Code menus

function TitleBar(p: { fullWindow: boolean; onToggleFull: () => void; onSimpleMode: () => void; sidebar: boolean; panel: boolean; onToggleSidebar: () => void; onTogglePanel: () => void; onCommandCenter: () => void }) {
  const ide = useIde();
  const menu = useContextMenu();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const c = (id: string, label?: string): MenuItem => {
    const cmd = ide.commands.find((x) => x.id === id);
    return { label: label ?? cmd?.title ?? id, keys: cmd?.keys, disabled: !cmd || (cmd.when ? !cmd.when() : false), onClick: () => ide.runCommand(id) };
  };
  const ed = (action: string, label: string, keys?: string): MenuItem => ({
    label,
    keys,
    onClick: () => {
      const e = ide.focusedEditor();
      if (!e) return;
      e.focus();
      if (["undo", "redo"].includes(action)) e.trigger("menu", action, null);
      else if (["cut", "copy"].includes(action)) document.execCommand(action);
      else if (action === "paste") navigator.clipboard.readText().then((t) => e.trigger("menu", "type", { text: t })).catch(() => toast("Use the keyboard to paste (the browser blocked clipboard access).", "info"));
      else e.getAction(action)?.run();
    },
  });
  const menus: Record<string, MenuItem[]> = {
    File: [c("file.new"), c("file.newFolder"), { sep: true }, c("workbench.action.quickOpen", "Open File…"), { sep: true }, c("workbench.action.files.save"), c("workbench.action.files.saveAll"), { sep: true }, c("workbench.action.files.revert"), c("workbench.action.closeActiveEditor"), c("workbench.action.closeAllEditors"), { sep: true }, c("workbench.action.openSettings", "Preferences: Settings"), c("workbench.action.openGlobalKeybindings", "Preferences: Keyboard Shortcuts"), c("workbench.action.selectTheme", "Preferences: Color Theme")],
    Edit: [ed("undo", "Undo", "Mod+Z"), ed("redo", "Redo", "Mod+Shift+Z"), { sep: true }, ed("cut", "Cut", "Mod+X"), ed("copy", "Copy", "Mod+C"), ed("paste", "Paste", "Mod+V"), { sep: true }, ed("actions.find", "Find", "Mod+F"), ed("editor.action.startFindReplaceAction", "Replace", "Mod+H"), { sep: true }, c("workbench.view.search", "Find in Files"), c("workbench.action.replaceInFiles"), { sep: true }, ed("editor.action.commentLine", "Toggle Line Comment", "Mod+/"), ed("editor.action.blockComment", "Toggle Block Comment", "Shift+Alt+A"), c("editor.action.formatDocument")],
    Selection: [ed("editor.action.selectAll", "Select All", "Mod+A"), ed("editor.action.smartSelect.expand", "Expand Selection", "Shift+Alt+Right"), ed("editor.action.smartSelect.shrink", "Shrink Selection", "Shift+Alt+Left"), { sep: true }, ed("editor.action.copyLinesUpAction", "Copy Line Up", "Shift+Alt+Up"), ed("editor.action.copyLinesDownAction", "Copy Line Down", "Shift+Alt+Down"), ed("editor.action.moveLinesUpAction", "Move Line Up", "Alt+Up"), ed("editor.action.moveLinesDownAction", "Move Line Down", "Alt+Down"), { sep: true }, ed("editor.action.insertCursorAbove", "Add Cursor Above", "Mod+Alt+Up"), ed("editor.action.insertCursorBelow", "Add Cursor Below", "Mod+Alt+Down"), ed("editor.action.addSelectionToNextFindMatch", "Add Next Occurrence", "Mod+D"), ed("editor.action.selectHighlights", "Select All Occurrences", "Mod+Shift+L")],
    View: [c("workbench.action.showCommands", "Command Palette…"), { sep: true }, c("workbench.view.explorer", "Explorer"), c("workbench.view.search", "Search"), c("workbench.view.scm", "Source Control"), c("luma.view.review", "Code Review"), { sep: true }, c("workbench.actions.view.problems", "Problems"), c("workbench.action.output.toggleOutput", "Output"), c("workbench.action.terminal.toggleTerminal", "Terminal"), c("workbench.panel.comments", "Comments"), { sep: true }, c("workbench.action.toggleSidebarVisibility", "Primary Side Bar"), c("workbench.action.togglePanel", "Panel"), c("workbench.action.toggleZenMode", "Zen Mode"), c("workbench.action.toggleFullWindow", "Full Window"), { sep: true }, c("editor.action.toggleWordWrap", "Word Wrap"), c("editor.action.toggleMinimap", "Minimap"), c("breadcrumbs.toggle", "Breadcrumbs"), { sep: true }, c("workbench.action.zoomIn", "Zoom In"), c("workbench.action.zoomOut", "Zoom Out")],
    Go: [c("workbench.action.quickOpen", "Go to File…"), c("workbench.action.gotoSymbol", "Go to Symbol in Editor…"), c("workbench.action.gotoLine", "Go to Line/Column…"), { sep: true }, ed("editor.action.revealDefinition", "Go to Definition", "F12"), ed("editor.action.goToReferences", "Go to References", "Shift+F12"), { sep: true }, c("editor.action.marker.nextInFiles", "Next Problem"), { sep: true }, c("workbench.action.nextEditor", "Next Editor"), c("workbench.action.previousEditor", "Previous Editor")],
    Luma: [c("luma.askAgent"), c("luma.aiReviewFile"), c("luma.addComment"), { sep: true }, c("luma.preview"), c("luma.simpleMode"), { sep: true }, c("luma.openBoard"), c("luma.openAgents"), c("luma.openShip")],
    Terminal: [c("workbench.action.terminal.toggleTerminal", "New Terminal"), { sep: true }, { label: "Run Command…", onClick: () => ide.showPanel("terminal") }],
    Help: [c("workbench.action.openWalkthrough", "Welcome"), c("workbench.action.showCommands", "Show All Commands"), c("workbench.action.openGlobalKeybindings", "Keyboard Shortcuts Reference")],
  };
  const openAt = (name: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpenMenu(name);
    menu.open({ clientX: r.left, clientY: r.bottom + 2, preventDefault: () => undefined }, menus[name]);
  };
  useEffect(() => {
    if (!menu.node) setOpenMenu(null);
  }, [menu.node]);
  return (
    <div className="h-[35px] shrink-0 flex items-center px-1.5 gap-1 text-[13px]" style={{ background: "var(--ide-title)", borderBottom: "1px solid var(--ide-border)" }}>
      <span className="w-6 h-6 mx-1 rounded-md grid place-items-center text-white text-[11px] font-bold shrink-0" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>L</span>
      <nav className="hidden md:flex">
        {Object.keys(menus).map((m) => (
          <button
            key={m}
            className="px-2 h-[26px] rounded"
            style={{ background: openMenu === m ? "rgba(128,128,128,.25)" : undefined }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (openMenu === m) setOpenMenu(null);
              else openAt(m, e.currentTarget);
            }}
            onMouseEnter={(e) => openMenu && openMenu !== m && openAt(m, e.currentTarget)}
          >
            {m}
          </button>
        ))}
      </nav>
      <button
        className="mx-auto flex items-center justify-center gap-2 h-[24px] w-[min(38vw,520px)] rounded-md text-[12.5px]"
        style={{ background: "rgba(128,128,128,.12)", border: "1px solid var(--ide-border)", color: "var(--ide-muted)" }}
        onClick={p.onCommandCenter}
        title={`Search files (${kbd("Mod+P")}) · Commands (${kbd("Mod+Shift+P")})`}
      >
        <Search size={13} /> {ide.workspaceName}
      </button>
      <span className="flex items-center gap-0.5">
        <button className="ide-icon-btn" title="Simple mode (preview only)" onClick={p.onSimpleMode}><Eye size={15} /></button>
        <button className={clsx("ide-icon-btn", p.sidebar && "opacity-100")} title={`Toggle Primary Side Bar (${kbd("Mod+B")})`} onClick={p.onToggleSidebar}><PanelLeft size={15} /></button>
        <button className="ide-icon-btn" title={`Toggle Panel (${kbd("Mod+J")})`} onClick={p.onTogglePanel}><PanelBottom size={15} /></button>
        <button className="ide-icon-btn" title={p.fullWindow ? "Exit Full Window (F11)" : "Full Window (F11)"} onClick={p.onToggleFull}>{p.fullWindow ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </span>
      {menu.node}
    </div>
  );
}

// ---------------------------------------------------------------- ask an agent

function AskAgentModal({ path, selection, onClose }: { path: string; selection: string; onClose: () => void }) {
  const { workspace, agents, reload, openTicket } = useWorkspace();
  const [request, setRequest] = useState("");
  const [agentId, setAgentId] = useState(agents.find((a) => /frontend|developer|engineer/i.test(a.role))?.id ?? agents[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const where = path ? `\n\nFile: ${path}` : "";
      const description = `${request}${where}${selection ? `\n\nSelected code:\n\`\`\`\n${selection}\n\`\`\`` : ""}`;
      const { ticket } = await api<{ ticket: { id: string } }>(`/api/workspaces/${workspace!.id}/tickets`, {
        method: "POST",
        json: { title: request.split("\n")[0].slice(0, 80) || `Change ${path}`, description, assigneeId: agentId },
      });
      await api(`/api/tickets/${ticket.id}/run`, { method: "POST" }).catch((e) => setError(e.message));
      await reload();
      onClose();
      toast("Ticket created — the agent is on it");
      openTicket(ticket.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Ask an agent">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Creates a ticket{path ? <> about <span className="font-mono">{path}</span></> : ""}
          {selection ? ` with the ${selection.split("\n").length} selected line(s)` : ""} and starts the agent.
        </p>
        {selection && <pre className="text-[11.5px] bg-panel-2 rounded-lg p-2 max-h-32 overflow-auto scroll-thin">{selection}</pre>}
        <textarea
          className="input"
          rows={3}
          placeholder="e.g. Make this section stack vertically on phones"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim() && submit()}
          autoFocus
        />
        <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar} {a.name} — {a.role}</option>
          ))}
        </select>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!request.trim() || busy}>{busy ? "Starting…" : "Create & run"}</button>
        </div>
      </div>
    </Modal>
  );
}

export { dirName };
