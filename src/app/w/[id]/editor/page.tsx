"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FilePlus,
  Folder,
  History,
  Monitor,
  Pencil,
  RefreshCw,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  X,
  Eye,
  Code2,
  TerminalSquare,
} from "lucide-react";
import type { OnMount } from "@monaco-editor/react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { SimulatorPreview } from "@/components/SimulatorPreview";
import { DiffModal } from "@/components/DiffViewer";
import { TerminalPanel } from "@/components/TerminalPanel";
import { ErrorNote, Modal } from "@/components/ui";
import { agentById, api, timeAgo } from "@/lib/client";
import type { Checkpoint } from "@/lib/types";

// Monaco is served from /public/monaco (copied on npm install), so no CDN is needed.
const Monaco = dynamic(
  () =>
    import("@monaco-editor/react").then((m) => {
      m.loader.config({ paths: { vs: `${window.location.origin}/monaco/vs` } });
      return m.default;
    }),
  {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-muted">Loading editor…</div>,
  },
);

interface FileEntry {
  path: string;
  size: number;
}
interface Buffer {
  content: string;
  saved: string;
}

const LANG: Record<string, string> = {
  html: "html", htm: "html", css: "css", js: "javascript", mjs: "javascript", ts: "typescript", tsx: "typescript",
  jsx: "javascript", dart: "dart", json: "json", md: "markdown", svg: "xml", xml: "xml", py: "python", yml: "yaml", yaml: "yaml",
};
const langOf = (p: string) => LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

export default function EditorPageWrapper() {
  return (
    <Suspense>
      <EditorPage />
    </Suspense>
  );
}

