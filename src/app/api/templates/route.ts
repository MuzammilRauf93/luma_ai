import { handle, ok } from "@/lib/http";
import { TEMPLATES, templatePreview } from "@/lib/templates";
import { getPreset } from "@/lib/presets";

export const runtime = "nodejs";

/** Template gallery: metadata + an inlined HTML preview (files stay on the server). */
export const GET = handle(async () =>
  ok({
    templates: TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      icon: t.icon,
      description: t.description,
      category: t.category ?? "Other",
      platform: t.platform ?? "web",
      starterGoal: t.starterGoal ?? "",
      fileCount: Object.keys(t.files).length,
      extraAgents: (t.extraAgents ?? []).map((k) => getPreset(k)).filter(Boolean).map((p) => ({ name: p!.name, role: p!.role, avatar: p!.avatar })),
      preview: templatePreview(t),
    })),
  }),
);
