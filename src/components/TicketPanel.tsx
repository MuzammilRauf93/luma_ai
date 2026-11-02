"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle,
  Check,
  CircleHelp,
  FileCode2,
  MessageSquare,
  Play,
  Square,
  Trash2,
  Wrench,
  X,
  Sparkles,
  Clock,
  GitBranch,
  Hand,
  ListPlus,
  Brain,
  RotateCcw,
  TerminalSquare,
  GitCommitHorizontal,
} from "lucide-react";
import { agentById, api, fmtTokens, fmtUsd, timeAgo, STATUS_STYLE } from "@/lib/client";
import { LABELS, PRIORITIES, TICKET_STATUSES, type Label, type Ticket, type TicketEvent } from "@/lib/types";
import { AgentAvatar, ErrorNote } from "./ui";
import { DiffModal } from "./DiffViewer";
import { useWorkspace } from "./WorkspaceProvider";

interface Bundle {
  ticket: Ticket;
  events: TicketEvent[];
  children: Ticket[];
  parent: Ticket | null;
  usage: { tokens: number; cost: number };
  running: boolean;
  blockers: DepView[];
  dependsOn: DepView[];
}

interface FileChange {
  path: string;
  adds: number;
  dels: number;
  created: boolean;
  deleted: boolean;
  changes: number;
  changedLater: boolean;
}

interface DepView {
  id: string;
  number: number;
  title: string;
  status: Ticket["status"];
}

