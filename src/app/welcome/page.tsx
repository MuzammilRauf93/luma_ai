"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bot,
  Brain,
  CheckCircle2,
  GitBranch,
  KanbanSquare,
  Lock,
  Rocket,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  Zap,
} from "lucide-react";

/** Public landing page: what signed-out visitors see. */

const FEATURES = [
  { icon: Bot, title: "A full AI team", body: "Project manager, designer, developers, QA, researcher, writer and more — or build your own agents in a sentence." },
  { icon: Zap, title: "Autopilot with guardrails", body: "Agents hand work to each other and run in parallel, with approval modes, budgets and loop protection." },
  { icon: Brain, title: "Shared team memory", body: "Decisions, conventions and your preferences are remembered and followed by every agent, every time." },
  { icon: TerminalSquare, title: "Build, test, preview", body: "A real editor, live preview, sandboxed tests and analyzers, and a diff with undo for every change." },
  { icon: Rocket, title: "Ship from the same place", body: "Commit to GitHub, open pull requests and deploy to Netlify, Vercel or GitHub Pages in one click." },
  { icon: BarChart3, title: "Know how it's going", body: "Notifications when you're needed, plus insights on runs, reliability, speed and usage." },
];

const STEPS = [
  { n: "1", title: "Describe your goal", body: "In plain words. Pick a starter template if you like." },
  { n: "2", title: "Your team plans and builds", body: "Tickets, handoffs and checks happen on their own. You answer questions and review." },
  { n: "3", title: "Review and ship", body: "See exactly what changed, approve, and publish with a link to share." },
];

