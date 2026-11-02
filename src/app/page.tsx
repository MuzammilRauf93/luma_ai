"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderPlus, Plus } from "lucide-react";
import { api, fmtTokens, fmtUsd, timeAgo } from "@/lib/client";
import type { Workspace } from "@/lib/types";
import { EmptyState, PageHeader } from "@/components/ui";
import { NewWorkspaceModal } from "@/components/NewWorkspaceModal";
import { WORKSPACES_CHANGED } from "@/components/AppShell";

type WsItem = Workspace & { ticketCounts: { open: number; done: number; waiting: number } };
type Bucket = { tokens: number; cost: number };

export default function HomePage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WsItem[] | null>(null);
  const [usage, setUsage] = useState<{ month: Bucket; byWorkspace: Record<string, Bucket> } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ workspaces: WsItem[] }>("/api/workspaces").then((d) => setWorkspaces(d.workspaces));
    api<typeof usage>("/api/usage").then(setUsage);
  }, []);

  const waiting = workspaces?.reduce((s, w) => s + w.ticketCounts.waiting, 0) ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <PageHeader
        title="Welcome back"
        subtitle="Pick a workspace or start something new. Your agents are ready."
        actions={
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} /> New workspace
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <Tile label="Workspaces" value={String(workspaces?.length ?? "–")} />
        <Tile label="Need your attention" value={String(waiting)} highlight={waiting > 0} />
        <Tile label="Spent this month (est.)" value={fmtUsd(usage?.month.cost ?? 0)} sub={`${fmtTokens(usage?.month.tokens ?? 0)} tokens`} />
      </div>

      {workspaces && workspaces.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderPlus size={22} />}
            title="Create your first workspace"
            body="A workspace is one project — like “Bakery Website”. It gets its own team of agents, tickets and files."
            action={
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} /> New workspace
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces?.map((w) => (
            <Link key={w.id} href={`/w/${w.id}`} className="card p-5 group hover:border-accent/50 transition">
              <div className="flex items-start justify-between">
                <span className="text-3xl">{w.icon}</span>
                <ArrowRight size={16} className="text-muted opacity-0 group-hover:opacity-100 transition" />
              </div>
              <h3 className="font-semibold mt-3">{w.name}</h3>
              <p className="text-sm text-muted line-clamp-2 min-h-[2.5em]">{w.description || "No description yet."}</p>
              <div className="flex flex-wrap gap-1.5 mt-4">
                <span className="chip">{w.ticketCounts.open} open</span>
                <span className="chip">{w.ticketCounts.done} done</span>
                {w.ticketCounts.waiting > 0 && (
                  <span className="chip" style={{ color: "var(--warning)" }}>{w.ticketCounts.waiting} need you</span>
                )}
              </div>
              <div className="text-xs text-muted mt-3">
                Updated {timeAgo(w.updatedAt)} · {fmtUsd(usage?.byWorkspace[w.id]?.cost ?? 0)}
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewWorkspaceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          window.dispatchEvent(new Event(WORKSPACES_CHANGED));
          router.push(`/w/${id}`);
        }}
      />
    </div>
  );
}

function Tile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums" style={highlight ? { color: "var(--warning)" } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
