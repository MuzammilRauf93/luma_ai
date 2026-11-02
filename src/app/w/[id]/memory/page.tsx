"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Brain, Check, Copy, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { AgentAvatar, EmptyState, ErrorNote, Modal, PageHeader } from "@/components/ui";
import { agentById, api, timeAgo } from "@/lib/client";
import { MEMORY_KINDS, type Memory, type MemoryKind } from "@/lib/types";

type Draft = { id?: string; kind: MemoryKind; title: string; content: string; tags: string; pinned: boolean };
const EMPTY: Draft = { kind: "preference", title: "", content: "", tags: "", pinned: false };

export default function MemoryPage() {
  const { workspace, agents, memoryVersion, openTicket, reload } = useWorkspace();
  const [dups, setDups] = useState<{ a: Memory; b: Memory; similarity: number }[] | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "">("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    const q = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    const d = await api<{ memories: Memory[] }>(`/api/workspaces/${workspace.id}/memory${q}`);
    setMemories(d.memories);
  }, [workspace, query]);

  useEffect(() => {
    const t = setTimeout(() => load().catch((e) => setError((e as Error).message)), query ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, memoryVersion, query]);

  const shown = useMemo(() => memories.filter((m) => (!kind || m.kind === kind) && m.status !== "proposed"), [memories, kind]);
  const pending = useMemo(() => memories.filter((m) => m.status === "proposed" || m.proposal), [memories]);

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  const save = async (d: Draft) => {
    const json = { kind: d.kind, title: d.title, content: d.content, pinned: d.pinned, tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean) };
    if (d.id) await api(`/api/memory/${d.id}`, { method: "PATCH", json });
    else await api(`/api/workspaces/${workspace.id}/memory`, { method: "POST", json });
    await load();
  };
  const togglePin = async (m: Memory) => {
    await api(`/api/memory/${m.id}`, { method: "PATCH", json: { pinned: !m.pinned } });
    load();
  };
  const review = async (m: Memory, approve: boolean) => {
    await api(`/api/memory/${m.id}`, { method: "PATCH", json: { action: approve ? "approve" : "reject" } });
    load();
    window.dispatchEvent(new Event("luma:workspaces"));
  };
  const checkDups = async () => {
    const d = await api<{ pairs: { a: Memory; b: Memory; similarity: number }[] }>(`/api/workspaces/${workspace.id}/memory?duplicates=1`);
    setDups(d.pairs);
  };
  const merge = async (keep: Memory, drop: Memory) => {
    await api("/api/memory/merge", { method: "POST", json: { keepId: keep.id, dropId: drop.id } });
    await load();
    checkDups();
  };
  const setReview = async (mode: string) => {
    await api(`/api/workspaces/${workspace.id}`, { method: "PATCH", json: { memoryReview: mode } });
    reload();
  };
  const remove = async (m: Memory) => {
    if (!confirm(`Forget “${m.title}”? Agents won't see it any more.`)) return;
    await api(`/api/memory/${m.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <PageHeader
        title="Team memory"
        subtitle="What your agents know about this project: decisions, conventions, your preferences and key facts. Every agent reads it before starting a ticket. Pinned items are always included."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing(EMPTY)}>
            <Plus size={14} /> Add memory
          </button>
        }
      />
      <ErrorNote message={error} />
      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <span className="text-muted">Review:</span>
        <select className="input !w-auto !py-1 !text-sm" value={workspace.memoryReview ?? "conventions"} onChange={(e) => setReview(e.target.value)}>
          <option value="conventions">Agents' decisions & conventions need my OK</option>
          <option value="all">Everything agents save needs my OK</option>
          <option value="off">No review: agents save directly</option>
        </select>
        <button className="btn btn-sm btn-ghost ml-auto" onClick={checkDups}><Copy size={12} /> Find duplicates</button>
      </div>

      {pending.length > 0 && (
        <section className="card p-4 mb-5 border-warning/40">
          <h2 className="font-semibold text-sm mb-1">Waiting for your review · {pending.length}</h2>
          <p className="text-xs text-muted mb-3">Agents already follow these, marked as proposals. Approve to make them team rules, or reject to remove them.</p>
          <div className="space-y-2">
            {pending.map((m) => {
              const k = MEMORY_KINDS.find((x) => x.id === m.kind)!;
              const by = agentById(agents, m.proposal?.authorId ?? m.authorId);
              return (
                <div key={m.id} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span>{k.emoji}</span>
                    <b>{m.title}</b>
                    <span className="text-xs text-muted">{m.proposal ? "change proposed" : `new ${k.label.toLowerCase()}`} by {by?.name ?? "an agent"}</span>
                    <div className="ml-auto flex gap-1">
                      <button className="btn btn-sm btn-primary" onClick={() => review(m, true)}><Check size={12} /> Approve</button>
                      {!m.proposal && (
                        <button className="btn btn-sm" onClick={() => setEditing({ id: m.id, kind: m.kind, title: m.title, content: m.content, tags: m.tags.join(", "), pinned: m.pinned })}><Pencil size={12} /></button>
                      )}
                      <button className="btn btn-sm" onClick={() => review(m, false)}><X size={12} /> Reject</button>
                    </div>
                  </div>
                  {m.proposal ? (
                    <div className="grid sm:grid-cols-2 gap-2 mt-2 text-sm">
                      <div className="rounded bg-danger/5 p-2"><div className="text-[11px] text-muted mb-0.5">Now</div><p className="whitespace-pre-wrap">{m.content}</p></div>
                      <div className="rounded bg-success/10 p-2"><div className="text-[11px] text-muted mb-0.5">Proposed</div><p className="whitespace-pre-wrap">{m.proposal.content}</p></div>
                    </div>
                  ) : (
                    <p className="text-sm text-ink/85 whitespace-pre-wrap mt-1.5">{m.content}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {dups && (
        <section className="card p-4 mb-5">
          <div className="flex items-center mb-2">
            <h2 className="font-semibold text-sm">Possible duplicates · {dups.length}</h2>
            <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setDups(null)}><X size={12} /></button>
          </div>
          {dups.length === 0 ? (
            <p className="text-sm text-muted">No near-duplicates found.</p>
          ) : (
            <div className="space-y-2">
              {dups.map((p) => (
                <div key={p.a.id + p.b.id} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-center rounded-lg border p-2.5 text-sm">
                  {[p.a, p.b].map((m, i) => (
                    <div key={m.id} className="min-w-0">
                      <div className="font-medium truncate">{m.title}</div>
                      <div className="text-xs text-muted line-clamp-2">{m.content}</div>
                      <button className="btn btn-sm mt-1" onClick={() => merge(m, i === 0 ? p.b : p.a)}>Keep this, merge other in</button>
                    </div>
                  ))}
                  <span className="text-xs text-muted tabular-nums">{Math.round(p.similarity * 100)}% similar</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4" data-tour="memory">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input !pl-8" placeholder="Search memory…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={clsx("chip cursor-pointer", !kind && "!bg-accent-soft !text-accent-ink")} onClick={() => setKind("")}>All {memories.length}</button>
          {MEMORY_KINDS.map((k) => {
            const n = memories.filter((m) => m.kind === k.id).length;
            return (
              <button key={k.id} className={clsx("chip cursor-pointer", kind === k.id && "!bg-accent-soft !text-accent-ink")} onClick={() => setKind(k.id)} title={k.hint}>
                {k.emoji} {k.label} {n > 0 && <span className="text-muted">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Brain size={22} />}
            title={query || kind ? "Nothing matches" : "Nothing remembered yet"}
            body={
              query || kind
                ? "Try a different search or filter."
                : "As agents work they'll save decisions here (like the colour palette or file structure). You can add your own preferences too, e.g. “Always use British English”."
            }
            action={!query && !kind ? <button className="btn btn-primary" onClick={() => setEditing(EMPTY)}><Plus size={14} /> Add a preference</button> : undefined}
          />
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {shown.map((m) => {
            const k = MEMORY_KINDS.find((x) => x.id === m.kind)!;
            const author = m.authorId === "user" ? null : agentById(agents, m.authorId);
            return (
              <div key={m.id} className={clsx("card p-4 flex flex-col", m.pinned && "ring-1 ring-accent/40")}>
                <div className="flex items-start gap-2">
                  <span className="text-lg leading-none mt-0.5" title={k.label}>{k.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm truncate">{m.title}</h3>
                      {m.pinned && <span className="chip !text-[10px] !bg-accent-soft !text-accent-ink"><Pin size={9} /> Pinned</span>}
                    </div>
                    <div className="text-[11px] text-muted">{k.label}</div>
                  </div>
                  <div className="flex gap-0.5">
                    <button className="btn btn-ghost btn-sm !px-1.5" onClick={() => togglePin(m)} title={m.pinned ? "Unpin" : "Pin: always include in briefings"}>
                      {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                    <button className="btn btn-ghost btn-sm !px-1.5" title="Edit" onClick={() => setEditing({ id: m.id, kind: m.kind, title: m.title, content: m.content, tags: m.tags.join(", "), pinned: m.pinned })}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn btn-ghost btn-sm btn-danger !px-1.5" title="Forget" onClick={() => remove(m)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-ink/85 whitespace-pre-wrap mt-2 flex-1">{m.content}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[11px] text-muted">
                  {m.tags.map((t) => <span key={t} className="chip !text-[10px]">#{t}</span>)}
                  <span className="ml-auto flex items-center gap-1.5">
                    {author ? <AgentAvatar agent={author} size={18} /> : <span className="w-[18px] h-[18px] rounded-full bg-accent text-white grid place-items-center text-[9px] font-bold">Y</span>}
                    {author?.name ?? "You"} · {timeAgo(m.updatedAt)}
                    {m.ticketId && (
                      <button className="hover:underline" onClick={() => openTicket(m.ticketId)}>· ticket</button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <MemoryEditor draft={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function MemoryEditor({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState(draft);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    try {
      await onSave(d);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open onClose={onClose} title={d.id ? "Edit memory" : "Add to team memory"}>
      <div className="space-y-3">
        <div>
          <span className="label">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {MEMORY_KINDS.map((k) => (
              <button key={k.id} type="button" title={k.hint} onClick={() => setD({ ...d, kind: k.id })}
                className={clsx("chip cursor-pointer", d.kind === k.id && "!bg-accent-soft !text-accent-ink")}>
                {k.emoji} {k.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted mt-1">{MEMORY_KINDS.find((k) => k.id === d.kind)?.hint}</p>
        </div>
        <div>
          <label className="label">Title</label>
          <input className="input" placeholder="e.g. Spelling" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} autoFocus />
        </div>
        <div>
          <label className="label">Details</label>
          <textarea className="input" rows={4} placeholder="e.g. Always use British English (colour, organise)." value={d.content} onChange={(e) => setD({ ...d, content: e.target.value })} />
        </div>
        <div>
          <label className="label">Tags (comma separated, optional)</label>
          <input className="input" value={d.tags} onChange={(e) => setD({ ...d, tags: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" className="accent-[var(--accent)]" checked={d.pinned} onChange={(e) => setD({ ...d, pinned: e.target.checked })} />
          Pin: include in every agent's briefing
        </label>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!d.title.trim() || !d.content.trim()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
