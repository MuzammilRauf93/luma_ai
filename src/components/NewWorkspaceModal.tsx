"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api } from "@/lib/client";
import { ErrorNote, Modal } from "./ui";

const ICONS = ["✨", "🚀", "🧁", "🏋️", "🛍️", "📚", "🎵", "🌿", "📸", "🏠", "🎨", "✍️", "🍽️", "📊", "📘", "🎟️", "📱"];

interface GalleryTemplate {
  key: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  platform: "web" | "flutter";
  starterGoal: string;
  fileCount: number;
  extraAgents: { name: string; role: string; avatar: string }[];
  preview: string | null;
}

const BASE_TEAM = (platform: string) =>
  platform === "flutter" ? "Project Manager, UI/UX Designer, Mobile Developer and QA Tester" : "Project Manager, UI/UX Designer, Frontend Developer and QA Tester";

export function NewWorkspaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<GalleryTemplate[]>([]);
  const [category, setCategory] = useState("All");
  const [picked, setPicked] = useState<GalleryTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("✨");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || templates.length) return;
    api<{ templates: GalleryTemplate[] }>("/api/templates").then((d) => setTemplates(d.templates)).catch((e) => setError((e as Error).message));
  }, [open, templates.length]);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setError(null);
    }
  }, [open]);

  const categories = useMemo(() => ["All", ...new Set(templates.map((t) => t.category))], [templates]);
  const shown = templates.filter((t) => category === "All" || t.category === category);

  const choose = (t: GalleryTemplate) => {
    setPicked(t);
    setIcon(t.icon);
    setGoal(t.starterGoal);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api<{ workspace: { id: string } }>("/api/workspaces", {
        method: "POST",
        json: { name, description, template: picked.key, icon },
      });
      if (goal.trim()) {
        // Hand the first goal to the Project Manager straight away (errors show on the ticket).
        await api(`/api/workspaces/${workspace.id}/goal`, { method: "POST", json: { goal } }).catch(() => undefined);
      }
      setName("");
      setDescription("");
      setGoal("");
      onCreated(workspace.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={picked ? `New workspace · ${picked.name}` : "Start a new workspace"} wide={picked ? true : "xl"}>
      {!picked ? (
        <div data-tour="templates">
          <p className="text-sm text-muted mb-3">Pick a starting point. Your agents can change everything later.</p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {categories.map((c) => (
              <button key={c} className={clsx("chip cursor-pointer", category === c && "!bg-accent-soft !text-accent-ink")} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <ErrorNote message={error} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shown.map((t) => (
              <button key={t.key} type="button" onClick={() => choose(t)} className="group text-left rounded-xl border overflow-hidden hover:border-accent/60 hover:shadow-md transition">
                <TemplateThumb t={t} />
                <div className="p-3">
                  <div className="flex items-center gap-1.5">
                    <span>{t.icon}</span>
                    <span className="font-medium text-sm">{t.name}</span>
                    <span className="chip !text-[10px] ml-auto">{t.category}</span>
                  </div>
                  <div className="text-xs text-muted mt-1 line-clamp-2">{t.description}</div>
                  {t.extraAgents.length > 0 && (
                    <div className="text-[11px] text-muted mt-1.5">+ {t.extraAgents.map((a) => `${a.avatar} ${a.name}`).join(", ")}</div>
                  )}
                </div>
              </button>
            ))}
            {!templates.length && !error && <p className="text-sm text-muted">Loading templates…</p>}
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setPicked(null)}>
            <ArrowLeft size={13} /> All templates
          </button>
          <div>
            <label className="label" htmlFor="ws-name">What are you building?</label>
            <div className="flex gap-2">
              <select className="input !w-16 text-center" value={icon} onChange={(e) => setIcon(e.target.value)} aria-label="Icon">
                {[...new Set([picked.icon, ...ICONS])].map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
              <input id="ws-name" className="input" placeholder="e.g. Bakery Website" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ws-desc">Short description (helps your agents)</label>
            <textarea id="ws-desc" className="input" rows={2} placeholder="A cosy neighbourhood bakery in Lahore that sells sourdough and custom cakes." value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="label flex items-center gap-1.5" htmlFor="ws-goal"><Sparkles size={13} className="text-accent" /> First goal for the team (optional)</label>
            <textarea id="ws-goal" className="input" rows={3} placeholder="Leave empty to explore first." value={goal} onChange={(e) => setGoal(e.target.value)} />
            {goal.includes("[") && <p className="text-xs text-warning mt-1">Replace the [bracketed] parts with your own details.</p>}
          </div>
          <p className="text-xs text-muted">
            {picked.platform === "flutter" && (
              <span className="block mb-1 text-ink/80">📱 Mobile apps run live in the iOS Simulator, so Luma needs to run on a Mac with Xcode and Flutter installed.</span>
            )}
            Your team: {BASE_TEAM(picked.platform)}
            {picked.extraAgents.length > 0 && `, plus ${picked.extraAgents.map((a) => `${a.name} (${a.role})`).join(", ")}`}. You can add more from the agent library.
          </p>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || !name.trim() || goal.includes("[")}>
              {busy ? "Creating…" : goal.trim() ? "Create & start planning" : "Create workspace"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** A live, scaled-down render of the template's index.html. */
function TemplateThumb({ t }: { t: GalleryTemplate }) {
  if (!t.preview)
    return (
      <div className="h-[150px] grid place-items-center text-5xl" style={{ background: "linear-gradient(135deg, var(--accent-soft), var(--panel-2))" }}>
        {t.icon}
      </div>
    );
  return (
    <div className="h-[150px] overflow-hidden relative bg-white border-b">
      <iframe
        title={`${t.name} preview`}
        srcDoc={t.preview}
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
        className="absolute top-0 left-0 origin-top-left pointer-events-none"
        style={{ width: 1280, height: 800, transform: "scale(0.25)" }}
      />
    </div>
  );
}
