"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { api, timeAgo } from "@/lib/client";
import { ErrorNote } from "./ui";

interface Me {
  authEnabled: boolean;
  user: { id: string; name: string; email: string; role: "admin" | "member" } | null;
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  lastSeenAt?: string;
  workspaces: number;
}

/** Settings → Team: turn on sign-in, invite people, manage roles (admins only). */
export function TeamSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<{ email: string; role: string; expiresAt: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [invite, setInvite] = useState({ email: "", role: "member" as "admin" | "member" });
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    const m = await api<Me>("/api/auth/me");
    setMe(m);
    if (m.user?.role === "admin") {
      const d = await api<{ users: UserRow[]; invites: typeof invites }>("/api/users");
      setUsers(d.users);
      setInvites(d.invites);
    }
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!me) return null;
  if (me.authEnabled && me.user?.role !== "admin") return null;

  return (
    <section className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Users size={17} />
        <h2 className="font-semibold">Team</h2>
      </div>
      {!me.authEnabled ? (
        <>
          <p className="text-sm text-muted mb-3">
            Luma is in single-user mode: anyone who can open this page can use it. Turn on sign-in to invite teammates and choose who can see or change each workspace.
            You become the admin and the owner of every existing workspace.
          </p>
          <form
            className="grid sm:grid-cols-3 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api("/api/auth/setup", { method: "POST", json: form })).then(() => window.location.reload());
            }}
          >
            <input className="input !py-1.5 !text-sm" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input !py-1.5 !text-sm" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input className="input !py-1.5 !text-sm" type="password" placeholder="Password (8+)" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <button className="btn btn-primary sm:col-span-3 justify-center"><ShieldCheck size={13} /> Turn on sign-in</button>
          </form>
        </>
      ) : (
        <>
          <p className="text-sm text-muted mb-3">Admins manage settings and can open every workspace. Members see the workspaces they're added to (use Share on a workspace).</p>
          <table className="w-full text-sm mb-4">
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="py-2">
                    <div className="font-medium">{u.name}{u.id === me.user?.id && <span className="text-muted font-normal"> (you)</span>}</div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="py-2 text-xs text-muted hidden sm:table-cell">{u.workspaces} workspace{u.workspaces === 1 ? "" : "s"}</td>
                  <td className="py-2 text-xs text-muted hidden sm:table-cell">{u.lastSeenAt ? `seen ${timeAgo(u.lastSeenAt)}` : "never signed in"}</td>
                  <td className="py-2 text-right">
                    <select className="input !w-auto !py-1 !text-xs" value={u.role} disabled={u.id === me.user?.id} onChange={(e) => run(() => api(`/api/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td className="py-2 pl-1 w-8">
                    {u.id !== me.user?.id && (
                      <button className="btn btn-ghost btn-sm btn-danger !px-1.5" onClick={() => confirm(`Remove ${u.name}'s account?`) && run(() => api(`/api/users/${u.id}`, { method: "DELETE" }))} aria-label="Remove">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await api<{ path: string }>("/api/users", { method: "POST", json: invite });
                setLink(window.location.origin + r.path);
                setInvite({ email: "", role: "member" });
              });
            }}
          >
            <input className="input !py-1.5 !text-sm flex-1 min-w-[180px]" type="email" placeholder="teammate@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
            <select className="input !w-auto !py-1.5 !text-sm" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as "admin" | "member" })}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button className="btn btn-sm btn-primary"><UserPlus size={12} /> Create invite link</button>
          </form>
          {link && <InviteLink link={link} />}
          {invites.length > 0 && (
            <p className="text-xs text-muted mt-3">Pending: {invites.map((i) => i.email).join(", ")}</p>
          )}
        </>
      )}
      <ErrorNote message={error} />
    </section>
  );
}

export function InviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border bg-panel-2 p-2.5">
      <div className="text-xs text-muted mb-1">Send this link to them (valid 7 days, works once). Luma doesn't send emails.</div>
      <div className="flex gap-2">
        <input className="input !py-1 !text-xs font-mono" readOnly value={link} onFocus={(e) => e.target.select()} />
        <button
          className="btn btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(link).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy size={12} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
