"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Clock, GitBranch, Hand, KanbanSquare, List, Plus } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { NewTicketModal } from "@/components/NewTicketModal";
import { AutopilotBar } from "@/components/AutopilotBar";
import { AgentAvatar, EmptyState, PriorityBars, StatusBadge } from "@/components/ui";
import { agentById, api, STATUS_STYLE, timeAgo, type TicketView } from "@/lib/client";
import { TICKET_STATUSES, type TicketStatus } from "@/lib/types";

const MAIN_COLUMNS: TicketStatus[] = ["backlog", "todo", "in_progress", "in_review", "waiting_for_user", "done"];

export default function BoardPage() {
  const { workspace, tickets, agents, openTicket, reload, canEdit } = useWorkspace();
  const [view, setView] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);
  const [agentFilter, setAgentFilter] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (!agentFilter || t.assigneeId === agentFilter) &&
          (!query || `${t.title} ${t.description} LUM-${t.number}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [tickets, agentFilter, query],
  );

  const columns = [
    ...MAIN_COLUMNS,
    ...(["blocked", "failed"] as TicketStatus[]).filter((s) => tickets.some((t) => t.status === s)),
  ];

  const move = async (id: string, status: TicketStatus) => {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === status || t.running) return;
    await api(`/api/tickets/${id}`, { method: "PATCH", json: { status } }).catch(() => {});
    reload();
  };

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  return (
    <div className="h-full flex flex-col" data-tour="board">
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-4 border-b bg-panel">
        <h1 className="text-lg font-semibold mr-2">Tickets</h1>
        <div className="flex rounded-lg border p-0.5">
          {(["board", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx("btn btn-sm !h-7 !border-0", view === v ? "!bg-panel-2" : "btn-ghost text-muted")}
            >
              {v === "board" ? <KanbanSquare size={13} /> : <List size={13} />} {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <input className="input !py-1 !text-sm max-w-[200px]" placeholder="Search tickets…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input !py-1 !text-sm max-w-[180px]" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>
          ))}
        </select>
        <button className="btn btn-primary ml-auto" onClick={() => setCreating(true)} disabled={!canEdit}>
          <Plus size={14} /> New ticket
        </button>
      </div>

      <div className="px-4 md:px-6 pt-3">
        <AutopilotBar />
      </div>

      {tickets.length === 0 ? (
        <div className="p-6">
          <div className="card">
            <EmptyState
              icon={<KanbanSquare size={22} />}
              title="No tickets yet"
              body="Create a ticket and assign it to an agent, or describe your goal on the Overview page and let the Project Manager plan it."
              action={<button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> New ticket</button>}
            />
          </div>
        </div>
      ) : view === "board" ? (
        <div className="flex-1 min-h-0 overflow-x-auto scroll-thin">
          <div className="flex gap-3 p-4 md:p-6 h-full min-w-max">
            {columns.map((col) => {
              const items = filtered.filter((t) => t.status === col);
              return (
                <div
                  key={col}
                  className={clsx("w-[272px] shrink-0 flex flex-col rounded-2xl bg-panel-2/70 transition", over === col && "ring-2 ring-accent/50")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(col);
                  }}
                  onDragLeave={() => setOver((o) => (o === col ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(null);
                    if (dragging) move(dragging, col);
                  }}
                >
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: STATUS_STYLE[col].dot }} />
                    <span className="text-[13px] font-semibold">{STATUS_STYLE[col].label}</span>
                    <span className="text-xs text-muted">{items.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2 space-y-2">
                    {items.map((t) => (
                      <TicketCard
                        key={t.id}
                        t={t}
                        onOpen={() => openTicket(t.id)}
                        onDragStart={() => setDragging(t.id)}
                        onDragEnd={() => setDragging(null)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="p-4 md:p-6 overflow-auto">
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel-2 text-xs text-muted text-left">
                <tr>
                  <th className="font-medium px-4 py-2.5 w-20">ID</th>
                  <th className="font-medium px-4 py-2.5">Title</th>
                  <th className="font-medium px-4 py-2.5">Status</th>
                  <th className="font-medium px-4 py-2.5 hidden md:table-cell">Agent</th>
                  <th className="font-medium px-4 py-2.5 hidden md:table-cell">Updated</th>
                </tr>
              </thead>
              <tbody>
                {[...filtered]
                  .sort((a, b) => TICKET_STATUSES.findIndex((s) => s.id === a.status) - TICKET_STATUSES.findIndex((s) => s.id === b.status) || b.number - a.number)
                  .map((t) => {
                    const a = agentById(agents, t.assigneeId);
                    return (
                      <tr key={t.id} className="border-t hover:bg-panel-2 cursor-pointer" onClick={() => openTicket(t.id)}>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted">LUM-{t.number}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-2"><PriorityBars priority={t.priority} /> {t.title}</span>
                        </td>
                        <td className="px-4 py-2.5"><StatusBadge status={t.status} /></td>
                        <td className="px-4 py-2.5 hidden md:table-cell">
                          <span className="inline-flex items-center gap-2"><AgentAvatar agent={a} size={22} /> {a?.name ?? "—"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-muted hidden md:table-cell">{timeAgo(t.updatedAt)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewTicketModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function TicketCard({
  t,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  t: TicketView;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { agents, tickets } = useWorkspace();
  const a = agentById(agents, t.assigneeId);
  const blockers = (t.dependsOn ?? [])
    .map((id) => tickets.find((x) => x.id === id))
    .filter((d) => d && d.status !== "done" && d.status !== "in_review");
  return (
    <button
      draggable={!t.running}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className="w-full text-left card !shadow-none p-3 hover:border-accent/40 transition cursor-pointer"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-mono text-[11px] text-muted">LUM-{t.number}</span>
        <PriorityBars priority={t.priority} />
        {t.running && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-success font-medium">
            <span className="live-dot" /> working
          </span>
        )}
      </div>
      <div className="text-[13px] font-medium leading-snug line-clamp-3">{t.title}</div>
      {(t.pendingHandoff || (t.queued && !t.running) || (t.handoffs?.length ?? 0) > 0) && (
        <div className="flex flex-wrap gap-1 mt-2">
          {t.pendingHandoff && (
            <span className="chip !text-[10px] !bg-warning/15 !text-warning">
              <Hand size={10} /> Approve handoff → {agentById(agents, t.pendingHandoff.toAgentId)?.name ?? "?"}
            </span>
          )}
          {t.queued && !t.running && (
            <span className="chip !text-[10px]" title={blockers.length ? "Waiting for earlier tickets to finish" : "Starts when an agent is free"}>
              <Clock size={10} /> {blockers.length ? `After ${blockers.map((d) => `LUM-${d!.number}`).join(", ")}` : "Queued"}
            </span>
          )}
          {(t.handoffs?.length ?? 0) > 0 && (
            <span className="chip !text-[10px]" title="Times this ticket was passed between agents">
              <GitBranch size={10} /> {t.handoffs!.length} handoff{t.handoffs!.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-2.5">
        {t.labels.map((l) => (
          <span key={l} className="chip !text-[10px]">{l}</span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          {a && <span className="text-[11px] text-muted">{a.name}</span>}
          <AgentAvatar agent={a} size={22} />
        </span>
      </div>
    </button>
  );
}
