"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, CircleAlert, Download, ExternalLink, FolderGit2, Loader2, Power, RefreshCw, Server, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import { ErrorNote } from "./ui";
import { confirmDialog, toast } from "./Dialogs";

// ---------------------------------------------------------------- GitHub (Integrations tab)

export function GitHubSettings({ connected, onChange }: { connected: string | null; onChange: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (t: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ account?: string }>("/api/settings", { method: "POST", json: { githubToken: t } });
      toast(t ? `GitHub connected as ${r.account}` : "GitHub disconnected");
      setToken("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5 mb-5">
      <div className="flex items-center gap-2 mb-1">
        <FolderGit2 size={17} />
        <h2 className="font-semibold">GitHub</h2>
        <span className={clsx("chip ml-auto", connected && "!bg-success/15 !text-success")}>{connected ? `Connected · ${connected}` : "Not connected"}</span>
      </div>
      <p className="text-sm text-muted mb-3">
        Lets Luma create repositories, push your agents' commits, open pull requests and publish to GitHub Pages — no terminal or GitHub CLI needed. The token is encrypted on this computer.
      </p>
      {connected ? (
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={async () => (await confirmDialog({ title: "Disconnect GitHub?", body: "Pushing, pull requests and Pages stop working until you connect again.", confirmLabel: "Disconnect", danger: true })) && save(null)}>
          Disconnect
        </button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input className="input !py-1.5 !text-sm font-mono flex-1 min-w-[220px]" type="password" placeholder="ghp_… or github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            <button className="btn btn-sm btn-primary" disabled={busy || !token.trim()} onClick={() => save(token)}>{busy ? "Checking…" : "Connect"}</button>
          </div>
          <ol className="text-xs text-muted mt-3 space-y-1 list-decimal pl-4">
            <li>
              Open{" "}
              <a className="text-accent-ink underline inline-flex items-center gap-0.5" href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Luma%20AI" target="_blank" rel="noreferrer">
                GitHub → New token <ExternalLink size={10} />
              </a>{" "}
              (scopes “repo” and “workflow” are pre-selected), make sure you're signed in to the account that owns your repositories.
            </li>
            <li>Choose an expiry, click Generate token, copy it and paste it here.</li>
          </ol>
        </>
      )}
      <ErrorNote message={error} />
    </section>
  );
}

// ---------------------------------------------------------------- System tab

interface Diag {
  luma: { version: string; node: string; platform: string; role: string; dataDir: string; uptimeSec: number };
  storage: { database: string; files: string; secret: string };
  packages: { name: string; range: string; purpose: string; installed: boolean }[];
  tools: { name: string; version: string | null; needed: string; help: string }[];
  sandbox: string;
  config: { key: string; label: string; secret: boolean; hint: string; value: string; active: string; pending: boolean }[];
  install: { pkg: string; status: "running" | "ok" | "failed"; output: string } | null;
}

export function SystemSettings() {
  const [d, setD] = useState<Diag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const load = useCallback(async () => {
    setD(await api<Diag>("/api/system"));
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);
  // Poll while an install runs.
  useEffect(() => {
    if (d?.install?.status !== "running") return;
    const t = setInterval(() => load().catch(() => undefined), 1500);
    return () => clearInterval(t);
  }, [d?.install?.status, load]);

  if (!d) return <div className="card p-5 text-sm text-muted">{error ?? "Checking this server…"}</div>;

  const act = async (json: Record<string, unknown>, done?: (r: Record<string, unknown>) => string) => {
    setError(null);
    try {
      const r = await api<Record<string, unknown>>("/api/system", { method: "POST", json });
      if (done) toast(done(r));
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

  const restart = async () => {
    if (!(await confirmDialog({ title: "Restart Luma now?", body: "Running agents are paused and resume automatically after the restart. The page reconnects in a few seconds.", confirmLabel: "Restart" }))) return;
    setRestarting(true);
    await act({ action: "restart" });
    const started = Date.now();
    const wait = async () => {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        await api("/api/auth/me");
        window.location.reload();
      } catch {
        if (Date.now() - started < 90_000) return wait();
        setRestarting(false);
        setError("Luma didn't come back yet. Check .luma/server.log on the server.");
      }
    };
    void wait();
  };

  const pending = d.config.some((c) => c.pending) || d.packages.some((p) => p.installed && p.name === "pg" && d.storage.database === "file" && d.config.find((c) => c.key === "LUMA_DATABASE_URL")?.value);

  return (
    <div className="space-y-5">
      {(pending || restarting) && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 flex items-center gap-3 text-sm">
          <CircleAlert size={16} className="text-warning shrink-0" />
          <span className="flex-1">{restarting ? "Restarting Luma…" : "Some changes take effect after a restart."}</span>
          <button className="btn btn-sm btn-primary" onClick={restart} disabled={restarting}>
            {restarting ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />} Restart Luma
          </button>
        </div>
      )}

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Server size={17} />
          <h2 className="font-semibold">This server</h2>
          <button className="btn btn-ghost btn-sm ml-auto" onClick={() => load()}><RefreshCw size={12} /> Re-check</button>
        </div>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ["Luma", `v${d.luma.version} · ${d.luma.role === "all" ? "single server" : `${d.luma.role} role`}`],
            ["Runtime", `Node ${d.luma.node} · ${d.luma.platform}`],
            ["Database", d.storage.database === "postgres" ? "Postgres" : "Built-in file database"],
            ["Workspace files", d.storage.files],
            ["Encryption secret", d.storage.secret],
            ["Command sandbox", d.sandbox === "sandbox-exec" ? "macOS sandbox" : d.sandbox === "bwrap" ? "bubblewrap" : "allowlist only"],
            ["Data folder", d.luma.dataDir],
            ["Up for", d.luma.uptimeSec < 3600 ? `${Math.round(d.luma.uptimeSec / 60)} min` : `${(d.luma.uptimeSec / 3600).toFixed(1)} h`],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2 min-w-0">
              <dt className="text-muted w-36 shrink-0">{k}</dt>
              <dd className="truncate" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-1">Optional components</h2>
        <p className="text-sm text-muted mb-3">Install extra capabilities with one click. Luma runs the installer on this server.</p>
        <ul className="divide-y rounded-lg border">
          {d.packages.map((p) => (
            <li key={p.name} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              {p.installed ? <CheckCircle2 size={16} className="text-success shrink-0" /> : <Download size={16} className="text-muted shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="font-medium font-mono text-[13px]">{p.name}</span>
                <span className="block text-xs text-muted">{p.purpose}</span>
              </span>
              {p.installed ? (
                <span className="chip !bg-success/15 !text-success">Installed</span>
              ) : (
                <button className="btn btn-sm" disabled={d.install?.status === "running"} onClick={() => act({ action: "install", pkg: p.name })}>
                  {d.install?.status === "running" && d.install.pkg === p.name ? <><Loader2 size={12} className="animate-spin" /> Installing…</> : "Install"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {d.install && d.install.status !== "running" && (
          <p className={clsx("text-xs mt-2", d.install.status === "ok" ? "text-success" : "text-danger")}>
            {d.install.status === "ok" ? `${d.install.pkg} installed.${d.install.pkg === "pg" ? " Restart Luma after setting the database URL below." : ""}` : `Installing ${d.install.pkg} failed:`}
          </p>
        )}
        {d.install && d.install.status !== "ok" && d.install.output && (
          <pre className="mt-2 max-h-40 overflow-auto scroll-thin rounded-lg bg-[#0f1117] text-[#c9d1d9] text-[11px] p-2.5 whitespace-pre-wrap">{d.install.output.slice(-2000)}</pre>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-semibold mb-1">Tools on this computer</h2>
        <p className="text-sm text-muted mb-3">Needed only for the features listed.</p>
        <ul className="space-y-2">
          {d.tools.map((t) => (
            <li key={t.name} className="flex gap-3 text-sm">
              {t.version ? <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> : <CircleAlert size={16} className="text-muted shrink-0 mt-0.5" />}
              <span className="min-w-0">
                <span className="font-medium">{t.name}</span> <span className="text-xs text-muted">{t.version ?? "not found"} · {t.needed}</span>
                {!t.version && t.help && <span className="block text-xs text-muted">{t.help}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={17} />
          <h2 className="font-semibold">Server configuration</h2>
        </div>
        <p className="text-sm text-muted mb-4">Saved to <code>.env.local</code> next to Luma and applied when Luma restarts. Leave a field empty to use the default.</p>
        <div className="space-y-4">
          {d.config.map((c) => (
            <div key={c.key}>
              <label className="label flex items-center gap-2" htmlFor={c.key}>
                {c.label} <code className="text-[10px] text-muted font-normal">{c.key}</code>
                {c.pending && <span className="chip !text-[10px] !bg-warning/15 !text-warning">restart to apply</span>}
              </label>
              <div className="flex gap-2">
                <input
                  id={c.key}
                  className="input !py-1.5 !text-sm font-mono"
                  type={c.secret ? "password" : "text"}
                  placeholder={c.secret && c.value ? `${c.value} (saved)` : c.active || ""}
                  value={edits[c.key] ?? (c.secret ? "" : c.value)}
                  onChange={(e) => {
                    setEdits({ ...edits, [c.key]: e.target.value });
                    setDirty(true);
                  }}
                  autoComplete="off"
                />
                {c.key === "LUMA_DATABASE_URL" && (
                  <button className="btn btn-sm shrink-0" disabled={!edits[c.key]} onClick={() => act({ action: "testDb", url: edits[c.key] }, (r) => `Connected: ${String(r.server)}`)}>
                    Test
                  </button>
                )}
                {c.key === "LUMA_SECRET" && !c.active && d.storage.secret.startsWith("file") && (
                  <button className="btn btn-sm shrink-0" onClick={() => act({ action: "pinSecret" }, () => "Current secret saved to .env.local. Copy it to your other servers.")} title="Keep using the current key, written to .env.local so other servers can share it">
                    Use current
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted mt-1">{c.hint}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <button
            className="btn btn-primary btn-sm"
            disabled={!dirty}
            onClick={async () => {
              const values: Record<string, string> = {};
              for (const [k, v] of Object.entries(edits)) values[k] = v;
              const r = await act({ action: "config", values }, () => "Saved. Restart Luma to apply.");
              if (r) {
                setEdits({});
                setDirty(false);
              }
            }}
          >
            Save configuration
          </button>
          <button className="btn btn-sm" onClick={restart} disabled={restarting}><Power size={12} /> Restart Luma</button>
        </div>
      </section>
      <ErrorNote message={error} />
    </div>
  );
}
