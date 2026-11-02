import { handle, ok, fail, type Ctx } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { createSession, createUser, currentUser, publicUser, sessionCookie, sha256 } from "@/lib/auth";

export const runtime = "nodejs";
type P = Ctx<{ token: string }>;

async function find(token: string) {
  const db = await read();
  const inv = db.invites.find((i) => i.id === sha256(token));
  if (!inv || new Date(inv.expiresAt) < new Date()) return null;
  return { inv, db };
}

/** What this invite is for (shown on the accept page). */
export const GET = handle(async (_req: Request, { params }: P) => {
  const { token } = await params;
  const f = await find(token);
  if (!f) return fail("This invite link has expired or was already used. Ask for a new one.", 404);
  const ws = f.inv.workspaceId ? f.db.workspaces.find((w) => w.id === f.inv.workspaceId) : null;
  const inviter = f.db.users.find((u) => u.id === f.inv.createdBy);
  return ok({
    email: f.inv.email,
    role: f.inv.role,
    workspace: ws ? { id: ws.id, name: ws.name, icon: ws.icon, role: f.inv.workspaceRole } : null,
    invitedBy: inviter?.name ?? null,
    hasAccount: f.db.users.some((u) => u.email === f.inv.email),
  });
});

/** Accept: create the account (or use the signed-in one) and join the workspace. */
export const POST = handle(async (req: Request, { params }: P) => {
  const { token } = await params;
  const f = await find(token);
  if (!f) return fail("This invite link has expired or was already used.", 404);
  const { name, password } = (await req.json().catch(() => ({}))) as { name?: string; password?: string };
  let user = f.db.users.find((u) => u.email === f.inv.email) ?? null;
  const me = currentUser();
  if (user && me?.id !== user.id) return fail("You already have an account: sign in with it first, then open this link again.", 409);
  if (!user) user = await createUser({ email: f.inv.email, name: name ?? "", password: password ?? "", role: f.inv.role });
  const uid = user.id;
  await mutate((db) => {
    if (f.inv.workspaceId) {
      const ws = db.workspaces.find((w) => w.id === f.inv.workspaceId);
      if (ws) ws.members = [...(ws.members ?? []).filter((m) => m.userId !== uid), { userId: uid, role: f.inv.workspaceRole ?? "editor" }];
    }
    db.invites = db.invites.filter((i) => i.id !== f.inv.id);
  });
  const res = ok({ user: publicUser(user), workspaceId: f.inv.workspaceId ?? null });
  if (me?.id !== uid) {
    const { token: t, expires } = await createSession(uid);
    res.headers.set("Set-Cookie", sessionCookie(t, expires, new URL(req.url).protocol === "https:"));
  }
  return res;
});
