"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Check, ExternalLink, KeyRound, Lock, Sparkles, UserRound, Terminal } from "lucide-react";
import { api } from "@/lib/client";
import { ErrorNote } from "@/components/ui";

const KEY_STEPS = [
  { title: "Open the Claude Console", body: "Sign in at platform.claude.com." },
  { title: "Go to API Keys", body: "In the left menu choose Settings → API Keys." },
  { title: "Create a key", body: "Click “Create Key”, name it “Luma AI”, and copy it. It starts with sk-ant-." },
  { title: "Paste it below", body: "Luma encrypts it on this computer. You won't see it in full again." },
];

const LOGIN_STEPS = [
  { title: "Already use Claude Code here?", body: "Leave the token empty and click Connect: Luma uses that login." },
  { title: "Otherwise, create a subscription token once", body: "On any computer with Claude Code, run the command below and sign in with your Claude account. It prints a long-lived token." },
  { title: "Paste it above", body: "Luma encrypts it and uses it for every agent run, on this computer or a server." },
];

type Mode = "claude_account" | "api_key";

export default function SetupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("claude_account");
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const connect = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ account?: { email?: string; subscriptionType?: string } }>("/api/settings", {
        method: "POST",
        json: mode === "claude_account" ? { authMode: "claude_account", claudeToken: token.trim() || undefined } : { apiKey: key },
      });
      setDone(
        mode === "claude_account"
          ? `Signed in as ${res.account?.email ?? "your Claude account"}${res.account?.subscriptionType ? ` (${res.account.subscriptionType} plan)` : ""}.`
          : "Your API key works.",
      );
      setTimeout(() => router.push("/"), 1400);
    } catch (err) {
      setError((err as Error).message);
      setShowHelp(true);
    } finally {
      setBusy(false);
    }
  };

  const steps = mode === "claude_account" ? LOGIN_STEPS : KEY_STEPS;

  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "radial-gradient(1200px 600px at 50% -10%, var(--accent-soft), var(--bg))" }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <span className="w-9 h-9 rounded-xl grid place-items-center text-white font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>
            L
          </span>
          <span className="text-xl font-semibold tracking-tight">Luma AI</span>
        </div>
        <div className="card p-6">
          <div className="w-10 h-10 rounded-xl bg-accent-soft text-accent-ink grid place-items-center mb-3">
            {done ? <Check size={20} /> : <Sparkles size={20} />}
          </div>
          <h1 className="text-lg font-semibold">{done ? "You're connected!" : "Connect Claude"}</h1>
          <p className="text-sm text-muted mt-1">{done ?? "Your agents run on Claude. Choose how Luma should connect."}</p>

          {!done && (
            <>
              <div className="grid grid-cols-2 gap-2 mt-5">
                {([
                  ["claude_account", UserRound, "My Claude account", "Pro, Max, Team or Enterprise"],
                  ["api_key", KeyRound, "API key", "Pay per use via the Console"],
                ] as const).map(([m, Icon, title, sub]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m);
                      setError(null);
                    }}
                    className={clsx(
                      "text-left rounded-xl border p-3 transition",
                      mode === m ? "border-accent ring-3 ring-accent-soft" : "hover:bg-panel-2",
                    )}
                  >
                    <Icon size={16} className="text-accent" />
                    <div className="text-sm font-medium mt-1.5">{title}</div>
                    <div className="text-xs text-muted">{sub}</div>
                  </button>
                ))}
              </div>

              {mode === "claude_account" ? (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-muted">
                    Agents use your Claude plan, and their work counts toward its normal usage limits. No API key needed. If Claude Code is already signed in on this computer, just connect.
                  </p>
                  <div>
                    <label className="label" htmlFor="ctoken">Subscription token <span className="font-normal text-muted">(optional: for servers, or if this computer isn't signed in)</span></label>
                    <input id="ctoken" type="password" className="input font-mono" placeholder="sk-ant-oat01-…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
                  </div>
                  <ErrorNote message={error} />
                  <button className="btn btn-primary w-full !h-10" onClick={() => connect()} disabled={busy}>
                    {busy ? "Checking your login…" : "Connect my Claude account"}
                  </button>
                </div>
              ) : (
                <form onSubmit={connect} className="mt-4 space-y-3">
                  <label className="label" htmlFor="key">Anthropic API key</label>
                  <div className="relative">
                    <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      id="key"
                      type="password"
                      className="input !pl-9 font-mono"
                      placeholder="sk-ant-..."
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </div>
                  <ErrorNote message={error} />
                  <button className="btn btn-primary w-full !h-10" disabled={busy || !key.trim()}>
                    {busy ? "Checking your key…" : "Connect"}
                  </button>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <Lock size={12} /> Encrypted with AES-256 and stored only on this machine.
                  </p>
                </form>
              )}

              <div className="mt-5 border-t pt-4">
                <button type="button" className="text-sm font-medium text-accent-ink" onClick={() => setShowHelp((s) => !s)}>
                  {showHelp ? "Hide steps" : mode === "claude_account" ? "How do I sign in?" : "Where do I find my key?"}
                </button>
                {showHelp && (
                  <ol className="mt-3 space-y-3">
                    {steps.map((s, i) => (
                      <li key={s.title} className="flex gap-3">
                        <span className="w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent-ink text-xs font-bold grid place-items-center">
                          {i + 1}
                        </span>
                        <div>
                          <div className="text-sm font-medium">{s.title}</div>
                          <div className="text-xs text-muted">{s.body}</div>
                        </div>
                      </li>
                    ))}
                    {mode === "claude_account" ? (
                      <pre className="flex items-center gap-2 text-xs bg-panel-2 rounded-lg px-3 py-2 font-mono">
                        <Terminal size={12} /> claude setup-token
                      </pre>
                    ) : (
                      <a className="btn btn-sm mt-1" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
                        Open API Keys page <ExternalLink size={12} />
                      </a>
                    )}
                  </ol>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
