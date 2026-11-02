import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { checkPassword, currentUser, hashPassword, publicUser, verifyPassword, HttpError } from "@/lib/auth";
import { mutate } from "@/lib/store";

export const runtime = "nodejs";

/** Who am I, and is sign-in turned on? */
export const GET = handle(async () => {
  const db = await read();
  const u = currentUser();
  return ok({ authEnabled: db.users.length > 0, user: u ? { ...publicUser(u), notifyEmail: u.notifyEmail ?? "instant" } : null });
});

/** Update my profile: name, email notification preference, or password. */
export const PATCH = handle(async (req: Request) => {
  const me = currentUser();
  if (!me) throw new HttpError(400, "Profiles need sign-in to be turned on.");
  const body = (await req.json()) as { name?: string; notifyEmail?: "off" | "instant" | "daily"; currentPassword?: string; newPassword?: string };
  let hash: string | undefined;
  if (body.newPassword !== undefined) {
    if (!(await verifyPassword(body.currentPassword ?? "", me.passwordHash))) throw new HttpError(400, "Your current password isn't right.");
    checkPassword(body.newPassword);
    hash = await hashPassword(body.newPassword);
  }
  const user = await mutate((db) => {
    const u = db.users.find((x) => x.id === me.id)!;
    if (body.name?.trim()) u.name = body.name.trim().slice(0, 60);
    if (body.notifyEmail && ["off", "instant", "daily"].includes(body.notifyEmail)) u.notifyEmail = body.notifyEmail;
    if (hash) u.passwordHash = hash;
    return { ...u };
  });
  return ok({ user: { ...publicUser(user), notifyEmail: user.notifyEmail ?? "instant" } });
});
