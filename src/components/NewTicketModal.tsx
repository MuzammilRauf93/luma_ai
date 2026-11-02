"use client";

import { useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/client";
import { LABELS, PRIORITIES, type Label, type Priority, type TicketStatus } from "@/lib/types";
import { ErrorNote, Modal } from "./ui";
import { useWorkspace } from "./WorkspaceProvider";

export function NewTicketModal({
  open,
  onClose,
  defaultStatus = "todo",
}: {
  open: boolean;
  onClose: () => void;
  defaultStatus?: TicketStatus;
}) {
  const { workspace, agents, reload, openTicket } = useWorkspace();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [labels, setLabels] = useState<Label[]>([]);
  const [runNow, setRunNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const { ticket } = await api<{ ticket: { id: string } }>(`/api/workspaces/${workspace.id}/tickets`, {
        method: "POST",
        json: { title, description, assigneeId: assigneeId || null, priority, labels, status: defaultStatus },
      });
      if (runNow && assigneeId) {
        await api(`/api/tickets/${ticket.id}/run`, { method: "POST" }).catch((err) => setError(err.message));
      }
      setTitle("");
      setDescription("");
      setLabels([]);
      await reload();
      onClose();
      openTicket(ticket.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New ticket">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="t-title">Title</label>
          <input id="t-title" className="input" placeholder="Add a contact form to the homepage" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className="label" htmlFor="t-desc">Description — plain language is fine</label>
          <textarea id="t-desc" className="input" rows={4} placeholder="What should happen, and how will you know it's done?" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="t-agent">Assign to</label>
            <select id="t-agent" className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} disabled={a.paused}>
                  {a.avatar} {a.name} — {a.role}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="t-prio">Priority</label>
            <select id="t-prio" className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <span className="label">Labels</span>
          <div className="flex gap-1.5">
            {LABELS.map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLabels((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))}
                className={clsx("chip cursor-pointer", labels.includes(l) && "!bg-accent-soft !text-accent-ink")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {assigneeId && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} className="accent-[var(--accent)]" />
            Start the agent right away
          </label>
        )}
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Create ticket"}</button>
        </div>
      </form>
    </Modal>
  );
}
