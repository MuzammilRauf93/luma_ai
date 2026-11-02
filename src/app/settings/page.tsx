"use client";

import { confirmDialog, promptDialog, toast } from "@/components/Dialogs";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { GitHubSettings, SystemSettings } from "@/components/SystemSettings";
import Link from "next/link";
import { BarChart3, KeyRound, Mail, Plug, Server, Sparkles, Trash2, UserRound, Users } from "lucide-react";
import { api, fmtTokens, fmtUsd } from "@/lib/client";
import { TeamSettings } from "@/components/TeamSettings";
import { EmailSettings, ProfileSettings } from "@/components/AccountSettings";
import { ErrorNote, PageHeader } from "@/components/ui";
import type { Workspace } from "@/lib/types";

interface SettingsData {
  authMode: "api_key" | "claude_account";
  account: { email?: string; organization?: string; subscriptionType?: string } | null;
  connected: boolean;
  apiKeyHint: string | null;
  defaultModel: string | null;
  monthlyLimitUsd: number | null;
  deployAccounts?: { netlify: boolean; vercel: boolean };
  github?: string | null;
  claudeToken?: boolean;
}
type Bucket = { tokens: number; cost: number };
interface Usage {
  total: Bucket;
  month: Bucket;
  byWorkspace: Record<string, Bucket>;
}

const TABS = [
  { id: "general", label: "Claude & models", icon: Sparkles, admin: false },
  { id: "profile", label: "Profile", icon: UserRound, admin: false },
  { id: "team", label: "Team", icon: Users, admin: true },
  { id: "integrations", label: "Integrations", icon: Plug, admin: true },
  { id: "email", label: "Email", icon: Mail, admin: true },
  { id: "usage", label: "Usage & limits", icon: BarChart3, admin: true },
  { id: "system", label: "System", icon: Server, admin: true },
] as const;

export default function SettingsPageWrapper() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}

