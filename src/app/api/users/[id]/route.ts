import { handle, ok, fail, type Ctx } from "@/lib/http";
import { mutate } from "@/lib/store";
import { currentUser, publicUser } from "@/lib/auth";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;

/** Admin: change someone's Luma role. */
export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const body = (await req.json()) as { role?: "admin" | "member"; resetLink?: boolean };
  if (body.resetLink) {
    const { read } = await import("@/lib/store");
    if (!(await read()).users.some((u) => u.id === id)) return fail("User not found", 404);
    const { createResetLink } = await import("@/lib/resets");
    return ok({ path: await createResetLink(id) });
  }
  const role = body.role;
  if (role !== "admin" && role !== "member") return fail("Role must be admin or member.");
  const user = await mutate((db) => {
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new Error("User not found");
    if (u.role === "admin" && role === "member" && db.users.filter((x) => x.role === "admin").length === 1) throw new Error("Luma needs at least one admin.");
    u.role = role;
    return u;
  });
  return ok({ user: publicUser(user) });
});

/** Admin: remove an account (their workspaces stay; sessions end). */
export const DELETE = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  if (id === currentUser()?.id) return fail("You can't remove your own account.");
  await mutate((db) => {
    const u = db.users.find((x) => x.id === id);
    if (!u) throw new Error("User not found");
    if (u.role === "admin" && db.users.filter((x) => x.role === "admin").length === 1) throw new Error("Luma needs at least one admin.");
    db.users = db.users.filter((x) => x.id !== id);
    db.sessions = db.sessions.filter((s) => s.userId !== id);
    for (const w of db.workspaces) if (w.members) w.members = w.members.filter((m) => m.userId !== id);
  });
  return ok({ deleted: true });
});
