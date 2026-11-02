"use client";

import { useEffect, useState } from "react";
import { Mail, UserRound } from "lucide-react";
import { api } from "@/lib/client";
import { ErrorNote } from "./ui";

interface Me {
  authEnabled: boolean;
  user: { id: string; name: string; email: string; role: "admin" | "member"; notifyEmail: "off" | "instant" | "daily" } | null;
}

/** Settings → Profile: name, email notifications, password (only when sign-in is on). */
export function ProfileSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Me>("/api/auth/me").then((m) => {
      setMe(m);
      setName(m.user?.name ?? "");
    });
  }, []);
  if (!me?.user) return null;
  const save = async (json: Record<string, unknown>, done: string) => {
    setError(null);
    setMsg(null);
    try {
      const r = await api<{ user: Me["user"] }>("/api/auth/me", { method: "PATCH", json });
      setMe({ ...me, user: r.user });
      setMsg(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <UserRound size={17} />
        <h2 className="font-semibold">Profile</h2>
        <span className="text-xs text-muted ml-auto">{me.user.email}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Name</label>
          <div className="flex gap-2">
            <input className="input !py-1.5 !text-sm" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn btn-sm" onClick={() => save({ name }, "Name saved.")}>Save</button>
          </div>
        </div>
        <div>
          <label className="label">Email me about</label>
          <select className="input !py-1.5 !text-sm" value={me.user.notifyEmail} onChange={(e) => save({ notifyEmail: e.target.value }, "Saved.")}>
            <option value="instant">Important things, right away</option>
            <option value="daily">A daily digest</option>
            <option value="off">Nothing (in-app only)</option>
          </select>
          <p className="text-[11px] text-muted mt-1">Important = questions, approvals, failures, @mentions. Needs email set up by an admin.</p>
        </div>
      </div>
      <form
        className="flex flex-wrap gap-2 mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          save({ currentPassword: pw.current, newPassword: pw.next }, "Password changed.").then(() => setPw({ current: "", next: "" }));
        }}
      >
        <input className="input !py-1.5 !text-sm flex-1 min-w-[150px]" type="password" autoComplete="current-password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        <input className="input !py-1.5 !text-sm flex-1 min-w-[150px]" type="password" autoComplete="new-password" placeholder="New password (8+)" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        <button className="btn btn-sm">Change password</button>
      </form>
      {msg && <p className="text-xs text-success mt-2">{msg}</p>}
      <ErrorNote message={error} />
    </section>
  );
}

interface EmailCfg {
  email: { host: string; port: number; secure: boolean; user?: string; from: string; hasPassword: boolean } | null;
  emailFromEnv: boolean;
  appUrl: string | null;
}

const PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  "Google Workspace / Gmail": { host: "smtp.gmail.com", port: 465, secure: true },
  "Microsoft 365": { host: "smtp.office365.com", port: 587, secure: false },
  SendGrid: { host: "smtp.sendgrid.net", port: 587, secure: false },
  Postmark: { host: "smtp.postmarkapp.com", port: 587, secure: false },
};

/** Settings → Email: SMTP for invites, password resets and notifications (admins). */
export function EmailSettings() {
  const [cfg, setCfg] = useState<EmailCfg | null>(null);
  const [f, setF] = useState({ host: "", port: 587, secure: false, user: "", pass: "", from: "", appUrl: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);
  const load = async () => {
    const [s, me] = await Promise.all([api<EmailCfg>("/api/settings"), api<Me>("/api/auth/me")]);
    setAllowed(!me.authEnabled || me.user?.role === "admin");
    setCfg(s);
    setF({
      host: s.email?.host ?? "",
      port: s.email?.port ?? 587,
      secure: s.email?.secure ?? false,
      user: s.email?.user ?? "",
      pass: "",
      from: s.email?.from ?? "",
      appUrl: s.appUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
    });
  };
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  if (!cfg || !allowed) return null;
  const run = async (json: Record<string, unknown>, done: (r: Record<string, unknown>) => string) => {
    setError(null);
    setMsg(null);
    try {
      const r = await api<Record<string, unknown>>("/api/settings", { method: "POST", json });
      setMsg(done(r));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <Mail size={17} />
        <h2 className="font-semibold">Email</h2>
        <span className={`chip ml-auto ${cfg.email || cfg.emailFromEnv ? "!bg-success/15 !text-success" : ""}`}>{cfg.emailFromEnv ? "Set by LUMA_SMTP_URL" : cfg.email ? "Set up" : "Off"}</span>
      </div>
      <p className="text-sm text-muted mb-3">Lets Luma email invites, password reset links and notifications, through your own mail provider (SMTP). Passwords are encrypted on this computer.</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(PRESETS).map(([label, p]) => (
          <button key={label} className="chip cursor-pointer hover:text-ink" onClick={() => setF({ ...f, ...p })}>{label}</button>
        ))}
      </div>
      <div className="grid sm:grid-cols-[1fr_90px_auto] gap-2 items-end">
        <div><label className="label">SMTP host</label><input className="input !py-1.5 !text-sm" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" /></div>
        <div><label className="label">Port</label><input className="input !py-1.5 !text-sm" type="number" value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} /></div>
        <label className="flex items-center gap-1.5 text-sm pb-2"><input type="checkbox" className="accent-[var(--accent)]" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} /> SSL/TLS</label>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <div><label className="label">Username</label><input className="input !py-1.5 !text-sm" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} autoComplete="off" /></div>
        <div><label className="label">Password / app password</label><input className="input !py-1.5 !text-sm" type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} placeholder={cfg.email?.hasPassword ? "•••••• (unchanged)" : ""} autoComplete="new-password" /></div>
        <div><label className="label">From</label><input className="input !py-1.5 !text-sm" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="Luma AI <luma@studio93.io>" /></div>
        <div><label className="label">Luma's web address (for links in emails)</label><input className="input !py-1.5 !text-sm" value={f.appUrl} onChange={(e) => setF({ ...f, appUrl: e.target.value })} placeholder="https://luma.example.com" /></div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn btn-sm btn-primary" onClick={() => run({ email: { host: f.host, port: f.port, secure: f.secure, user: f.user, pass: f.pass || undefined, from: f.from }, appUrl: f.appUrl }, () => "Saved.")}>Save</button>
        <button className="btn btn-sm" disabled={!cfg.email && !cfg.emailFromEnv} onClick={() => run({ testEmail: true }, (r) => `Test email sent to ${String(r.sentTo)}.`)}>Send test email</button>
        {cfg.email && <button className="btn btn-sm btn-ghost btn-danger ml-auto" onClick={() => run({ email: null }, () => "Email turned off.")}>Turn off</button>}
      </div>
      {msg && <p className="text-xs text-success mt-2">{msg}</p>}
      <ErrorNote message={error} />
    </section>
  );
}