function EditorPage() {
  const { workspace, fileVersion, agents, openTicket, reload } = useWorkspace();
  const search = useSearchParams();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, Buffer>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [simple, setSimple] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewKey, setPreviewKey] = useState(0);
  const [previewPath, setPreviewPath] = useState("");
  const [history, setHistory] = useState<Checkpoint[] | null>(null);
  const [diffCp, setDiffCp] = useState<string | null>(null);
  const [terminal, setTerminal] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;

  const wsId = workspace?.id;

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try {
      setSimple(localStorage.getItem("luma-simple-mode") === "1");
    } catch {}
  }, []);

  const loadFiles = useCallback(async () => {
    if (!wsId) return;
    const d = await api<{ files: FileEntry[] }>(`/api/workspaces/${wsId}/files`);
    setFiles(d.files);
    return d.files;
  }, [wsId]);

  const openFile = useCallback(
    async (path: string) => {
      if (!wsId) return;
      setOpen((o) => (o.includes(path) ? o : [...o, path]));
      setActive(path);
      if (buffersRef.current[path]) return;
      try {
        const d = await api<{ content: string }>(`/api/workspaces/${wsId}/file?path=${encodeURIComponent(path)}`);
        setBuffers((b) => ({ ...b, [path]: { content: d.content, saved: d.content } }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [wsId],
  );

  // initial load
  useEffect(() => {
    loadFiles().then((list) => {
      if (!list) return;
      const wanted = search.get("file");
      const first = wanted && list.some((f) => f.path === wanted) ? wanted : list.find((f) => f.path === "index.html")?.path ?? list.find((f) => f.path === "lib/main.dart")?.path ?? list[0]?.path;
      if (first) openFile(first);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  // agent (or other tab) changed files: refresh list, clean buffers and preview
  useEffect(() => {
    if (!fileVersion || !wsId) return;
    loadFiles();
    setPreviewKey((k) => k + 1);
    const current = buffersRef.current;
    Object.entries(current).forEach(async ([path, buf]) => {
      if (buf.content !== buf.saved) return; // keep the user's unsaved edits
      try {
        const d = await api<{ content: string }>(`/api/workspaces/${wsId}/file?path=${encodeURIComponent(path)}`);
        setBuffers((b) => ({ ...b, [path]: { content: d.content, saved: d.content } }));
      } catch {
        // file deleted
        setBuffers((b) => {
          const n = { ...b };
          delete n[path];
          return n;
        });
        setOpen((o) => o.filter((p) => p !== path));
        setActive((a) => (a === path ? null : a));
      }
    });
  }, [fileVersion, wsId, loadFiles]);

  const save = useCallback(
    async (path = active) => {
      if (!wsId || !path) return;
      const buf = buffersRef.current[path];
      if (!buf || buf.content === buf.saved) return;
      try {
        await api(`/api/workspaces/${wsId}/file`, { method: "PUT", json: { path, content: buf.content } });
        setBuffers((b) => ({ ...b, [path]: { ...b[path], saved: buf.content } }));
        setPreviewKey((k) => k + 1);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [active, wsId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const closeTab = (path: string) => {
    const buf = buffers[path];
    if (buf && buf.content !== buf.saved && !confirm(`Discard unsaved changes to ${path}?`)) return;
    setOpen((o) => {
      const next = o.filter((p) => p !== path);
      if (active === path) setActive(next[next.length - 1] ?? null);
      return next;
    });
    setBuffers((b) => {
      const n = { ...b };
      delete n[path];
      return n;
    });
  };

  const newFile = async () => {
    const path = prompt("New file path (e.g. pages/about.html):");
    if (!path || !wsId) return;
    try {
      await api(`/api/workspaces/${wsId}/file`, { method: "PUT", json: { path, content: "" } });
      await loadFiles();
      openFile(path.replace(/^\/+/, ""));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const renameFile = async (from: string) => {
    const to = prompt("Rename to:", from);
    if (!to || to === from || !wsId) return;
    try {
      await api(`/api/workspaces/${wsId}/file`, { method: "PATCH", json: { from, to } });
      setOpen((o) => o.map((p) => (p === from ? to : p)));
      setBuffers((b) => {
        const n = { ...b, [to]: b[from] };
        delete n[from];
        return n;
      });
      if (active === from) setActive(to);
      loadFiles();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteFile = async (path: string) => {
    if (!wsId || !confirm(`Delete ${path}? You can restore it from version history.`)) return;
    await api(`/api/workspaces/${wsId}/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  };

  const showHistory = async () => {
    if (!wsId) return;
    const d = await api<{ checkpoints: Checkpoint[] }>(`/api/workspaces/${wsId}/checkpoints${active ? `?path=${encodeURIComponent(active)}` : ""}`);
    setHistory(d.checkpoints);
  };
  const restore = async (cp: Checkpoint) => {
    if (!wsId) return;
    if (!confirm(`Restore ${cp.path} to how it was before this change?`)) return;
    // drop the local buffer so we pick up the restored version
    setBuffers((b) => ({ ...b, [cp.path]: { content: b[cp.path]?.saved ?? "", saved: b[cp.path]?.saved ?? "" } }));
    await api(`/api/workspaces/${wsId}/checkpoints`, { method: "POST", json: { checkpointId: cp.id } });
    setHistory(null);
  };

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  const askAgent = () => {
    const ed = editorRef.current;
    const sel = ed?.getSelection();
    const text = sel && ed?.getModel() ? ed.getModel()!.getValueInRange(sel) : "";
    setSelection(text);
    setAskOpen(true);
  };

  const toggleSimple = () => {
    setSimple((s) => {
      try {
        localStorage.setItem("luma-simple-mode", s ? "0" : "1");
      } catch {}
      return !s;
    });
  };

  const tree = useMemo(() => buildTree(files), [files]);
  const activeBuf = active ? buffers[active] : undefined;
  const previewSrc = wsId ? `/preview/${wsId}/${previewPath}` : "";
  const width = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  const isFlutter = workspace?.platform === "flutter" || files.some((f) => f.path === "pubspec.yaml");
  const webPreview = (
    <div className="flex flex-col min-h-0 h-full bg-panel-2">
      <div className="flex items-center gap-1 h-10 px-2 border-b bg-panel shrink-0">
        <span className="text-xs font-semibold text-muted px-1">Preview</span>
        <select className="input !py-0.5 !text-xs !w-auto max-w-[160px]" value={previewPath} onChange={(e) => setPreviewPath(e.target.value)}>
          {files.filter((f) => f.path.endsWith(".html")).map((f) => (
            <option key={f.path} value={f.path === "index.html" ? "" : f.path}>{f.path}</option>
          ))}
        </select>
        <div className="ml-auto flex">
          {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
            <button key={d} className={clsx("btn btn-ghost btn-sm !px-2", device === d && "!bg-panel-2")} onClick={() => setDevice(d)} aria-label={d}>
              <Icon size={13} />
            </button>
          ))}
          <button className="btn btn-ghost btn-sm !px-2" onClick={() => setPreviewKey((k) => k + 1)} aria-label="Refresh preview"><RefreshCw size={13} /></button>
          <a className="btn btn-ghost btn-sm !px-2" href={previewSrc} target="_blank" rel="noreferrer" aria-label="Open in new tab"><ExternalLink size={13} /></a>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex justify-center overflow-auto p-0">
        <iframe
          key={previewKey}
          src={previewSrc}
          title="Live preview"
          className="bg-white h-full border-0 transition-all"
          style={{ width: width ?? "100%", boxShadow: width ? "0 0 0 1px var(--border)" : undefined }}
        />
      </div>
    </div>
  );

  const preview = isFlutter && wsId ? <SimulatorPreview workspaceId={wsId} /> : webPreview;

  return (
    <div className="h-full flex flex-col" data-tour="editor">
      <div className="flex items-center gap-2 h-12 px-3 md:px-4 border-b bg-panel shrink-0">
        <h1 className="font-semibold text-sm">{simple ? (isFlutter ? "Your app" : "Your website") : "Code & Preview"}</h1>
        <div className="ml-auto flex gap-1.5">
          {!simple && (
            <>
              <button className="btn btn-sm" onClick={askAgent} disabled={!active}><Sparkles size={12} /> Ask an agent</button>
              <button className="btn btn-sm" onClick={showHistory}><History size={12} /> History</button>
              <button className={clsx("btn btn-sm", terminal && "!bg-panel-2")} onClick={() => setTerminal((t) => !t)} data-tour="terminal">
                <TerminalSquare size={12} /> Terminal
              </button>
            </>
          )}
          <button className="btn btn-sm" onClick={toggleSimple}>
            {simple ? <><Code2 size={12} /> Show code</> : <><Eye size={12} /> Simple mode</>}
          </button>
        </div>
      </div>
      {error && (
        <div className="px-4">
          <ErrorNote message={error} />
        </div>
      )}

      {simple ? (
        <div className="flex-1 min-h-0">{preview}</div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,0.9fr)]">
          {/* File explorer */}
          <div className="hidden lg:flex flex-col border-r bg-panel min-h-0">
            <div className="flex items-center h-9 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Files
              <button className="btn btn-ghost btn-sm !h-6 !px-1.5 ml-auto" onClick={newFile} aria-label="New file"><FilePlus size={13} /></button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin pb-3 text-[13px]">
              <TreeView
                node={tree}
                depth={0}
                active={active}
                collapsed={collapsed}
                toggle={(p) => setCollapsed((c) => ({ ...c, [p]: !c[p] }))}
                onOpen={openFile}
                onRename={renameFile}
                onDelete={deleteFile}
              />
            </div>
          </div>

          {/* Editor */}
          <div className="flex flex-col min-h-0 min-w-0 border-r">
            <div className="flex h-9 bg-panel border-b overflow-x-auto scroll-thin shrink-0">
              {open.map((p) => {
                const b = buffers[p];
                const dirty = b && b.content !== b.saved;
                return (
                  <div
                    key={p}
                    className={clsx(
                      "group flex items-center gap-1.5 pl-3 pr-1.5 text-[12.5px] border-r cursor-pointer shrink-0",
                      active === p ? "bg-bg text-ink" : "text-muted hover:text-ink",
                    )}
                    onClick={() => setActive(p)}
                  >
                    {p.split("/").pop()}
                    {dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent" title="Unsaved" />}
                    <button className="opacity-50 group-hover:opacity-100 rounded p-0.5 hover:bg-panel-2" onClick={(e) => { e.stopPropagation(); closeTab(p); }} aria-label={`Close ${p}`}>
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              {activeBuf && activeBuf.content !== activeBuf.saved && (
                <button className="btn btn-primary btn-sm !h-6 my-auto ml-auto mr-2" onClick={() => save()}>Save ⌘S</button>
              )}
            </div>
            <div className="flex-1 min-h-[300px]">
              {active && activeBuf ? (
                <Monaco
                  path={active}
                  language={langOf(active)}
                  value={activeBuf.content}
                  theme={dark ? "vs-dark" : "light"}
                  onMount={onMount}
                  onChange={(v) => setBuffers((b) => ({ ...b, [active]: { ...b[active], content: v ?? "" } }))}
                  options={{ fontSize: 13, minimap: { enabled: true }, wordWrap: "on", scrollBeyondLastLine: false, automaticLayout: true, tabSize: 2 }}
                />
              ) : (
                <div className="h-full grid place-items-center text-sm text-muted">Pick a file to start editing.</div>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="min-h-[360px] lg:min-h-0">{preview}</div>
        </div>
      )}
      {!simple && terminal && (
        <TerminalPanel className="h-[300px] border-t shrink-0" />
      )}

      <Modal open={history !== null} onClose={() => setHistory(null)} title={`Version history${active ? ` · ${active}` : ""}`}>
        {history?.length === 0 && <p className="text-sm text-muted">No changes recorded yet.</p>}
        <ol className="space-y-1 max-h-[60vh] overflow-y-auto scroll-thin">
          {history?.map((cp) => {
            const who = cp.actor === "user" ? "You" : agentById(agents, cp.actor)?.name ?? "Agent";
            const what = cp.beforeBlob === null ? "created" : cp.afterBlob === null ? "deleted" : "edited";
            return (
              <li key={cp.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-panel-2 text-sm">
                <span className="flex-1 min-w-0">
                  <b className="font-medium">{who}</b> {what} <span className="font-mono text-xs">{cp.path}</span>
                  <span className="block text-xs text-muted">{timeAgo(cp.createdAt)}</span>
                </span>
                {cp.ticketId && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { setHistory(null); openTicket(cp.ticketId); }}>Ticket</button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setDiffCp(cp.id)}>Diff</button>
                <button className="btn btn-sm" onClick={() => restore(cp)}>Undo this</button>
              </li>
            );
          })}
        </ol>
      </Modal>

      {diffCp && (
        <DiffModal
          target={{ checkpointId: diffCp }}
          onClose={() => setDiffCp(null)}
          onUndone={() => {
            setHistory(null);
            reload();
          }}
        />
      )}

      {askOpen && active && (
        <AskAgentModal
          path={active}
          selection={selection}
          onClose={() => setAskOpen(false)}
          onCreated={(id) => {
            setAskOpen(false);
            reload();
            openTicket(id);
          }}
        />
      )}
    </div>
  );
}

function AskAgentModal({ path, selection, onClose, onCreated }: { path: string; selection: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { workspace, agents } = useWorkspace();
  const [request, setRequest] = useState("");
  const [agentId, setAgentId] = useState(agents.find((a) => /frontend/i.test(a.role))?.id ?? agents[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      const description = `${request}\n\nFile: ${path}${selection ? `\n\nSelected code:\n\`\`\`\n${selection}\n\`\`\`` : ""}`;
      const { ticket } = await api<{ ticket: { id: string } }>(`/api/workspaces/${workspace!.id}/tickets`, {
        method: "POST",
        json: { title: request.split("\n")[0].slice(0, 80) || `Change ${path}`, description, assigneeId: agentId },
      });
      await api(`/api/tickets/${ticket.id}/run`, { method: "POST" }).catch((e) => setError(e.message));
      onCreated(ticket.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} title="Ask an agent">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Creates a ticket about <span className="font-mono">{path}</span>
          {selection ? ` with the ${selection.split("\n").length} selected line(s)` : ""} and starts the agent.
        </p>
        {selection && <pre className="text-[11.5px] bg-panel-2 rounded-lg p-2 max-h-32 overflow-auto scroll-thin">{selection}</pre>}
        <textarea className="input" rows={3} placeholder="e.g. Make this section stack vertically on phones" value={request} onChange={(e) => setRequest(e.target.value)} autoFocus />
        <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar} {a.name} — {a.role}</option>
          ))}
        </select>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!request.trim()}>Create & run</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- file tree ----------

interface TreeNode {
  name: string;
  path: string;
  dirs: TreeNode[];
  files: FileEntry[];
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dirs: [], files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join("/");
      let next = node.dirs.find((d) => d.path === p);
      if (!next) {
        next = { name: parts[i], path: p, dirs: [], files: [] };
        node.dirs.push(next);
      }
      node = next;
    }
    node.files.push(f);
  }
  return root;
}

function TreeView({
  node,
  depth,
  active,
  collapsed,
  toggle,
  onOpen,
  onRename,
  onDelete,
}: {
  node: TreeNode;
  depth: number;
  active: string | null;
  collapsed: Record<string, boolean>;
  toggle: (p: string) => void;
  onOpen: (p: string) => void;
  onRename: (p: string) => void;
  onDelete: (p: string) => void;
}) {
  const pad = { paddingLeft: 10 + depth * 12 };
  return (
    <>
      {node.dirs.map((d) => (
        <div key={d.path}>
          <button className="w-full flex items-center gap-1 py-1 pr-2 text-left hover:bg-panel-2" style={pad} onClick={() => toggle(d.path)}>
            {collapsed[d.path] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            <Folder size={13} className="text-accent" />
            {d.name}
          </button>
          {!collapsed[d.path] && (
            <TreeView node={d} depth={depth + 1} active={active} collapsed={collapsed} toggle={toggle} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
          )}
        </div>
      ))}
      {node.files.map((f) => (
        <div
          key={f.path}
          className={clsx("group flex items-center gap-1.5 py-1 pr-1 cursor-pointer", active === f.path ? "bg-accent-soft text-accent-ink" : "hover:bg-panel-2")}
          style={{ paddingLeft: 10 + depth * 12 + 14 }}
          onClick={() => onOpen(f.path)}
        >
          <File size={13} className="text-muted shrink-0" />
          <span className="truncate flex-1">{f.path.split("/").pop()}</span>
          <span className="hidden group-hover:flex">
            <button className="p-1 rounded hover:bg-panel" onClick={(e) => { e.stopPropagation(); onRename(f.path); }} aria-label={`Rename ${f.path}`}><Pencil size={11} /></button>
            <button className="p-1 rounded hover:bg-panel text-danger" onClick={(e) => { e.stopPropagation(); onDelete(f.path); }} aria-label={`Delete ${f.path}`}><Trash2 size={11} /></button>
          </span>
        </div>
      ))}
    </>
  );
}