export function TicketPanel() {
  const { openTicketId, openTicket, agents, eventVersion, workspace, activity, reload, fileVersion, canEdit, me } = useWorkspace();
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [b, setB] = useState<Bundle | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "" });
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!openTicketId) return;
    try {
      setB(await api<Bundle>(`/api/tickets/${openTicketId}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [openTicketId]);

  useEffect(() => {
    setB(null);
    setError(null);
    setNotice(null);
    setEditing(false);
    load();
  }, [openTicketId, load]);

  useEffect(() => {
    load();
  }, [eventVersion, load]);

  const loadChanges = useCallback(async () => {
    if (!openTicketId || !workspace) return;
    try {
      const d = await api<{ files: FileChange[] }>(`/api/workspaces/${workspace.id}/diff?ticketId=${openTicketId}`);
      setChanges(d.files);
    } catch {
      setChanges([]);
    }
  }, [openTicketId, workspace]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges, fileVersion]);

  const undoAll = async () => {
    if (!workspace || !confirm(`Undo every file change this ticket made (${changes.length} file${changes.length > 1 ? "s" : ""})? Files go back to how they were before the ticket. You can redo from version history.`)) return;
    try {
      await api(`/api/workspaces/${workspace.id}/checkpoints`, { method: "POST", json: { ticketId: openTicketId } });
      await api(`/api/tickets/${openTicketId}/comments`, { method: "POST", json: { text: "↩️ Undid all file changes from this ticket." } });
      loadChanges();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Follow along at the bottom of the activity log while an agent is working.
  useEffect(() => {
    if (b?.running) bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [b?.events.length, b?.running]);

  if (!openTicketId) return null;

  const t = b?.ticket;
  const assignee = agentById(agents, t?.assigneeId);
  const liveLines = activity.filter((a) => a.ticketId === openTicketId && a.kind === "tool").slice(-1);

  const patch = async (p: Partial<Ticket>) => {
    setError(null);
    try {
      await api(`/api/tickets/${openTicketId}`, { method: "PATCH", json: p });
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ started: boolean; queued?: boolean; reason?: string }>(`/api/tickets/${openTicketId}/run`, { method: "POST" });
      if (res.queued) setNotice(res.reason ?? "Queued.");
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resolveHandoff = async (action: "approve" | "decline") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tickets/${openTicketId}/handoff`, { method: "POST", json: { action } });
      await Promise.all([load(), reload()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    await api(`/api/tickets/${openTicketId}/run`, { method: "DELETE" });
    setTimeout(load, 600);
  };

  const send = async (thenRun = false) => {
    if (!comment.trim()) return;
    setError(null);
    try {
      await api(`/api/tickets/${openTicketId}/comments`, { method: "POST", json: { text: comment } });
      setComment("");
      if (thenRun) await run();
      else load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Save the comment box text as a user preference in team memory. */
  const rememberComment = async () => {
    const text = comment.trim();
    if (!text || !workspace) return;
    const words = text.replace(/\s+/g, " ").split(" ");
    const title = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
    try {
      await api(`/api/workspaces/${workspace.id}/memory`, { method: "POST", json: { kind: "preference", title, content: text, ticketId: openTicketId } });
      await api(`/api/tickets/${openTicketId}/comments`, { method: "POST", json: { text: `🧠 Saved to team memory: ${text}` } });
      setComment("");
      setNotice("Saved to team memory. Every agent will follow it from now on.");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this ticket and its history?")) return;
    try {
      await api(`/api/tickets/${openTicketId}`, { method: "DELETE" });
      openTicket(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const toggleLabel = (l: Label) => t && patch({ labels: t.labels.includes(l) ? t.labels.filter((x) => x !== l) : [...t.labels, l] });

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full sm:w-[460px] bg-panel border-l shadow-2xl flex flex-col">
      <header className="flex items-center gap-2 h-14 px-4 border-b shrink-0">
        <span className="text-xs font-mono text-muted">LUM-{t?.number ?? "…"}</span>
        {b?.running && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <span className="live-dot" /> {assignee?.name ?? "Agent"} is working
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <button className="btn btn-ghost btn-sm btn-danger" onClick={remove} aria-label="Delete ticket">
            <Trash2 size={14} />
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => openTicket(null)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      </header>

      {!t ? (
        <div className="p-6 text-sm text-muted">{error ?? "Loading…"}</div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto scroll-thin">
            <div className="p-5 space-y-4">
              {editing ? (
                <div className="space-y-2">
                  <input className="input font-semibold" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  <textarea className="input text-sm" rows={6} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                  <div className="flex gap-2 justify-end">
                    <button className="btn btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                    <button className="btn btn-sm btn-primary" onClick={() => patch(draft).then(() => setEditing(false))}>Save</button>
                  </div>
                </div>
              ) : (
                <div
                  className="cursor-text rounded-lg -m-2 p-2 hover:bg-panel-2"
                  onClick={() => {
                    setDraft({ title: t.title, description: t.description });
                    setEditing(true);
                  }}
                  title="Click to edit"
                >
                  <h2 className="text-lg font-semibold leading-snug">{t.title}</h2>
                  <p className="text-sm text-ink/80 whitespace-pre-wrap mt-1.5">{t.description || <span className="text-muted">Add a description…</span>}</p>
                </div>
              )}

              <div className="grid grid-cols-[90px_1fr] gap-y-2.5 items-center text-sm">
                <span className="text-muted text-xs">Status</span>
                <select className="input !py-1 !text-sm" value={t.status} onChange={(e) => patch({ status: e.target.value as Ticket["status"] })} disabled={b.running}>
                  {TICKET_STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <span className="text-muted text-xs">Agent</span>
                <div className="flex items-center gap-2">
                  <AgentAvatar agent={assignee} size={26} />
                  <select className="input !py-1 !text-sm" value={t.assigneeId ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })} disabled={b.running}>
                    <option value="">Unassigned</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — {a.role}{a.paused ? " (paused)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="text-muted text-xs">Priority</span>
                <select className="input !py-1 !text-sm" value={t.priority} onChange={(e) => patch({ priority: e.target.value as Ticket["priority"] })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
                <span className="text-muted text-xs">Labels</span>
                <div className="flex flex-wrap gap-1.5">
                  {LABELS.map((l) => (
                    <button
                      key={l}
                      onClick={() => toggleLabel(l)}
                      className={clsx("chip cursor-pointer", t.labels.includes(l) && "!bg-accent-soft !text-accent-ink")}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {b.parent && (
                  <>
                    <span className="text-muted text-xs">Part of</span>
                    <button className="text-left text-sm text-accent-ink truncate" onClick={() => openTicket(b.parent!.id)}>
                      LUM-{b.parent.number} {b.parent.title}
                    </button>
                  </>
                )}
                {b.dependsOn.length > 0 && (
                  <>
                    <span className="text-muted text-xs self-start pt-1">Depends on</span>
                    <div className="space-y-1">
                      {b.dependsOn.map((d) => (
                        <div key={d.id} className="flex items-center gap-2 text-sm group">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_STYLE[d.status].dot }} title={STATUS_STYLE[d.status].label} />
                          <button className="truncate text-left hover:underline flex-1" onClick={() => openTicket(d.id)}>
                            <span className="font-mono text-xs text-muted">LUM-{d.number}</span> {d.title}
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger"
                            title="Remove this dependency"
                            onClick={() => patch({ dependsOn: (t.dependsOn ?? []).filter((x) => x !== d.id) })}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <span className="text-muted text-xs">Usage</span>
                <span className="text-xs text-muted tabular-nums">{fmtTokens(b.usage.tokens)} tokens · {fmtUsd(b.usage.cost)}</span>
              </div>

              {t.pendingHandoff && (
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Hand size={14} className="text-warning" />
                    {agentById(agents, t.pendingHandoff.fromAgentId)?.name ?? "An agent"} wants to hand this to{" "}
                    <span className="inline-flex items-center gap-1">
                      <AgentAvatar agent={agentById(agents, t.pendingHandoff.toAgentId)} size={18} />
                      {agentById(agents, t.pendingHandoff.toAgentId)?.name ?? "a teammate"}
                    </span>
                  </div>
                  <p className="text-sm text-ink/80 whitespace-pre-wrap">{t.pendingHandoff.note}</p>
                  <div className="flex gap-2">
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => resolveHandoff("approve")}>
                      <Check size={12} /> Approve & start
                    </button>
                    <button className="btn btn-sm" disabled={busy} onClick={() => resolveHandoff("decline")}>
                      Decline
                    </button>
                  </div>
                </div>
              )}

              {t.queued && !b.running && (
                <div className="flex items-start gap-2 rounded-xl border bg-panel-2 p-3 text-sm">
                  <Clock size={14} className="text-muted mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">Queued for autopilot</div>
                    <div className="text-xs text-muted mt-0.5">
                      {workspace?.autopilotPaused
                        ? "Autopilot is paused, so this won't start until you resume it."
                        : b.blockers.length
                          ? `Starts after ${b.blockers.map((d) => `LUM-${d.number}`).join(", ")} ${b.blockers.length > 1 ? "are" : "is"} finished.`
                          : "Starts as soon as an agent is free."}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-ghost" onClick={() => patch({ queued: false })}>Remove</button>
                </div>
              )}

              {/* Primary actions */}
              <div className="flex flex-wrap gap-2">
                {b.running ? (
                  <button className="btn" onClick={stop}>
                    <Square size={13} /> Stop agent
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={run} disabled={busy || !t.assigneeId || Boolean(t.pendingHandoff)} title={b.blockers.length ? "Runs now, without waiting for its dependencies" : undefined}>
                    <Play size={13} /> {t.status === "todo" || t.status === "backlog" ? `Run ${assignee?.name ?? "agent"}${b.blockers.length ? " now" : ""}` : `Run ${assignee?.name ?? "agent"} again`}
                  </button>
                )}
                {!b.running && !t.queued && t.assigneeId && !t.pendingHandoff && workspace?.approvalMode !== "manual" && !["done", "in_progress"].includes(t.status) && (
                  <button className="btn" onClick={() => patch({ queued: true, status: t.status === "backlog" ? "todo" : t.status })} title="Let autopilot start it when an agent is free and its dependencies are done">
                    <ListPlus size={14} /> Queue
                  </button>
                )}
                {t.status === "in_review" && !b.running && (
                  <button className="btn" onClick={() => patch({ status: "done" })}>
                    <Check size={14} /> Approve & mark Done
                  </button>
                )}
              </div>
              {!t.assigneeId && <p className="text-xs text-muted">Assign an agent to run this ticket.</p>}
              {notice && <p className="text-xs text-muted flex items-center gap-1.5"><Clock size={12} /> {notice}</p>}
              <ErrorNote message={error} />

              {b.children.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Sub-tickets</h3>
                  <div className="space-y-1">
                    {b.children.map((c) => (
                      <button key={c.id} onClick={() => openTicket(c.id)} className="w-full flex items-center gap-2 text-left text-sm rounded-lg px-2 py-1.5 hover:bg-panel-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_STYLE[c.status].dot }} />
                        <span className="font-mono text-xs text-muted">LUM-{c.number}</span>
                        <span className="truncate flex-1">{c.title}</span>
                        <AgentAvatar agent={agentById(agents, c.assigneeId)} size={20} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {changes.length > 0 && (
                <div>
                  <div className="flex items-center mb-2">
                    <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
                      Changes · {changes.length} file{changes.length > 1 ? "s" : ""}
                    </h3>
                    {!b.running && (
                      <button className="btn btn-ghost btn-sm ml-auto !h-6 text-muted" onClick={undoAll} title="Put every file back the way it was before this ticket">
                        <RotateCcw size={11} /> Undo all
                      </button>
                    )}
                  </div>
                  <div className="rounded-xl border divide-y">
                    {changes.map((c) => (
                      <button key={c.path} onClick={() => setDiffPath(c.path)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-2">
                        <FileCode2 size={13} className="text-accent shrink-0" />
                        <span className="font-mono text-[12.5px] truncate flex-1">{c.path}</span>
                        {c.created && <span className="chip !text-[10px]">new</span>}
                        {c.deleted && <span className="chip !text-[10px]">deleted</span>}
                        {c.changedLater && <span className="chip !text-[10px]" title="Changed again later by someone else">edited since</span>}
                        <span className="text-[11px] tabular-nums text-success">+{c.adds}</span>
                        <span className="text-[11px] tabular-nums text-danger">−{c.dels}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Activity</h3>
                <ol className="space-y-3">
                  {b.events.map((e) => (
                    <EventRow key={e.id} e={e} workspaceId={workspace?.id ?? ""} />
                  ))}
                  {b.running && (
                    <li className="flex items-center gap-2 text-xs text-muted pl-1">
                      <span className="live-dot" />
                      {liveLines[0]?.text ?? "Thinking…"}
                    </li>
                  )}
                </ol>
                <div ref={bottomRef} />
              </div>
            </div>
          </div>

          {diffPath && (
            <DiffModal
              target={{ ticketId: t.id, path: diffPath }}
              onClose={() => setDiffPath(null)}
              onUndone={() => {
                loadChanges();
                load();
              }}
            />
          )}
          {!canEdit ? (
            <footer className="border-t p-3 shrink-0 text-xs text-muted text-center">You have view-only access to this workspace.</footer>
          ) : (
          <footer className="border-t p-3 shrink-0">
            <textarea
              className="input text-sm"
              rows={2}
              placeholder={t.status === "waiting_for_user" ? "Answer the agent's question…" : "Leave a comment or feedback…"}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(t.status === "waiting_for_user");
              }}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button className="btn btn-sm btn-ghost mr-auto" onClick={rememberComment} disabled={!comment.trim()} title="Save this as a preference every agent will follow, in all future tickets">
                <Brain size={13} /> Remember
              </button>
              <button className="btn btn-sm" onClick={() => send(false)} disabled={!comment.trim()}>
                <MessageSquare size={13} /> Comment
              </button>
              {t.assigneeId && !b.running && (
                <button className="btn btn-sm btn-primary" onClick={() => send(true)} disabled={!comment.trim()}>
                  <Play size={12} /> Send & run {assignee?.name}
                </button>
              )}
            </div>
          </footer>
          )}
        </>
      )}
    </aside>
  );

  function EventRow({ e, workspaceId }: { e: TicketEvent; workspaceId: string }) {
    const agent = agentById(agents, e.actor);
    const by = e.meta?.by as { id: string; name: string } | undefined;
    const who = e.actor === "user" ? (by && by.id !== me?.id ? by.name : "You") : e.actor === "system" ? "Luma" : agent?.name ?? "Agent";
    const time = <span className="text-[11px] text-muted">{timeAgo(e.createdAt)}</span>;

    if (["status_change", "assignment", "created", "tool_call"].includes(e.type)) {
      const Icon = e.type === "tool_call" ? Wrench : Sparkles;
      return (
        <li className="flex items-center gap-2 text-xs text-muted pl-1">
          <Icon size={12} />
          <span>
            <b className="font-medium text-ink/80">{who}</b>{" "}
            {e.type === "status_change"
              ? `moved this ${prettyStatus(e.content)}`
              : e.type === "created"
                ? "created this ticket"
                : e.content.charAt(0).toLowerCase() + e.content.slice(1)}
          </span>
          {time}
        </li>
      );
    }
    if (e.type === "file_change") {
      const path = String(e.meta?.path ?? "");
      return (
        <li className="flex items-center gap-2 text-xs pl-1">
          <FileCode2 size={12} className="text-accent" />
          <span className="text-muted">
            <b className="font-medium text-ink/80">{who}</b> {e.content.split(" ")[0].toLowerCase()}{" "}
            <Link className="font-mono text-accent-ink hover:underline" href={`/w/${workspaceId}/editor?file=${encodeURIComponent(path)}`}>
              {path}
            </Link>
          </span>
          {time}
        </li>
      );
    }
    if (e.type === "commit") {
      const repo = e.meta?.repo ? String(e.meta.repo) : null;
      const sha = String(e.meta?.sha ?? "");
      return (
        <li className="flex items-center gap-2 text-xs text-muted pl-1">
          <GitCommitHorizontal size={12} className="text-accent" />
          <span>
            {repo && sha ? (
              <>Committed <a className="font-mono text-accent-ink hover:underline" href={`https://github.com/${repo}/commit/${sha}`} target="_blank" rel="noreferrer">{sha}</a>{e.content.replace(/^Committed \S+/, "")}</>
            ) : (
              e.content
            )}
          </span>
          {time}
        </li>
      );
    }
    if (e.type === "command") {
      const status = String(e.meta?.status ?? "");
      const okRun = status === "ok";
      return (
        <li className="pl-1">
          <details className="group">
            <summary className="flex items-center gap-2 text-xs cursor-pointer list-none">
              <TerminalSquare size={12} className={okRun ? "text-success" : "text-danger"} />
              <b className="font-medium text-ink/80">{who}</b>
              <code className="font-mono text-[11.5px] bg-panel-2 rounded px-1.5 py-0.5 truncate max-w-[220px]">{e.content.replace(/^\$ /, "")}</code>
              <span className={okRun ? "text-success" : "text-danger"}>{okRun ? "passed" : status === "refused" ? "refused" : status === "timeout" ? "timed out" : `failed${e.meta?.exitCode != null ? ` (${e.meta.exitCode})` : ""}`}</span>
              {time}
            </summary>
            <pre className="mt-1.5 ml-5 max-h-60 overflow-auto scroll-thin rounded-lg bg-[#0f1117] text-[#c9d1d9] text-[11.5px] p-2.5 whitespace-pre-wrap break-words">{String(e.meta?.output ?? "") || "(no output)"}</pre>
          </details>
        </li>
      );
    }
    if (e.type === "approval") {
      return (
        <li className="flex items-center gap-2 text-xs text-muted pl-1">
          <Hand size={12} className="text-warning" />
          {e.actor === "system" ? (
            <span className="text-ink/80">{e.content}</span>
          ) : (
            <span><b className="font-medium text-ink/80">{who}</b> {e.content.charAt(0).toLowerCase() + e.content.slice(1)}</span>
          )}
          {time}
        </li>
      );
    }
    const tone =
      e.type === "handoff"
        ? "bg-accent-soft/40 border-accent/20"
        : e.type === "question"
        ? "bg-warning/10 border-warning/30"
        : e.type === "summary"
          ? "bg-success/10 border-success/30"
          : e.type === "error"
            ? "bg-danger/10 border-danger/30"
            : e.actor === "user"
              ? "bg-accent-soft/60 border-transparent"
              : "bg-panel-2 border-transparent";
    const badge =
      e.type === "question" ? (
        <span className="chip !bg-warning/15 !text-warning"><CircleHelp size={11} /> Question for you</span>
      ) : e.type === "summary" ? (
        <span className="chip !bg-success/15 !text-success"><Check size={11} /> Summary</span>
      ) : e.type === "handoff" ? (
        <span className="chip !bg-accent-soft !text-accent-ink"><GitBranch size={11} /> Handoff</span>
      ) : e.type === "error" ? (
        <span className="chip !bg-danger/15 !text-danger"><AlertTriangle size={11} /> Problem</span>
      ) : null;
    return (
      <li className="flex gap-2.5">
        {e.actor === "user" ? (
          <span className="w-7 h-7 rounded-full bg-accent text-white grid place-items-center text-xs font-bold shrink-0">Y</span>
        ) : (
          <AgentAvatar agent={agent ?? { avatar: "✦", color: "#78716c", name: "Luma" }} size={28} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{who}</span>
            {badge}
            {time}
          </div>
          <div className={clsx("rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap break-words", tone)}>{e.content}</div>
        </div>
      </li>
    );
  }
}

function prettyStatus(change: string) {
  const to = change.split("→")[1]?.trim() as Ticket["status"] | undefined;
  return to && STATUS_STYLE[to] ? `to ${STATUS_STYLE[to].label}` : change;
}