function SettingsPage() {
  const params = useSearchParams();
  const [isAdmin, setIsAdmin] = useState(true);
  useEffect(() => {
    api<{ authEnabled: boolean; user: { role: string } | null }>("/api/auth/me").then((m) => setIsAdmin(!m.authEnabled || m.user?.role === "admin")).catch(() => undefined);
  }, []);
  const requested = params.get("tab") ?? "general";
  const tab = TABS.some((t) => t.id === requested && (!t.admin || isAdmin)) ? requested : "general";
  const [s, setS] = useState<SettingsData | null>(null);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [limit, setLimit] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const st = await api<SettingsData>("/api/settings");
    setS(st);
    setLimit(st.monthlyLimitUsd ? String(st.monthlyLimitUsd) : "");
    if (st.connected) api<{ models: typeof models }>("/api/models").then((d) => setModels(d.models)).catch((e) => setError(e.message));
    api<Usage>("/api/usage").then(setUsage).catch(() => undefined);
    api<{ workspaces: Workspace[] }>("/api/workspaces").then((d) => setWorkspaces(d.workspaces));
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api("/api/settings", { method: "POST", json: patch });
      setMsg("Saved");
      setTimeout(() => setMsg(null), 1500);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disconnect = async () => {
    if (!(await confirmDialog({ title: "Disconnect Claude?", body: "Agents stop working until you connect again.", confirmLabel: "Disconnect", danger: true }))) return;
    await api("/api/settings", { method: "DELETE" });
    load();
  };

  const overLimit = usage && s?.monthlyLimitUsd ? usage.month.cost / s.monthlyLimitUsd : 0;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">
      <PageHeader title="Settings" subtitle="Everything Luma needs, in one place." />
      <div className="grid md:grid-cols-[200px_minmax(0,1fr)] gap-6 items-start">
        <nav className="md:sticky md:top-4 flex md:flex-col gap-1 overflow-x-auto scroll-thin pb-1" aria-label="Settings sections">
          {TABS.filter((t) => !t.admin || isAdmin).map((t) => (
            <Link
              key={t.id}
              href={`/settings?tab=${t.id}`}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap",
                tab === t.id ? "bg-accent-soft text-accent-ink font-medium" : "text-muted hover:text-ink hover:bg-panel-2",
              )}
            >
              <t.icon size={15} /> {t.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0">
          {tab === "general" && (
            <>
      <section className="card p-5 mb-5">
        <h2 className="font-semibold mb-3">Claude connection</h2>
        {s?.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-success/15 text-success grid place-items-center">
              <KeyRound size={16} />
            </span>
            <div className="flex-1">
              {s.authMode === "claude_account" ? (
                <>
                  <div className="text-sm font-medium">Claude account{s.account?.subscriptionType ? ` · ${s.account.subscriptionType} plan` : ""}</div>
                  <div className="text-xs text-muted">{[s.account?.email, s.account?.organization, s.claudeToken ? "sign-in token stored securely in Luma" : "signed in on this computer"].filter(Boolean).join(" · ")}</div>
                </>
              ) : (
                <>
                  <div className="text-sm font-medium">API key</div>
                  <div className="text-xs text-muted font-mono">{s.apiKeyHint}</div>
                </>
              )}
            </div>
            <Link href="/setup" className="btn btn-sm">Change</Link>
            <button className="btn btn-sm btn-danger" onClick={disconnect}>
              <Trash2 size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <Link href="/setup" className="btn btn-primary">Connect your Claude account</Link>
        )}
      </section>

      <section className="card p-5 mb-5">
        <h2 className="font-semibold">Default model</h2>
        <p className="text-sm text-muted mb-3">Used by every agent that doesn't have its own model set.</p>
        <select
          className="input max-w-sm"
          value={s?.defaultModel ?? ""}
          disabled={!models.length}
          onChange={(e) => save({ defaultModel: e.target.value })}
        >
          {!models.length && <option>{s?.defaultModel || "Connect to load models"}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.id})
            </option>
          ))}
        </select>
      </section>

            </>
          )}
          {tab === "usage" && (
            <>
      <section className="card p-5 mb-5">
        <h2 className="font-semibold">Usage</h2>
        <p className="text-sm text-muted mb-4">
          {s?.authMode === "claude_account"
            ? "Runs on your Claude account count toward your plan's usage limits, so they show tokens but no cost."
            : "Estimated from token counts; your Anthropic bill is the source of truth."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
          <Stat label="This month" value={fmtUsd(usage?.month.cost ?? 0)} sub={`${fmtTokens(usage?.month.tokens ?? 0)} tokens`} />
          <Stat label="All time" value={fmtUsd(usage?.total.cost ?? 0)} sub={`${fmtTokens(usage?.total.tokens ?? 0)} tokens`} />
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="text-xs text-muted">Monthly limit (USD)</div>
            <div className="flex gap-1.5 mt-1">
              <input className="input !py-1 !text-sm" inputMode="decimal" placeholder="None" value={limit} onChange={(e) => setLimit(e.target.value)} />
              <button className="btn btn-sm" onClick={() => save({ monthlyLimitUsd: limit ? Number(limit) : null })}>Set</button>
            </div>
          </div>
        </div>
        {overLimit > 0 && (
          <div className="mb-5">
            <div className="h-2 rounded-full bg-panel-2 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, overLimit * 100)}%`, background: overLimit >= 1 ? "var(--danger)" : "var(--accent)" }} />
            </div>
            <p className="text-xs text-muted mt-1">{Math.round(overLimit * 100)}% of your monthly limit used{overLimit >= 1 ? " — new agent runs are blocked." : "."}</p>
          </div>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="font-medium pb-2">Workspace</th>
              <th className="font-medium pb-2 text-right">Tokens</th>
              <th className="font-medium pb-2 text-right">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((w) => (
              <tr key={w.id} className="border-t">
                <td className="py-2">{w.icon} {w.name}</td>
                <td className="py-2 text-right tabular-nums">{fmtTokens(usage?.byWorkspace[w.id]?.tokens ?? 0)}</td>
                <td className="py-2 text-right tabular-nums">{fmtUsd(usage?.byWorkspace[w.id]?.cost ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
            </>
          )}
          {tab === "profile" && <ProfileSettings />}
          {tab === "team" && <TeamSettings />}
          {tab === "email" && <EmailSettings />}
          {tab === "integrations" && (
            <>
              <GitHubSettings connected={s?.github ?? null} onChange={load} />
      <section className="card p-5 mb-5">
        <h2 className="font-semibold">Deploy accounts</h2>
        <p className="text-sm text-muted mb-3">
          Connect a hosting account to publish workspaces with one click from each workspace's Ship page. Tokens are encrypted on this computer.
          GitHub Pages uses the GitHub connection above.
        </p>
        <div className="space-y-2">
          {(
            [
              ["netlify", "Netlify", "https://app.netlify.com/user/applications#personal-access-tokens"],
              ["vercel", "Vercel", "https://vercel.com/account/tokens"],
            ] as const
          ).map(([id, label, href]) => (
            <DeployAccount key={id} id={id} label={label} href={href} connected={Boolean(s?.deployAccounts?.[id])} onChange={load} />
          ))}
        </div>
      </section>
            </>
          )}
          {tab === "system" && <SystemSettings />}
      {msg && <p className="text-sm text-success">{msg}</p>}
      <ErrorNote message={error} />
        </div>
      </div>
    </div>
  );
}

function DeployAccount({ id, label, href, connected, onChange }: { id: "netlify" | "vercel"; label: string; href: string; connected: boolean; onChange: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const save = async (t: string | null) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ account?: string }>("/api/settings", { method: "POST", json: { deployToken: { provider: id, token: t } } });
      setAccount(r.account ?? null);
      setToken("");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{label}</span>
        {connected ? <span className="chip !bg-success/15 !text-success">Connected{account ? ` · ${account}` : ""}</span> : <span className="chip">Not connected</span>}
        {connected && <button className="btn btn-sm btn-ghost ml-auto" disabled={busy} onClick={() => save(null)}>Disconnect</button>}
      </div>
      {!connected && (
        <div className="flex gap-2 mt-2">
          <input className="input !py-1.5 !text-sm font-mono" type="password" placeholder={`${label} access token`} value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn btn-sm btn-primary" disabled={busy || !token.trim()} onClick={() => save(token)}>{busy ? "Checking…" : "Connect"}</button>
          <a className="btn btn-sm btn-ghost shrink-0" href={href} target="_blank" rel="noreferrer">Get a token</a>
        </div>
      )}
      {err && <p className="text-xs text-danger mt-1.5">{err}</p>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-panel-2 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}
