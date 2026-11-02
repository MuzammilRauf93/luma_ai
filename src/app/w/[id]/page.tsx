"use client";

import { confirmDialog, promptDialog, toast } from "@/components/Dialogs";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, Send, Settings2, Sparkles, Users } from "lucide-react";
import { ShareModal } from "@/components/ShareModal";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { SimulatorPreview } from "@/components/SimulatorPreview";
import { AutopilotBar } from "@/components/AutopilotBar";
import { AgentAvatar, ErrorNote, Modal, StatusBadge } from "@/components/ui";
import { agentById, api, timeAgo } from "@/lib/client";
import { APPROVAL_MODES, type Workspace } from "@/lib/types";
import clsx from "clsx";

const EXAMPLES = [
  "A one-page website for my bakery with our menu, opening hours and a contact form.",
  "A personal portfolio with a projects grid, an about section and dark mode.",
  "A landing page for a fitness app with pricing plans and an FAQ.",
];

export default function OverviewPage() {
  const { workspace, agents, tickets, activity, openTicket, reload, fileVersion, canEdit } = useWorkspace();
  const [shareOpen, setShareOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  const count = (fn: (s: string) => boolean) => tickets.filter((t) => fn(t.status)).length;
  const attention = tickets.filter((t) => t.status === "waiting_for_user" || t.status === "in_review" || t.status === "failed");

  const submitGoal = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ticket: { id: string }; started: boolean; error: string | null }>(`/api/workspaces/${workspace.id}/goal`, {
        method: "POST",
        json: { goal },
      });
      if (res.error) setError(res.error);
      setGoal("");
      await reload();
      openTicket(res.ticket.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{workspace.icon}</span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">{workspace.name}</h1>
            <p className="text-sm text-muted">{workspace.description || "No description yet."}</p>
          </div>
        </div>
        <div className="flex gap-2">
        {!canEdit && <span className="chip self-center">View only</span>}
        <button className="btn" onClick={() => setShareOpen(true)}>
          <Users size={14} /> Share
        </button>
        <button className="btn" data-tour="ws-settings" onClick={() => setSettingsOpen(true)} disabled={!canEdit}>
          <Settings2 size={14} /> Workspace settings
        </button>
        </div>
      </div>

      {/* Goal box */}
      <section data-tour="goal" className="card p-5 mb-6" style={{ background: "linear-gradient(180deg, var(--accent-soft), var(--panel) 70%)" }}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-accent" />
          <h2 className="font-semibold">What would you like your team to build?</h2>
        </div>
        <p className="text-sm text-muted mb-3">Describe it in your own words. Maya, your Project Manager, will turn it into tickets for the team.</p>
        <textarea
          className="input"
          rows={3}
          placeholder={EXAMPLES[0]}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && goal.trim()) submitGoal();
          }}
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {EXAMPLES.slice(1).map((ex) => (
            <button key={ex} className="chip cursor-pointer hover:text-ink" onClick={() => setGoal(ex)}>
              {ex.length > 48 ? ex.slice(0, 46) + "…" : ex}
            </button>
          ))}
          <button className="btn btn-primary ml-auto" onClick={submitGoal} disabled={busy || !goal.trim() || !canEdit}>
            <Send size={13} /> {busy ? "Sending…" : "Send to the team"}
          </button>
        </div>
        <ErrorNote message={error} />
      </section>

      <div className="mb-4" data-tour="autopilot">
        <AutopilotBar />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="To do" value={count((s) => s === "todo" || s === "backlog")} />
        <Tile label="In progress" value={count((s) => s === "in_progress")} />
        <Tile label="Needs you" value={attention.length} warn />
        <Tile label="Done" value={count((s) => s === "done")} />
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6 min-w-0">
          {attention.length > 0 && (
            <section className="card p-5">
              <h2 className="font-semibold mb-3">Needs your attention</h2>
              <ul className="space-y-1">
                {attention.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => openTicket(t.id)} className="w-full flex items-center gap-3 text-left rounded-lg px-2 py-2 hover:bg-panel-2">
                      <AgentAvatar agent={agentById(agents, t.assigneeId)} size={26} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{t.title}</span>
                        <span className="text-xs text-muted">LUM-{t.number} · updated {timeAgo(t.updatedAt)}</span>
                      </span>
                      <StatusBadge status={t.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Your team</h2>
              <Link href={`/w/${workspace.id}/agents`} className="text-sm text-accent-ink">Manage agents</Link>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {agents.map((a) => {
                const current = tickets.find((t) => t.running && t.assigneeId === a.id);
                const queued = tickets.filter((t) => t.assigneeId === a.id && (t.status === "todo" || t.status === "backlog")).length;
                return (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border p-3">
                    <AgentAvatar agent={a} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.name} <span className="text-muted font-normal">· {a.role}</span></div>
                      {current ? (
                        <button onClick={() => openTicket(current.id)} className="flex items-center gap-1.5 text-xs text-success truncate max-w-full">
                          <span className="live-dot shrink-0" /> <span className="truncate">{current.title}</span>
                        </button>
                      ) : (
                        <div className="text-xs text-muted">{a.paused ? "Paused" : queued ? `${queued} ticket${queued > 1 ? "s" : ""} queued` : "Available"}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="font-semibold">Preview</h2>
              <Link href={`/w/${workspace.id}/editor`} className="btn btn-sm">
                <Eye size={13} /> Open editor
              </Link>
            </div>
            {workspace.platform === "flutter" ? (
              <div className="h-[460px]">
                <SimulatorPreview workspaceId={workspace.id} compact />
              </div>
            ) : (
              <div className="relative h-[300px] bg-white overflow-hidden">
                <iframe
                  key={fileVersion}
                  src={`/preview/${workspace.id}/`}
                  title="Preview"
                  className="absolute top-0 left-0 border-0 origin-top-left pointer-events-none"
                  style={{ width: "200%", height: "600px", transform: "scale(0.5)" }}
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            )}
          </section>
        </div>

        <section className="card p-5 h-fit lg:sticky lg:top-6">
          <h2 className="font-semibold mb-1">Live activity</h2>
          <p className="text-xs text-muted mb-4">What your agents are doing right now.</p>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">Quiet for now. Send a goal or run a ticket to see agents at work.</p>
          ) : (
            <ol className="space-y-3 max-h-[560px] overflow-y-auto scroll-thin pr-1">
              {[...activity].reverse().slice(0, 60).map((a) => {
                const agent = agentById(agents, a.agentId);
                const ticket = tickets.find((t) => t.id === a.ticketId);
                return (
                  <li key={a.id} className="flex gap-2.5">
                    <AgentAvatar agent={agent} size={24} />
                    <div className="min-w-0">
                      <div className="text-xs">
                        <b className="font-medium">{agent?.name ?? "Agent"}</b>{" "}
                        <span className={a.kind === "error" ? "text-danger" : "text-muted"}>
                          {a.kind === "text" ? "said" : a.text.charAt(0).toLowerCase() + a.text.slice(1)}
                        </span>
                      </div>
                      {a.kind === "text" && <p className="text-xs text-ink/80 line-clamp-3 mt-0.5">{a.text}</p>}
                      {ticket && (
                        <button className="text-[11px] text-accent-ink truncate max-w-full" onClick={() => openTicket(ticket.id)}>
                          LUM-{ticket.number} {ticket.title}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Link href={`/w/${workspace.id}/board`} className="btn btn-sm w-full mt-4">
            Open ticket board <ArrowRight size={13} />
          </Link>
        </section>
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} />

      <WorkspaceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} workspace={workspace} />
    </div>
  );
}

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5" style={warn && value > 0 ? { color: "var(--warning)" } : undefined}>
        {value}
      </div>
    </div>
  );
}

function WorkspaceSettings({ open, onClose, workspace }: { open: boolean; onClose: () => void; workspace: Workspace }) {
  const { reload, agents } = useWorkspace();
  const router = useRouter();
  const [form, setForm] = useState(workspace);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      await api(`/api/workspaces/${workspace.id}`, { method: "PATCH", json: form });
      await reload();
      window.dispatchEvent(new Event("luma:workspaces"));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete “${workspace.name}”?`, body: "All its tickets, files, history and memory are deleted. This can't be undone.", confirmLabel: "Delete workspace", danger: true }))) return;
    await api(`/api/workspaces/${workspace.id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("luma:workspaces"));
    router.push("/");
  };

  return (
    <Modal open={open} onClose={onClose} title="Workspace settings">
      <div className="space-y-4">
        <div className="grid grid-cols-[64px_1fr] gap-2">
          <div>
            <label className="label">Icon</label>
            <input className="input text-center" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="label">Tech stack (agents follow this)</label>
          <input className="input" value={form.techStack} onChange={(e) => setForm({ ...form, techStack: e.target.value })} />
        </div>
        <div>
          <span className="label">Approval mode</span>
          <div className="space-y-2">
            {APPROVAL_MODES.map((m) => (
              <label key={m.id} className={clsx("flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer hover:bg-panel-2", form.approvalMode === m.id && "border-accent/60 bg-accent-soft/30")}>
                <input type="radio" name="approvalMode" className="mt-0.5 accent-[var(--accent)]" checked={form.approvalMode === m.id} onChange={() => setForm({ ...form, approvalMode: m.id })} />
                <span>
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="block text-xs text-muted">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Agents working at once</label>
            <select className="input" value={form.maxParallelRuns ?? 2} onChange={(e) => setForm({ ...form, maxParallelRuns: Number(e.target.value) })}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n === 1 ? "1 (one at a time)" : n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Token budget per run</label>
            <input
              className="input"
              type="number"
              min={10000}
              step={10000}
              value={form.ticketBudgetTokens}
              onChange={(e) => setForm({ ...form, ticketBudgetTokens: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="rounded-lg border p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input type="checkbox" className="accent-[var(--accent)]" checked={form.commandsEnabled !== false} onChange={(e) => setForm({ ...form, commandsEnabled: e.target.checked })} />
            Let agents run commands (tests, analyzers, formatters)
          </label>
          <p className="text-xs text-muted">Only agents with the “Run commands” permission, only allowlisted tools, inside this project. On macOS commands run in a sandbox that can't touch other folders or your credentials.</p>
          <div>
            <label className="label">Extra allowed commands (one per line, e.g. <code>make test</code>)</label>
            <textarea className="input font-mono text-[12.5px]" rows={2} value={(form.extraCommands ?? []).join("\n")} onChange={(e) => setForm({ ...form, extraCommands: e.target.value.split("\n") })} />
          </div>
          {agents.some((a) => a.presetKey && ["frontend_developer", "mobile_developer", "backend_developer", "automation_engineer", "qa_tester"].includes(a.presetKey) && !a.permissions.includes("run_commands")) && (
            <button type="button" className="btn btn-sm" onClick={async () => { await api(`/api/workspaces/${workspace.id}`, { method: "PATCH", json: { grantCommands: true } }); await reload(); }}>
              Give developers & QA the “Run commands” permission
            </button>
          )}
        </div>
        <p className="text-xs text-muted">More agents at once finishes faster but uses your plan limits faster. Loop protection: a ticket can be handed off at most 6 times, two agents can't pass it back and forth more than twice, and autopilot pauses itself after 40 automatic runs in an hour.</p>
        <ErrorNote message={error} />
        <div className="flex justify-between">
          <button className="btn btn-danger" onClick={remove}>Delete workspace</button>
          <div className="flex gap-2">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
