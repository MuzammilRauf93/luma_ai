"use client";

import { confirmDialog, promptDialog, toast } from "@/components/Dialogs";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  FolderGit2 as Github,
  Loader2,
  Rocket,
  UploadCloud,
  DownloadCloud,
  XCircle,
  KeyRound,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { ErrorNote, PageHeader } from "@/components/ui";
import { api, timeAgo } from "@/lib/client";
import type { Deploy, DeployProvider, DeployTarget, GitSettings } from "@/lib/types";

type GitTools = { git: boolean; gh: boolean; ghAuthed: boolean; ghUser?: string; token?: string | null };
type GitStatus =
  | { repo: false; settings: GitSettings; tools: GitTools }
  | {
      repo: true;
      settings: GitSettings;
      tools: GitTools;
      branch: string;
      uncommitted: number;
      unpushed: number | null;
      commits: { sha: string; author: string; date: string; subject: string }[];
    };

interface DeployInfo {
  deploys: Deploy[];
  target: DeployTarget | null;
  providers: { id: DeployProvider; label: string; needs: string; ready: boolean }[];
}

export default function ShipPage() {
  const { workspace, subscribeLive } = useWorkspace();
  const [git, setGit] = useState<GitStatus | null>(null);
  const [dep, setDep] = useState<DeployInfo | null>(null);

  const loadGit = useCallback(async () => {
    if (workspace) setGit(await api<GitStatus>(`/api/workspaces/${workspace.id}/git`));
  }, [workspace]);
  const loadDeploys = useCallback(async () => {
    if (workspace) setDep(await api<DeployInfo>(`/api/workspaces/${workspace.id}/deploys`));
  }, [workspace]);

  useEffect(() => {
    loadGit().catch(() => undefined);
    loadDeploys().catch(() => undefined);
  }, [loadGit, loadDeploys]);

  useEffect(
    () =>
      subscribeLive((e) => {
        if (e.kind === "git") loadGit().catch(() => undefined);
        if (e.kind === "deploy")
          setDep((d) => {
            if (!d) return d;
            const i = d.deploys.findIndex((x) => x.id === e.deploy.id);
            const deploys = i >= 0 ? d.deploys.map((x) => (x.id === e.deploy.id ? e.deploy : x)) : [e.deploy, ...d.deploys];
            return { ...d, deploys };
          });
        if (e.kind === "deploy" && e.deploy.status !== "building") loadDeploys().catch(() => undefined);
      }),
    [subscribeLive, loadGit, loadDeploys],
  );

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8" data-tour="ship">
      <PageHeader title="Ship" subtitle="Save your project's history to GitHub and publish it to the web." />
      <div className="grid lg:grid-cols-2 gap-5 items-start">
        <GitCard status={git} reload={loadGit} />
        <DeployCard info={dep} reload={loadDeploys} />
        <SecretsCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- GitHub

function GitCard({ status, reload }: { status: GitStatus | null; reload: () => Promise<void> }) {
  const { workspace } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [prMode, setPrMode] = useState(false);
  const [remoteTab, setRemoteTab] = useState<"create" | "existing">("create");
  const [repoName, setRepoName] = useState("");
  const [priv, setPriv] = useState(true);
  const [existing, setExisting] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (workspace && !repoName) setRepoName(workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  }, [workspace, repoName]);

  if (!workspace) return null;
  const act = async (key: string, json: Record<string, unknown>, done?: (r: Record<string, unknown>) => string | null) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const r = await api<Record<string, unknown>>(`/api/workspaces/${workspace.id}/git`, { method: "POST", json });
      setNote(done?.(r) ?? null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const gh = status?.settings.githubRepo;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Github size={18} />
        <h2 className="font-semibold">GitHub</h2>
        {status?.tools.token ? (
          <span className="chip ml-auto">GitHub: {status.tools.token}</span>
        ) : status?.tools.ghAuthed ? (
          <span className="chip ml-auto">gh: {status.tools.ghUser ?? "signed in"}</span>
        ) : (
          <Link className="chip ml-auto hover:text-ink" href="/settings?tab=integrations">Connect GitHub</Link>
        )}
      </div>
      {!status ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !status.tools.git ? (
        <p className="text-sm text-muted">Git isn't installed on this computer. See <Link className="text-accent-ink underline" href="/settings?tab=system">Settings → System</Link> for what's missing and how to fix it.</p>
      ) : !status.repo ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Turn on version control and Luma saves a commit after every agent run, written as that agent, so you can see and share exactly what changed.</p>
          <div className="space-y-2">
            {[
              { v: false, t: "Commit to main", d: "Simplest. Every agent run lands on main." },
              { v: true, t: "Work branch + pull requests", d: "Agents commit to luma/agents; you review and merge a pull request on GitHub." },
            ].map((o) => (
              <label key={o.t} className={clsx("flex items-start gap-2.5 rounded-lg border p-2.5 cursor-pointer", prMode === o.v && "border-accent/60 bg-accent-soft/30")}>
                <input type="radio" className="mt-0.5 accent-[var(--accent)]" checked={prMode === o.v} onChange={() => setPrMode(o.v)} />
                <span>
                  <span className="block text-sm font-medium">{o.t}</span>
                  <span className="block text-xs text-muted">{o.d}</span>
                </span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy !== null} onClick={() => act("enable", { action: "enable", branch: prMode ? "luma/agents" : "main", baseBranch: "main" })}>
            {busy === "enable" ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />} Turn on version control
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="chip"><GitBranch size={11} /> {status.branch}</span>
            {status.settings.branch !== status.settings.baseBranch && <span className="text-xs text-muted">→ PRs into {status.settings.baseBranch}</span>}
            {gh ? (
              <a className="text-sm text-accent-ink hover:underline inline-flex items-center gap-1 ml-auto" href={`https://github.com/${gh}`} target="_blank" rel="noreferrer">
                {gh} <ExternalLink size={11} />
              </a>
            ) : status.settings.remoteUrl ? (
              <span className="text-xs text-muted ml-auto truncate max-w-[50%]">{status.settings.remoteUrl}</span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[var(--accent)]" checked={status.settings.autoCommit} onChange={(e) => act("s", { action: "settings", autoCommit: e.target.checked })} />
              Commit after each agent run
            </label>
            <label className={clsx("flex items-center gap-2 cursor-pointer", !status.settings.remoteUrl && "opacity-50")}>
              <input type="checkbox" className="accent-[var(--accent)]" disabled={!status.settings.remoteUrl} checked={status.settings.autoPush} onChange={(e) => act("s", { action: "settings", autoPush: e.target.checked })} />
              Push automatically
            </label>
          </div>

          {status.uncommitted > 0 && (
            <div className="rounded-lg border p-2.5">
              <div className="text-sm mb-1.5"><b>{status.uncommitted}</b> uncommitted change{status.uncommitted > 1 ? "s" : ""} (yours, from the editor)</div>
              <div className="flex gap-2">
                <input className="input !py-1 !text-sm" placeholder="What did you change?" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <button className="btn btn-sm" disabled={busy !== null} onClick={() => act("commit", { action: "commit", message: msg }, (r) => { setMsg(""); return String(r.message ?? ""); })}>
                  <GitCommitHorizontal size={12} /> Commit
                </button>
              </div>
            </div>
          )}

          {!status.settings.remoteUrl ? (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex gap-1 text-sm">
                {(["create", "existing"] as const).map((t) => (
                  <button key={t} className={clsx("chip cursor-pointer", remoteTab === t && "!bg-accent-soft !text-accent-ink")} onClick={() => setRemoteTab(t)}>
                    {t === "create" ? "Create a new repo" : "Use an existing repo"}
                  </button>
                ))}
              </div>
              {remoteTab === "create" ? (
                <>
                  {!status.tools.token && (!status.tools.gh || !status.tools.ghAuthed) ? (
                    <p className="text-xs text-warning">
                      Connect your GitHub account in <Link className="underline" href="/settings?tab=integrations">Settings → Integrations</Link> first.
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <input className="input !py-1.5 !text-sm" value={repoName} onChange={(e) => setRepoName(e.target.value)} placeholder="repo-name" />
                    <label className="flex items-center gap-1.5 text-sm shrink-0"><input type="checkbox" className="accent-[var(--accent)]" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private</label>
                  </div>
                  <button className="btn btn-sm btn-primary" disabled={busy !== null || !repoName.trim()} onClick={() => act("connect", { action: "connect", create: { name: repoName, private: priv } }, () => "Repository created and pushed.")}>
                    {busy === "connect" ? <Loader2 size={12} className="animate-spin" /> : <Github size={12} />} Create on GitHub & push
                  </button>
                </>
              ) : (
                <>
                  <input className="input !py-1.5 !text-sm" value={existing} onChange={(e) => setExisting(e.target.value)} placeholder="owner/repo or https://github.com/owner/repo.git" />
                  <p className="text-xs text-muted">Use an empty repository: Luma pushes its history to it.</p>
                  <button className="btn btn-sm btn-primary" disabled={busy !== null || !existing.trim()} onClick={() => act("connect", { action: "connect", repo: existing }, () => "Connected and pushed.")}>
                    {busy === "connect" ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />} Connect & push
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" disabled={busy !== null} onClick={() => act("push", { action: "push" }, () => "Pushed to GitHub.")}>
                {busy === "push" ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />} Push{status.unpushed ? ` (${status.unpushed})` : ""}
              </button>
              <button className="btn btn-sm" disabled={busy !== null} onClick={() => act("pull", { action: "pull" }, (r) => String(r.message ?? "Pulled."))}>
                {busy === "pull" ? <Loader2 size={12} className="animate-spin" /> : <DownloadCloud size={12} />} Pull
              </button>
              {status.settings.branch !== status.settings.baseBranch && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null}
                  onClick={() => act("pr", { action: "pr" }, (r) => { if (r.url) window.open(String(r.url), "_blank"); return r.created ? "Pull request opened." : "Pull request is already open."; })}
                >
                  {busy === "pr" ? <Loader2 size={12} className="animate-spin" /> : <GitPullRequest size={12} />} Open pull request
                </button>
              )}
              {status.settings.lastPushAt && <span className="text-xs text-muted self-center">Last push {timeAgo(status.settings.lastPushAt)}</span>}
            </div>
          )}
          {status.settings.lastError && !error && <p className="text-xs text-warning flex gap-1.5"><AlertTriangle size={12} className="mt-0.5" /> {status.settings.lastError}</p>}
          {note && <p className="text-xs text-success">{note}</p>}
          <ErrorNote message={error} />

          <div>
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">History</h3>
            <ol className="space-y-0.5 max-h-80 overflow-y-auto scroll-thin">
              {status.commits.map((c) => (
                <li key={c.sha} className="flex items-center gap-2 text-sm py-1">
                  {gh ? (
                    <a className="font-mono text-xs text-accent-ink hover:underline" href={`https://github.com/${gh}/commit/${c.sha}`} target="_blank" rel="noreferrer">{c.sha}</a>
                  ) : (
                    <span className="font-mono text-xs text-muted">{c.sha}</span>
                  )}
                  <span className="truncate flex-1">{c.subject}</span>
                  <span className="text-xs text-muted shrink-0">{c.author.replace(/ \(Luma .*\)$/, "")} · {timeAgo(c.date)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {!status?.repo && <ErrorNote message={error} />}
    </section>
  );
}

// ---------------------------------------------------------------- Deploy

function DeployCard({ info, reload }: { info: DeployInfo | null; reload: () => Promise<void> }) {
  const { workspace } = useWorkspace();
  const [provider, setProvider] = useState<DeployProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!workspace) return null;
  const chosen = provider ?? info?.target?.provider ?? info?.providers.find((p) => p.ready && p.id !== "zip")?.id ?? "zip";
  const building = info?.deploys.find((d) => d.status === "building");
  const live = info?.deploys.find((d) => d.status === "ready" && d.provider !== "zip");

  const deploy = async () => {
    setError(null);
    try {
      await api(`/api/workspaces/${workspace.id}/deploys`, { method: "POST", json: { provider: chosen } });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <Rocket size={18} />
        <h2 className="font-semibold">Deploy</h2>
      </div>
      <p className="text-sm text-muted mb-3">
        Publish {workspace.platform === "flutter" ? "a web build of your app (flutter build web)" : "your site"} and get a link you can share.
      </p>
      {live?.url && (
        <a href={live.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 mb-4 hover:bg-success/15">
          <CheckCircle2 size={16} className="text-success" />
          <span className="min-w-0">
            <span className="block text-sm font-medium truncate">{live.url.replace(/^https?:\/\//, "")}</span>
            <span className="block text-xs text-muted">Live on {label(live.provider)} · {timeAgo(live.finishedAt ?? live.createdAt)}</span>
          </span>
          <ExternalLink size={13} className="ml-auto text-muted" />
        </a>
      )}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {info?.providers.map((p) => (
          <button
            key={p.id}
            onClick={() => setProvider(p.id)}
            className={clsx("text-left rounded-lg border p-2.5 transition", chosen === p.id ? "border-accent/60 bg-accent-soft/30" : "hover:bg-panel-2", !p.ready && "opacity-70")}
          >
            <div className="text-sm font-medium flex items-center gap-1.5">
              {p.id === "zip" ? <Download size={13} /> : p.id === "github_pages" ? <Github size={13} /> : <Rocket size={13} />} {p.label}
            </div>
            <div className="text-[11px] text-muted mt-0.5">{p.ready ? (info.target?.provider === p.id ? `Redeploys ${info.target.siteName ?? "your site"}` : "Ready") : p.needs}</div>
          </button>
        ))}
      </div>
      {info && !info.providers.find((p) => p.id === chosen)?.ready ? (
        chosen === "github_pages" ? (
          <p className="text-xs text-muted">Connect a GitHub repository on the left first.</p>
        ) : (
          <Link href="/settings" className="btn btn-sm">Connect {label(chosen)} in Settings</Link>
        )
      ) : (
        <button className="btn btn-primary" onClick={deploy} disabled={Boolean(building)}>
          {building ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />} {building ? "Deploying…" : chosen === "zip" ? "Export ZIP" : `Deploy to ${label(chosen)}`}
        </button>
      )}
      <ErrorNote message={error} />

      {info && info.deploys.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Deploys</h3>
          <ol className="space-y-2">
            {info.deploys.map((d) => (
              <li key={d.id} className="rounded-lg border p-2.5 text-sm">
                <div className="flex items-center gap-2">
                  {d.status === "building" ? <Loader2 size={13} className="animate-spin text-accent" /> : d.status === "ready" ? <CheckCircle2 size={13} className="text-success" /> : <XCircle size={13} className="text-danger" />}
                  <span className="font-medium">{label(d.provider)}</span>
                  {d.commit && <span className="font-mono text-xs text-muted">{d.commit}</span>}
                  <span className="text-xs text-muted ml-auto">{d.fileCount ? `${d.fileCount} files · ` : ""}{timeAgo(d.createdAt)}</span>
                </div>
                {d.status === "ready" && d.url && (
                  <a className="text-xs text-accent-ink hover:underline inline-flex items-center gap-1 mt-1" href={d.url} target="_blank" rel="noreferrer">
                    {d.provider === "zip" ? <><Download size={11} /> Download ZIP</> : <>{d.url.replace(/^https?:\/\//, "")} <ExternalLink size={10} /></>}
                  </a>
                )}
                {d.error && <p className="text-xs text-danger mt-1 whitespace-pre-wrap">{d.error}</p>}
                {d.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {d.warnings.map((w, i) => (
                      <li key={i} className={clsx("text-xs", w.startsWith("…") ? "text-muted" : "text-warning")}>{w.startsWith("…") ? w.slice(1) : `⚠ ${w}`}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Secrets

function SecretsCard() {
  const { workspace } = useWorkspace();
  const [list, setList] = useState<{ name: string; hint: string; updatedAt: string }[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (workspace) setList((await api<{ secrets: typeof list }>(`/api/workspaces/${workspace.id}/secrets`)).secrets);
  }, [workspace]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);
  if (!workspace) return null;
  const save = async () => {
    setError(null);
    try {
      await api(`/api/workspaces/${workspace.id}/secrets`, { method: "PUT", json: { name, value } });
      setName("");
      setValue("");
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (n: string) => {
    if (!(await confirmDialog({ title: `Delete the secret ${n}?`, body: "Commands and builds won't get it any more.", confirmLabel: "Delete", danger: true }))) return;
    await api(`/api/workspaces/${workspace.id}/secrets?name=${encodeURIComponent(n)}`, { method: "DELETE" });
    load();
  };
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={18} />
        <h2 className="font-semibold">Secrets</h2>
      </div>
      <p className="text-sm text-muted mb-3">
        API keys and other private values your app needs. They're encrypted on this computer, passed to commands as environment variables
        {workspace.platform === "flutter" ? " and to web builds as --dart-define" : ""}, and hidden from agents: they only see the names, and values are blanked out of any output.
      </p>
      {list.length > 0 && (
        <ul className="divide-y rounded-lg border mb-3">
          {list.map((s) => (
            <li key={s.name} className="flex items-center gap-2 px-3 py-2 text-sm">
              <code className="font-mono text-[12.5px]">{s.name}</code>
              <span className="text-xs text-muted font-mono">{s.hint}</span>
              <span className="text-xs text-muted ml-auto">{timeAgo(s.updatedAt)}</span>
              <button className="btn btn-ghost btn-sm !px-1.5" onClick={() => { setName(s.name); setValue(""); }} title="Replace value"><KeyRound size={12} /></button>
              <button className="btn btn-ghost btn-sm btn-danger !px-1.5" onClick={() => remove(s.name)} aria-label={`Delete ${s.name}`}><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <input className="input !py-1.5 !text-sm font-mono !w-44" placeholder="STRIPE_KEY" value={name} onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} />
        <input className="input !py-1.5 !text-sm font-mono flex-1 min-w-[160px]" type="password" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        <button className="btn btn-sm btn-primary" disabled={!name || !value} onClick={save}>Save</button>
      </div>
      <ErrorNote message={error} />
    </section>
  );
}

function label(p: DeployProvider) {
  return { netlify: "Netlify", vercel: "Vercel", github_pages: "GitHub Pages", zip: "ZIP" }[p];
}
