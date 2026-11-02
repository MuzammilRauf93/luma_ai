import "server-only";
import { mutate, now } from "./store";
import { newToken, normEmail, sha256 } from "./auth";
import type { WorkspaceRole } from "./types";

const DAYS = 7;

/** Create an invite and return the one-time link path (the token itself is never stored). */
export async function createInvite(input: { email: string; role: "admin" | "member"; workspaceId?: string; workspaceRole?: WorkspaceRole; createdBy: string; origin?: string }) {
  const email = normEmail(input.email);
  const token = newToken();
  await mutate((db) => {
    db.invites = db.invites.filter((i) => new Date(i.expiresAt) > new Date() && !(i.email === email && i.workspaceId === input.workspaceId));
    db.invites.push({
      id: sha256(token),
      email,
      role: input.role,
      workspaceId: input.workspaceId,
      workspaceRole: input.workspaceRole,
      createdBy: input.createdBy,
      createdAt: now(),
      expiresAt: new Date(Date.now() + DAYS * 864e5).toISOString(),
    });
  });
  const path = `/invite/${token}`;
  let emailed = false;
  try {
    const { appUrl, sendInviteEmail } = await import("./mail");
    const { read } = await import("./store");
    const db = await read();
    emailed = await sendInviteEmail(email, (await appUrl(input.origin)) + path, {
      inviter: db.users.find((u) => u.id === input.createdBy)?.name,
      workspace: input.workspaceId ? db.workspaces.find((w) => w.id === input.workspaceId)?.name : undefined,
    });
  } catch (err) {
    console.error("[luma mail] invite email failed:", (err as Error).message);
  }
  return { path, email, expiresInDays: DAYS, emailed };
}