export default function WelcomePage() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    document.title = "Luma AI — your AI product team";
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setSignedIn(!!m?.user))
      .catch(() => undefined);
  }, []);
  const cta = signedIn ? { href: "/", label: "Open your workspaces" } : { href: "/login", label: "Sign in" };
  return (
    <div className="min-h-screen bg-bg text-ink overflow-x-hidden">
      <header className="sticky top-0 z-20 backdrop-blur bg-bg/80 border-b border-transparent">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center gap-3">
          <Link href="/welcome" className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>L</span>
            <span className="font-semibold tracking-tight text-lg">Luma AI</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-8 text-sm text-muted">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#security" className="hover:text-ink">Security</a>
          </nav>
          <div className="ml-auto flex gap-2">
            <Link href={cta.href} className="btn btn-primary">{cta.label}</Link>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(55% 60% at 50% 0%, var(--accent-soft), transparent 70%)" }} />
        <div className="max-w-6xl mx-auto px-4 md:px-8 pt-16 md:pt-24 pb-12 text-center">
          <span className="chip !bg-panel border"><Sparkles size={12} className="text-accent" /> Your AI product team, in one workspace</span>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] mt-5 max-w-3xl mx-auto">
            From idea to shipped, <span style={{ background: "linear-gradient(90deg,#7c3aed,#db2777)", WebkitBackgroundClip: "text", color: "transparent" }}>without the busywork</span>.
          </h1>
          <p className="text-lg text-muted mt-5 max-w-2xl mx-auto">
            Luma gives you a team of AI agents that plan, design, build, test and deploy your websites and apps — while you stay in charge of every decision.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-8">
            <Link href={cta.href} className="btn btn-primary !h-11 !px-5 !text-[15px]">{signedIn ? "Open your workspaces" : "Sign in to your workspace"} <ArrowRight size={16} /></Link>
            <a href="#how" className="btn !h-11 !px-5 !text-[15px]">See how it works</a>
          </div>
          <p className="text-xs text-muted mt-4">Got an invite? Open the link from your email to create your account.</p>
        </div>

        {/* Product preview (illustration built from the app's own styles) */}
        <div className="max-w-5xl mx-auto px-4 md:px-8 pb-16">
          <div className="card p-3 shadow-2xl" aria-hidden>
            <div className="flex items-center gap-1.5 px-2 pb-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" /><span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" /><span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-xs text-muted">Bakery website · Tickets</span>
              <span className="ml-auto chip !text-[10px]"><Zap size={10} className="text-accent" /> Autopilot on · 2/2 working</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {[
                { col: "To Do", dot: "#64748b", items: [["LUM-6", "Contact form validation", "💻"], ["LUM-7", "Write the About page", "✍️"]] },
                { col: "In Progress", dot: "#2563eb", items: [["LUM-4", "Menu page with prices", "💻"], ["LUM-5", "Colour palette & fonts", "🎨"]] },
                { col: "In Review", dot: "#7c3aed", items: [["LUM-3", "Hero section", "💻"]] },
                { col: "Done", dot: "#059669", items: [["LUM-1", "Plan the website", "🧭"], ["LUM-2", "Research competitors", "📚"]] },
              ].map((c) => (
                <div key={c.col} className="rounded-xl bg-panel-2/70 p-2">
                  <div className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold"><span className="w-2 h-2 rounded-full" style={{ background: c.dot }} />{c.col}</div>
                  <div className="space-y-2">
                    {c.items.map(([id, t, a]) => (
                      <div key={id} className="card !shadow-none p-2.5 text-left">
                        <div className="flex items-center text-[10px] text-muted font-mono">{id}{c.col === "In Progress" && <span className="ml-auto flex items-center gap-1 text-success font-sans font-medium"><span className="live-dot" /> working</span>}</div>
                        <div className="text-[12px] font-medium mt-1 leading-snug">{t}</div>
                        <div className="text-right mt-1.5 text-sm">{a}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-4 md:px-8 py-16">
        <h2 className="text-3xl font-semibold tracking-tight text-center">Everything in one box</h2>
        <p className="text-muted text-center mt-2 max-w-2xl mx-auto">Planning, building, testing, memory, publishing and team settings live inside Luma. No juggling tools.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <span className="w-10 h-10 rounded-xl grid place-items-center bg-accent-soft text-accent-ink"><f.icon size={19} /></span>
              <h3 className="font-semibold mt-3">{f.title}</h3>
              <p className="text-sm text-muted mt-1.5">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="bg-panel border-y">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-16">
          <h2 className="text-3xl font-semibold tracking-tight text-center">How it works</h2>
          <div className="grid md:grid-cols-3 gap-6 mt-10">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <span className="w-10 h-10 rounded-full grid place-items-center mx-auto text-white font-semibold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>{s.n}</span>
                <h3 className="font-semibold mt-3">{s.title}</h3>
                <p className="text-sm text-muted mt-1.5 max-w-xs mx-auto">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-10 text-sm text-muted">
            {[
              [KanbanSquare, "Tickets & board"],
              [Users, "Share with your team"],
              [GitBranch, "GitHub built in"],
              [CheckCircle2, "Approve before Done"],
            ].map(([Icon, t]) => {
              const I = Icon as typeof KanbanSquare;
              return <span key={t as string} className="flex items-center gap-1.5"><I size={15} className="text-accent" /> {t as string}</span>;
            })}
          </div>
        </div>
      </section>

      <section id="security" className="max-w-6xl mx-auto px-4 md:px-8 py-16 grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Private by design</h2>
          <p className="text-muted mt-3">Luma runs on your own computer or server. Your code, keys and data stay with you.</p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              "Accounts with owner, editor and viewer roles per workspace",
              "API keys, tokens and app secrets encrypted at rest; agents never see secret values",
              "Agent commands run in a sandbox, limited to the project",
              "Every change is versioned and can be undone",
            ].map((t) => (
              <li key={t} className="flex gap-2"><ShieldCheck size={16} className="text-success shrink-0 mt-0.5" /> {t}</li>
            ))}
          </ul>
        </div>
        <div className="card p-6 text-center">
          <Lock size={26} className="mx-auto text-accent" />
          <h3 className="font-semibold mt-3">Ready when you are</h3>
          <p className="text-sm text-muted mt-1.5">Sign in to pick up where your team left off.</p>
          <Link href={cta.href} className="btn btn-primary mt-4">{cta.label} <ArrowRight size={14} /></Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>© {new Date().getFullYear()} Luma AI</span>
          <span className="ml-auto">Built with Claude</span>
        </div>
      </footer>
    </div>
  );
}
