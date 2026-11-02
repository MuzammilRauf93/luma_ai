"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2, UserPlus } from "lucide-react";
import { api } from "@/lib/client";
import type { WorkspaceRole } from "@/lib/types";
import { ErrorNote, Modal } from "./ui";
import { InviteLink } from "./TeamSettings";
import { useWorkspace } from "./WorkspaceProvider";

interface Members {
  authEnabled: boolean;
  members: { userId: string; name: string; email: string; role: WorkspaceRole; lumaAdmin: boolean }[];
  admins: { userId: string; name: string; email: string }[];
  invites: { email: string; role: WorkspaceRole; expiresAt: string }[];
}

const ROLE_HINT: Record<WorkspaceRole, string> = {
  owner: "Everything, including sharing and deleting the workspace",
  editor: "Run agents, edit tickets, files and settings",
  viewer: "See everything, change nothing",
};

export function ShareModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, myRole } = useWorkspace();
  const [d, setD] = useState<Members | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = myRole === "owner";

  const load = useCallback(async () => {
    if (workspace) setD(await api<Members>(`/api/workspaces/${workspace.id}/members`));
  }, [workspace]);
  useEffect(() => {
    if (open) load().catch((e) => setError((e as Error).message));
  }, [open, load]);

  if (!workspace) return null;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Share ${workspace.name}`}>
      {!d ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !d.authEnabled ? (
        <p className="text-sm text-muted">
          Sharing needs sign-in. An admin can turn it on in <Link className="text-accent-ink underline" href="/settings">Settings → Team</Link>; then invite people here.
        </p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y rounded-lg border">
            {d.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{m.name}</span>
                  <span className="block text-xs text-muted truncate">{m.email}</span>
                </span>
                <select
                  className="input !w-auto !py-1 !text-xs"
                  value={m.role}
                  disabled={!isOwner}
                  title={ROLE_HINT[m.role]}
                  onChange={(e) => run(() => api(`/api/workspaces/${workspace.id}/members`, { method: "PATCH", json: { userId: m.userId, role: e.target.value } }))}
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                {isOwner && (
                  <button className="btn btn-ghost btn-sm btn-danger !px-1.5" onClick={() => run(() => api(`/api/workspaces/${workspace.id}/members?userId=${m.userId}`, { method: "DELETE" }))} aria-label="Remove">
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
            {d.invites.map((i) => (
              <li key={i.email} className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
                <span className="flex-1 truncate">{i.email} · invited as {i.role}</span>
                {isOwner && (
                  <button className="btn btn-ghost btn-sm !px-1.5" onClick={() => run(() => api(`/api/workspaces/${workspace.id}/members?invite=${encodeURIComponent(i.email)}`, { method: "DELETE" }))} aria-label="Cancel invite">
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {d.admins.length > 0 && <p className="text-xs text-muted">Luma admins ({d.admins.map((a) => a.name).join(", ")}) can also open this workspace.</p>}
          {isOwner ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const r = await api<{ added?: { name: string }; invite?: { path: string; emailed?: boolean } }>(`/api/workspaces/${workspace.id}/members`, { method: "POST", json: { email, role } });
                  setLink(r.invite ? window.location.origin + r.invite.path + (r.invite.emailed ? "#emailed" : "") : null);
                  setNote(r.added ? `${r.added.name} now has access.` : null);
                  setEmail("");
                });
              }}
            >
              <div className="flex gap-2">
                <input className="input !py-1.5 !text-sm" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <select className="input !w-auto !py-1.5 !text-sm" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="owner">Owner</option>
                </select>
                <button className="btn btn-sm btn-primary shrink-0"><UserPlus size={12} /> Share</button>
              </div>
              <p className="text-xs text-muted">{ROLE_HINT[role]}. People without an account get an invite link.</p>
            </form>
          ) : (
            <p className="text-xs text-muted">Only owners can change who has access.</p>
          )}
          {note && <p className="text-xs text-success">{note}</p>}
          {link && <InviteLink link={link} />}
        </div>
      )}
      <ErrorNote message={error} />
    </Modal>
  );
}
