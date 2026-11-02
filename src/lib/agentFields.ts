import { PERMISSIONS, type Agent, type Permission } from "./types";

/** Normalise user-supplied agent fields (builder, library, API). */
export function sanitizeAgentFields(src: Partial<Agent>) {
  const valid = new Set(PERMISSIONS.map((p) => p.id));
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return {
    name: clip(src.name, 40) || "New agent",
    role: clip(src.role, 60) || "Assistant",
    avatar: clip(src.avatar, 8) || "🤖",
    color: /^#[0-9a-f]{6}$/i.test(src.color ?? "") ? src.color! : "#64748b",
    description: clip(src.description, 300),
    tone: clip(src.tone, 120) || "Friendly and clear",
    systemPrompt: clip(src.systemPrompt, 12_000) || "You are a helpful member of this team.",
    model: clip(src.model, 100),
    permissions: (Array.isArray(src.permissions) ? src.permissions : ["read_files"]).filter((p): p is Permission =>
      valid.has(p as Permission),
    ),
  };
}
