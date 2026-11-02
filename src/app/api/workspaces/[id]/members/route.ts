import { handle, ok, fail, type Ctx } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { currentUser, normEmail } from "@/lib/auth";
import { createInvite } from "@/lib/invites";
import type { WorkspaceRole } from "@/lib/types";

export const runtime = "nodejs";
type P = Ctx<{ id: string }>;
const ROLES: WorkspaceRole[] = ["owner", "editor", "viewer"];

/** Who has access (members + pending invites). Owners manage; everyone with access can view. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === id);
  if (!ws) return fail("Workspace not found", 404);
  return ok({
    authEnabled: db.users.length > 0,
    members: (ws.members ?? [])
      .map((m) => {
        const u = db.users.find((x) => x.id === m.userId);
        return u ? { userId: u.id, name: u.name, email: u.email, role: m.role, lumaAdmin: u.role === "admin" } : null;
      })
      .filter(Boolean),
    admins: db.users.filter((u) => u.role === "admin" && !ws.members?.some((m) => m.userId === u.id)).map((u) => ({ userId: u.id, name: u.name, email: u.email })),
    invites: db.invites.filter((i) => i.workspaceId === id && new Date(i.expiresAt) > new Date()).map((i) => ({ email: i.email, role: i.workspaceRole, expiresAt: i.expiresAt })),
  });
});

/** Share: add an existing user, or create an invite link for a new one. */
export const POST = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const db = await read();
  if (!db.users.length) return fail("Turn on sign-in first (Settings → Team) to share workspaces.");
  const body = (await req.json()) as { email: string; role?: WorkspaceRole };
  const role = ROLES.includes(body.role as WorkspaceRole) ? (body.role as WorkspaceRole) : "editor";
  const email = normEmail(body.email);
  const user = db.users.find((u) => u.email === email);
  if (user) {
    await mutate((d) => {
      const ws = d.workspaces.find((w) => w.id === id)!;
      ws.members = [...(ws.members ?? []).filter((m) => m.userId !== user.id), { userId: user.id, role }];
    });
    return ok({ added: { name: user.name, email, role } }, 201);
  }
  const invite = await createInvite({ email, role: "member", workspaceId: id, workspaceRole: role, createdBy: currentUser()!.id });
  return ok({ invite }, 201);
});

export const PATCH = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const { userId, role } = (await req.json()) as { userId: string; role: WorkspaceRole };
  if (!ROLES.includes(role)) return fail("Unknown role.");
  await mutate((d) => {
    const ws = d.workspaces.find((w) => w.id === id)!;
    const m = ws.members?.find((x) => x.userId === userId);
    if (!m) throw new Error("Member not found");
    if (m.role === "owner" && role !== "owner" && ws.members!.filter((x) => x.role === "owner").length === 1) throw new Error("A workspace needs at least one owner.");
    m.role = role;
  });
  return ok({ updated: true });
});

export const DELETE = handle(async (req: Request, { params }: P) => {
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const inviteEmail = url.searchParams.get("invite");
  await mutate((d) => {
    if (inviteEmail) {
      d.invites = d.invites.filter((i) => !(i.workspaceId === id && i.email === inviteEmail));
      return;
    }
    const ws = d.workspaces.find((w) => w.id === id)!;
    const m = ws.members?.find((x) => x.userId === userId);
    if (!m) throw new Error("Member not found");
    if (m.role === "owner" && ws.members!.filter((x) => x.role === "owner").length === 1) throw new Error("A workspace needs at least one owner.");
    ws.members = ws.members!.filter((x) => x.userId !== userId);
  });
  return ok({ removed: true });
});
