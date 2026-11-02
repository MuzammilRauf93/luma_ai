import { handle, ok, fail } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { createSession, createUser, sessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

/** Turn on sign-in by creating the first (admin) account. Existing workspaces become theirs. */
export const POST = handle(async (req: Request) => {
  if ((await read()).users.length) return fail("Sign-in is already set up.", 409);
  const { email, name, password } = (await req.json()) as { email: string; name: string; password: string };
  const user = await createUser({ email, name, password, role: "admin" });
  await mutate((db) => {
    for (const w of db.workspaces) w.members = [{ userId: user.id, role: "owner" }, ...(w.members ?? []).filter((m) => m.userId !== user.id)];
  });
  const { token, expires } = await createSession(user.id);
  const res = ok({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 201);
  res.headers.set("Set-Cookie", sessionCookie(token, expires, new URL(req.url).protocol === "https:"));
  return res;
});
