"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { ErrorNote } from "@/components/ui";
import { AuthCard } from "@/components/AuthCard";

interface InviteInfo {
  email: string;
  role: "admin" | "member";
  workspace: { id: string; name: string; icon: string; role: string } | null;
  invitedBy: string | null;
  hasAccount: boolean;
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<InviteInfo>(`/api/auth/invite/${token}`).then(setInfo).catch((e) => setError((e as Error).message));
  }, [token]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspaceId: string | null }>(`/api/auth/invite/${token}`, { method: "POST", json: { name, password } });
      router.replace(r.workspaceId ? `/w/${r.workspaceId}` : "/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!info)
    return (
      <AuthCard title="Invitation">
        {error ? <ErrorNote message={error} /> : <p className="text-sm text-muted">Loading…</p>}
      </AuthCard>
    );

  const what = info.workspace ? (
    <>
      {info.invitedBy ?? "Someone"} invited you to <b>{info.workspace.icon} {info.workspace.name}</b> as {info.workspace.role === "viewer" ? "a viewer" : `an ${info.workspace.role}`}.
    </>
  ) : (
    <>{info.invitedBy ?? "An admin"} invited you to Luma AI{info.role === "admin" ? " as an admin" : ""}.</>
  );

  return (
    <AuthCard title="You're invited" subtitle={what}>
      {info.hasAccount ? (
        <form onSubmit={accept} className="space-y-3">
          <p className="text-sm">You already have an account as <b>{info.email}</b>. Sign in, then open this link again, or accept now if you're signed in.</p>
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>Accept</button>
            <Link className="btn" href={`/login?next=/invite/${token}`}>Sign in</Link>
          </div>
        </form>
      ) : (
        <form onSubmit={accept} className="space-y-3">
          <div>
            <label className="label">Email</label>
            <input className="input" value={info.email} disabled />
          </div>
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className="label" htmlFor="pw">Choose a password (8+ characters)</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <ErrorNote message={error} />
          <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? "Creating your account…" : "Create account & join"}</button>
        </form>
      )}
    </AuthCard>
  );
}
