"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { BookmarkPlus, Copy, Library, Pause, Pencil, Play, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { AgentAvatar, ErrorNote, Modal, PageHeader } from "@/components/ui";
import { api } from "@/lib/client";
import { PERMISSIONS, type Agent, type LibraryAgent, type Permission } from "@/lib/types";
import type { AgentPreset } from "@/lib/presets";

type Draft = Pick<Agent, "name" | "role" | "avatar" | "color" | "description" | "tone" | "systemPrompt" | "model" | "permissions">;

const BLANK: Draft = {
  name: "",
  role: "",
  avatar: "🤖",
  color: "#6366f1",
  description: "",
  tone: "Friendly and clear",
  systemPrompt: "",
  model: "",
  permissions: ["read_files"],
};

export default function AgentsPage() {
  const { workspace, agents, tickets, reload } = useWorkspace();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [creating, setCreating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    api<{ models: typeof models }>("/api/models").then((d) => setModels(d.models)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  const togglePause = async (a: Agent) => {
    await api(`/api/agents/${a.id}`, { method: "PATCH", json: { paused: !a.paused } });
    reload();
  };
  const duplicate = async (a: Agent) => {
    await api(`/api/workspaces/${workspace.id}/agents`, { method: "POST", json: { ...pick(a), name: `${a.name} (copy)` } });
    reload();
  };
  const saveToLibrary = async (a: Agent) => {
    await api("/api/library", { method: "POST", json: { fromAgentId: a.id } });
    setFlash(`${a.name} saved to your library. Add them to any workspace from “Agent library”.`);
  };
  const remove = async (a: Agent) => {
    if (!confirm(`Remove ${a.name} from this workspace? Their tickets become unassigned.${a.isPredefined ? " You can add them back from the agent library." : ""}`)) return;
    try {
      await api(`/api/agents/${a.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <PageHeader
        title="Agents"
        subtitle="Your AI team for this workspace. Edit how each one works, which model it uses and what it's allowed to do."
        actions={
          <div className="flex gap-2" data-tour="agents">
            <button className="btn" onClick={() => setLibraryOpen(true)}>
              <Library size={14} /> Agent library
            </button>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> New agent
            </button>
          </div>
        }
      />
      {flash && <div className="mb-4 rounded-xl border border-success/30 bg-success/10 px-3 py-2 text-sm">{flash}</div>}
      <div className="grid md:grid-cols-2 gap-4">
        {agents.map((a) => {
          const working = tickets.find((t) => t.running && t.assigneeId === a.id);
          const queued = tickets.filter((t) => t.queued && !t.running && t.assigneeId === a.id).length;
          const done = tickets.filter((t) => t.assigneeId === a.id && t.status === "done").length;
          return (
            <div key={a.id} className={clsx("card p-5", a.paused && "opacity-70")}>
              <div className="flex items-start gap-3">
                <AgentAvatar agent={a} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{a.name}</h3>
                    {a.paused && <span className="chip">Paused</span>}
                    {!a.isPredefined && <span className="chip">Custom</span>}
                  </div>
                  <div className="text-sm text-muted">{a.role}</div>
                </div>
              </div>
              <p className="text-sm text-ink/80 mt-3 min-h-[2.8em]">{a.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {a.permissions.map((p) => (
                  <span key={p} className="chip">{PERMISSIONS.find((x) => x.id === p)?.label ?? p}</span>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted mt-3">
                <span>Model: <span className="font-mono">{a.model || "default"}</span></span>
                <span>·</span>
                <span>{done} done</span>
                {queued > 0 && <><span>·</span><span>{queued} queued</span></>}
                {working && (
                  <span className="flex items-center gap-1 text-success"><span className="live-dot" /> working on LUM-{working.number}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-4 pt-4 border-t">
                <button className="btn btn-sm" onClick={() => setEditing(a)}><Pencil size={12} /> Edit</button>
                <button className="btn btn-sm" onClick={() => togglePause(a)}>
                  {a.paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
                </button>
                <button className="btn btn-sm" onClick={() => duplicate(a)}><Copy size={12} /> Duplicate</button>
                <button className="btn btn-sm" onClick={() => saveToLibrary(a)} title="Save to your agent library to reuse in other workspaces">
                  <BookmarkPlus size={12} /> Save
                </button>
                <button className="btn btn-sm btn-danger ml-auto" onClick={() => remove(a)} aria-label="Remove agent"><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && (
        <AgentBuilder
          mode="edit"
          initial={editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={async (f) => {
            await api(`/api/agents/${editing.id}`, { method: "PATCH", json: f });
            reload();
          }}
        />
      )}
      {creating && (
        <AgentBuilder
          mode="create"
          initial={BLANK}
          models={models}
          onClose={() => setCreating(false)}
          onSave={async (f, saveToLib) => {
            await api(`/api/workspaces/${workspace.id}/agents`, { method: "POST", json: { ...f, saveToLibrary: saveToLib } });
            reload();
          }}
        />
      )}
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
    </div>
  );
}

function pick(a: Draft): Draft {
  const { name, role, avatar, color, description, tone, systemPrompt, model, permissions } = a;
  return { name, role, avatar, color, description, tone, systemPrompt, model, permissions };
}

// ---------------------------------------------------------------------------
// Agent builder (create + edit)
// ---------------------------------------------------------------------------

function AgentBuilder({
  mode,
  initial,
  models,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  initial: Draft;
  models: { id: string; name: string }[];
  onClose: () => void;
  onSave: (f: Draft, saveToLibrary: boolean) => Promise<void>;
}) {
  const [f, setF] = useState<Draft>(pick(initial));
  const [tab, setTab] = useState<"basics" | "instructions">("basics");
  const [error, setError] = useState<string | null>(null);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [saveToLib, setSaveToLib] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presets, setPresets] = useState<AgentPreset[]>([]);

  useEffect(() => {
    if (mode === "create") api<{ presets: AgentPreset[] }>("/api/library").then((d) => setPresets(d.presets)).catch(() => {});
  }, [mode]);

  const togglePerm = (p: Permission) =>
    setF((x) => ({ ...x, permissions: x.permissions.includes(p) ? x.permissions.filter((q) => q !== p) : [...x.permissions, p] }));

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const { draft } = await api<{ draft: Draft }>("/api/agents/draft", { method: "POST", json: { description: idea } });
      setF((x) => ({ ...draft, model: x.model }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    if (!f.name.trim() || !f.role.trim()) {
      setError("Give your agent a name and a role.");
      setTab("basics");
      return;
    }
    if (!f.systemPrompt.trim()) {
      setError("Write the role instructions (or draft them with Claude).");
      setTab("instructions");
      return;
    }
    setSaving(true);
    try {
      await onSave(f, saveToLib);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={mode === "create" ? "New agent" : `Edit ${initial.name}`} wide>
      {mode === "create" && (
        <div className="rounded-xl border p-3 mb-4" style={{ background: "linear-gradient(180deg, var(--accent-soft), var(--panel) 85%)" }}>
          <label className="label flex items-center gap-1.5"><Wand2 size={13} className="text-accent" /> Describe the agent you need</label>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="e.g. Someone who writes SEO-friendly blog posts about our product"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && idea.trim().length > 2 && !drafting && draft()}
            />
            <button className="btn btn-primary shrink-0" onClick={draft} disabled={drafting || idea.trim().length < 3}>
              <Sparkles size={13} /> {drafting ? "Drafting…" : "Draft with Claude"}
            </button>
          </div>
          {presets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <span className="text-xs text-muted">or start from a role:</span>
              {presets.map((p) => (
                <button
                  key={p.key}
                  className="chip cursor-pointer hover:text-ink"
                  onClick={() => setF((x) => ({ ...pick({ ...p, model: "" }), name: `${p.name} 2`, model: x.model }))}
                >
                  {p.avatar} {p.role}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b">
        {(["basics", "instructions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx("px-3 py-2 text-sm -mb-px border-b-2", tab === t ? "border-accent font-medium" : "border-transparent text-muted")}
          >
            {t === "basics" ? "Basics" : "Role instructions"}
          </button>
        ))}
      </div>

      {tab === "basics" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-[64px_56px_1fr_1fr] gap-3 items-end">
            <div>
              <label className="label">Avatar</label>
              <input className="input text-center" value={f.avatar} onChange={(e) => setF({ ...f, avatar: e.target.value })} />
            </div>
            <div>
              <label className="label">Colour</label>
              <input type="color" className="h-[38px] w-full rounded-lg border cursor-pointer bg-transparent" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
            </div>
            <div>
              <label className="label">Name</label>
              <input className="input" value={f.name} placeholder="e.g. Noor" onChange={(e) => setF({ ...f, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Role</label>
              <input className="input" value={f.role} placeholder="e.g. SEO Writer" onChange={(e) => setF({ ...f, role: e.target.value })} />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-panel-2 px-3 py-2">
            <AgentAvatar agent={{ avatar: f.avatar, color: f.color, name: f.name }} size={36} />
            <div className="text-sm min-w-0">
              <div className="font-medium truncate">{f.name || "Unnamed agent"} <span className="text-muted font-normal">· {f.role || "No role yet"}</span></div>
              <div className="text-xs text-muted truncate">{f.description || "What they're responsible for…"}</div>
            </div>
          </div>
          <div>
            <label className="label">What they're responsible for</label>
            <textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Personality & tone</label>
              <input className="input" value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} />
            </div>
            <div>
              <label className="label">Model</label>
              <select className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
                <option value="">Use workspace default</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <span className="label">Permissions</span>
            <div className="grid sm:grid-cols-2 gap-2">
              {PERMISSIONS.map((p) => (
                <label key={p.id} className="flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer hover:bg-panel-2">
                  <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={f.permissions.includes(p.id)} onChange={() => togglePerm(p.id)} />
                  <span>
                    <span className="block text-sm font-medium">{p.label}</span>
                    <span className="block text-xs text-muted">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Role instructions (system prompt)</label>
          <p className="text-xs text-muted mb-2">
            Luma automatically adds the tone above and the shared team rules (tools, handoffs, plain language, finishing tickets).
          </p>
          <textarea
            className="input font-mono text-[12.5px]"
            rows={16}
            placeholder={"You are the … of this workspace.\n- …"}
            value={f.systemPrompt}
            onChange={(e) => setF({ ...f, systemPrompt: e.target.value })}
          />
        </div>
      )}
      <ErrorNote message={error} />
      <div className="flex items-center justify-end gap-2 mt-5">
        {mode === "create" && (
          <label className="flex items-center gap-2 text-sm text-muted mr-auto cursor-pointer">
            <input type="checkbox" className="accent-[var(--accent)]" checked={saveToLib} onChange={(e) => setSaveToLib(e.target.checked)} />
            Also save to my agent library
          </label>
        )}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {mode === "create" ? "Add to team" : "Save changes"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Agent library: 9 predefined agents + agents you saved
// ---------------------------------------------------------------------------

function LibraryModal({ onClose }: { onClose: () => void }) {
  const { workspace, agents, reload } = useWorkspace();
  const [tab, setTab] = useState<"presets" | "custom">("presets");
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [custom, setCustom] = useState<LibraryAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await api<{ presets: AgentPreset[]; custom: LibraryAgent[] }>("/api/library");
    setPresets(d.presets);
    setCustom(d.custom);
  }, []);

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  if (!workspace) return null;

  const add = async (key: string, json: Record<string, string>) => {
    setBusy(key);
    setError(null);
    try {
      await api(`/api/workspaces/${workspace.id}/agents`, { method: "POST", json });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeFromLibrary = async (l: LibraryAgent) => {
    if (!confirm(`Delete ${l.name} from your library? Agents already added to workspaces stay.`)) return;
    await api(`/api/library/${l.id}`, { method: "DELETE" });
    load();
  };

  const card = (
    key: string,
    a: Pick<Agent, "avatar" | "color" | "name" | "role" | "description" | "permissions">,
    action: React.ReactNode,
  ) => (
    <div key={key} className="rounded-xl border p-3.5 flex flex-col">
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={a} size={36} />
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{a.name}</div>
          <div className="text-xs text-muted truncate">{a.role}</div>
        </div>
      </div>
      <p className="text-xs text-ink/80 mt-2 flex-1">{a.description}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {a.permissions.map((p) => (
          <span key={p} className="chip !text-[10px]">{PERMISSIONS.find((x) => x.id === p)?.label ?? p}</span>
        ))}
      </div>
      <div className="flex items-center gap-1.5 mt-3">{action}</div>
    </div>
  );

  return (
    <Modal open onClose={onClose} title="Agent library" wide>
      <div className="flex gap-1 mb-4 border-b">
        {(
          [
            ["presets", `Predefined (${presets.length})`],
            ["custom", `My library (${custom.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx("px-3 py-2 text-sm -mb-px border-b-2", tab === id ? "border-accent font-medium" : "border-transparent text-muted")}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto scroll-thin pr-1">
        {tab === "presets"
          ? presets.map((p) => {
              const onTeam = agents.some((a) => a.presetKey === p.key);
              return card(
                p.key,
                p,
                onTeam ? (
                  <span className="chip">On this team</span>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy === p.key} onClick={() => add(p.key, { presetKey: p.key })}>
                    <Plus size={12} /> Add to team
                  </button>
                ),
              );
            })
          : custom.length === 0
            ? (
              <p className="text-sm text-muted col-span-full py-6 text-center">
                Nothing saved yet. Use “Save” on any agent, or tick “Also save to my agent library” when you create one.
              </p>
            )
            : custom.map((l) =>
                card(
                  l.id,
                  l,
                  <>
                    <button className="btn btn-sm btn-primary" disabled={busy === l.id} onClick={() => add(l.id, { libraryId: l.id })}>
                      <Plus size={12} /> Add to team
                    </button>
                    <button className="btn btn-sm btn-ghost btn-danger ml-auto" onClick={() => removeFromLibrary(l)} aria-label="Delete from library">
                      <Trash2 size={12} />
                    </button>
                  </>,
                ),
              )}
      </div>
    </Modal>
  );
}
