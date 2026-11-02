import { handle, ok, fail } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { checkPassword, createSession, hashPassword, publicUser, sessionCookie, sha256 } from "@/lib/auth";

export const runtime = "nodejs";

/** Set a new password with a reset token; signs out every other session of that person. */
export const POST = handle(async (req: Request) => {
  const { token, password } = (await req.json()) as { token?: string; password?: string };
  const db = await read();
  const r = db.resets.find((x) => x.id === sha256(token ?? ""));
  if (!r || new Date(r.expiresAt) < new Date()) return fail("This reset link has expired or was already used. Ask for a new one.", 400);
  checkPassword(password ?? "");
  const hash = await hashPassword(password!);
  const user = await mutate((d) => {
    const u = d.users.find((x) => x.id === r.userId);
    if (!u) throw new Error("Account not found");
    u.passwordHash = hash;
    d.resets = d.resets.filter((x) => x.userId !== u.id);
    d.sessions = d.sessions.filter((s) => s.userId !== u.id);
    return { ...u };
  });
  const { token: t, expires } = await createSession(user.id);
  const res = ok({ user: publicUser(user) });
  res.headers.set("Set-Cookie", sessionCookie(t, expires, new URL(req.url).protocol === "https:"));
  return res;
});
