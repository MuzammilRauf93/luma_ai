"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X } from "lucide-react";

/**
 * First-run onboarding tour (Phase 3). Walks through the workspace screens, spotlighting
 * elements marked with data-tour="…". Starts automatically on the first workspace visit
 * and again from "Take the tour" in the sidebar (window event `luma:tour`).
 */

interface Step {
  /** Workspace sub-route: "" = overview. */
  route: "" | "board" | "agents" | "memory" | "editor" | "ship";
  target?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    route: "",
    title: "Welcome to Luma 👋",
    body: "Luma is a team of AI agents that plan, design, build and test your project while you stay in charge. This 1-minute tour shows you around.",
  },
  {
    route: "",
    target: "goal",
    title: "Start with a goal",
    body: "Describe what you want in your own words. Maya, your Project Manager, splits it into tickets and assigns them to the right teammates.",
  },
  {
    route: "",
    target: "autopilot",
    title: "Autopilot",
    body: "Agents pass work to each other and start planned tickets on their own, up to your limit of agents working at once. Pause it any time.",
  },
  {
    route: "",
    target: "ws-settings",
    title: "You decide how much to approve",
    body: "In Workspace settings choose an approval mode: approve every step, review finished work (default), or fully autonomous. Loop protection is always on.",
  },
  {
    route: "board",
    target: "board",
    title: "The ticket board",
    body: "Every piece of work is a ticket. Open one to follow the agent live, answer its questions, see exactly which files it changed and undo them.",
  },
  {
    route: "agents",
    target: "agents",
    title: "Your team",
    body: "Edit what each agent does and is allowed to do. Add any of the 9 built-in specialists from the library, or create your own with “Draft with Claude”.",
  },
  {
    route: "memory",
    target: "memory",
    title: "Team memory",
    body: "Agents save decisions here (colours, structure, conventions) and read them before every ticket. Add your own preferences, or use “Remember” on any comment.",
  },
  {
    route: "editor",
    target: "editor",
    title: "Code & preview",
    body: "See the project live, edit any file yourself, and use History to view a diff of every change or roll it back. Open the Terminal to see the checks agents run (tests, analyzers) or run one yourself.",
  },
  {
    route: "ship",
    target: "ship",
    title: "Ship it",
    body: "Turn on GitHub sync to get a commit for every agent run, push to GitHub or open a pull request, and deploy to Netlify, Vercel or GitHub Pages with one click.",
  },
  {
    route: "",
    title: "You're all set",
    body: "Describe your first goal to get the team going. You can replay this tour from the sidebar whenever you like.",
  },
];

const DONE_KEY = "luma-tour-done";
export const START_TOUR = "luma:tour";

function seen() {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag every visit
  }
}
function markSeen() {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {}
}

export function Tour({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!seen()) setStep(0);
    const start = () => setStep(0);
    window.addEventListener(START_TOUR, start);
    return () => window.removeEventListener(START_TOUR, start);
  }, []);

  const s = step === null ? null : STEPS[step];
  const base = `/w/${workspaceId}`;
  const wanted = s ? (s.route ? `${base}/${s.route}` : base) : null;

  // Navigate to the step's screen.
  useEffect(() => {
    if (wanted && pathname !== wanted) router.push(wanted);
  }, [wanted, pathname, router]);

  // Find and track the spotlight target.
  useLayoutEffect(() => {
    setRect(null);
    if (!s?.target || pathname !== wanted) return;
    let alive = true;
    let tries = 0;
    let el: Element | null = null;
    const measure = () => el && alive && setRect(el.getBoundingClientRect());
    const find = () => {
      el = document.querySelector(`[data-tour="${s.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        setTimeout(measure, 250);
      } else if (tries++ < 30 && alive) setTimeout(find, 100);
    };
    find();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      alive = false;
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [s, pathname, wanted]);

  const close = useCallback(() => {
    markSeen();
    setStep(null);
  }, []);

  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setStep((x) => (x === null ? x : Math.min(STEPS.length - 1, x + 1)));
      if (e.key === "ArrowLeft") setStep((x) => (x === null ? x : Math.max(0, x - 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, close]);

  if (step === null || !s) return null;
  const last = step === STEPS.length - 1;
  const pad = 8;

  // Popover position: below the target if there's room, otherwise above; centred when no target.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const W = Math.min(360, vw - 32);
  let pos: React.CSSProperties = { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (rect) {
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - W / 2), vw - W - 16);
    const below = rect.bottom + pad + 12;
    pos = below + 220 < vh ? { left, top: below } : { left, top: Math.max(16, rect.top - pad - 12 - 220) };
    if (rect.height > vh * 0.6) pos = { left, top: Math.min(vh - 236, Math.max(16, rect.top + 24)) };
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label="Product tour">
      {rect ? (
        <div
          className="fixed rounded-xl transition-all duration-300 pointer-events-none"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: Math.min(rect.height + pad * 2, vh - rect.top + pad),
            boxShadow: "0 0 0 9999px rgba(15, 10, 30, 0.55), 0 0 0 2px var(--accent)",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-[rgba(15,10,30,0.55)]" />
      )}
      <div className="fixed card p-4 shadow-2xl" style={{ ...pos, width: W }}>
        <div className="flex items-start gap-2">
          <h3 className="font-semibold flex-1">{s.title}</h3>
          <button className="btn btn-ghost btn-sm !px-1.5 -mt-1 -mr-1" onClick={close} aria-label="Close tour">
            <X size={14} />
          </button>
        </div>
        <p className="text-sm text-ink/80 mt-1.5">{s.body}</p>
        <div className="flex items-center gap-2 mt-4">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: i === step ? "var(--accent)" : "var(--border)" }} />
            ))}
          </div>
          <div className="ml-auto flex gap-1.5">
            {step > 0 ? (
              <button className="btn btn-sm" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={12} /> Back
              </button>
            ) : (
              <button className="btn btn-sm btn-ghost" onClick={close}>Skip</button>
            )}
            <button className="btn btn-sm btn-primary" onClick={() => (last ? close() : setStep(step + 1))}>
              {last ? "Get started" : <>Next <ArrowRight size={12} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
