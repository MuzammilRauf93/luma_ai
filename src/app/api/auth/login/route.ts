import { handle, ok, fail } from "@/lib/http";
import { read } from "@/lib/store";
import { createSession, normEmail, publicUser, rateLimit, sessionCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  const { email: raw, password } = (await req.json()) as { email?: string; password?: string };
  const email = normEmail(raw ?? "");
  rateLimit(`login:${email}`);
  const db = await read();
  const user = db.users.find((u) => u.email === email);
  // Same message either way, so it doesn't reveal which emails have accounts.
  if (!user || !(await verifyPassword(password ?? "", user.passwordHash))) return fail("That email and password don't match.", 401);
  const { token, expires } = await createSession(user.id);
  const res = ok({ user: publicUser(user) });
  res.headers.set("Set-Cookie", sessionCookie(token, expires, new URL(req.url).protocol === "https:"));
  return res;
});
