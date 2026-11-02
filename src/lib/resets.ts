import "server-only";
import { mutate } from "./store";
import { newToken, sha256 } from "./auth";

/** One-hour, one-time password reset link path for a user. */
export async function createResetLink(userId: string) {
  const token = newToken();
  await mutate((db) => {
    db.resets = db.resets.filter((r) => r.userId !== userId && new Date(r.expiresAt) > new Date());
    db.resets.push({ id: sha256(token), userId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  });
  return `/reset/${token}`;
}
