import "server-only";
import { mutate, now } from "./store";
import { newToken, normEmail, sha256 } from "./auth";
import type { WorkspaceRole } from "./types";

const DAYS = 7;

/** Create an invite and return the one-time link path (the token itself is never stored). */
export async function createInvite(input: { email: string; role: "admin" | "member"; workspaceId?: string; workspaceRole?: WorkspaceRole; createdBy: string }) {
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
  return { path: `/invite/${token}`, email, expiresInDays: DAYS };
}
