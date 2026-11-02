import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { currentUser, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

/** Who am I, and is sign-in turned on? */
export const GET = handle(async () => {
  const db = await read();
  const u = currentUser();
  return ok({ authEnabled: db.users.length > 0, user: u ? publicUser(u) : null });
});
