import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { currentUser, publicUser } from "@/lib/auth";
import { createInvite } from "@/lib/invites";

export const runtime = "nodejs";

/** Admin: everyone with an account, and open invites. */
export const GET = handle(async () => {
  const db = await read();
  return ok({
    users: db.users.map((u) => ({ ...publicUser(u), workspaces: db.workspaces.filter((w) => w.members?.some((m) => m.userId === u.id)).length })),
    invites: db.invites
      .filter((i) => new Date(i.expiresAt) > new Date())
      .map((i) => ({ email: i.email, role: i.role, workspaceId: i.workspaceId ?? null, expiresAt: i.expiresAt })),
  });
});

/** Admin: invite someone to Luma (optionally straight into a workspace). */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as { email: string; role?: "admin" | "member" };
  return ok(await createInvite({ email: body.email, role: body.role === "admin" ? "admin" : "member", createdBy: currentUser()!.id, origin: new URL(req.url).origin }), 201);
});
