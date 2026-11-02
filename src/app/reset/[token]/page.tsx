"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { ErrorNote } from "@/components/ui";
import { AuthCard } from "@/components/AuthCard";

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError("The two passwords don't match.");
    setError(null);
    try {
      await api("/api/auth/reset", { method: "POST", json: { token, password: pw } });
      router.replace("/");
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <AuthCard title="Choose a new password" subtitle="You'll be signed out everywhere else.">
      <form onSubmit={submit} className="space-y-3">
        <input className="input" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
        <input className="input" type="password" autoComplete="new-password" placeholder="Repeat it" minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        <ErrorNote message={error} />
        <button className="btn btn-primary w-full justify-center">Save & sign in</button>
      </form>
    </AuthCard>
  );
}
