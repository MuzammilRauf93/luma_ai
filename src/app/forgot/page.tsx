"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { ErrorNote } from "@/components/ui";
import { AuthCard } from "@/components/AuthCard";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState<null | boolean>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ emailConfigured: boolean }>("/api/auth/forgot", { method: "POST", json: { email } });
      setDone(r.emailConfigured);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {done === null ? (
        <form onSubmit={submit} className="space-y-3">
          <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          <ErrorNote message={error} />
          <button className="btn btn-primary w-full justify-center">Send reset link</button>
        </form>
      ) : done ? (
        <p className="text-sm">If <b>{email}</b> has a Luma account, a reset link is on its way. It works once, for one hour.</p>
      ) : (
        <p className="text-sm">This Luma can't send email yet. Ask a Luma admin to create a reset link for you (Settings → Team).</p>
      )}
      <p className="text-xs text-muted mt-4"><Link className="underline" href="/login">Back to sign in</Link></p>
    </AuthCard>
  );
}
