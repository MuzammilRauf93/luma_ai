import { handle, ok } from "@/lib/http";
import { read } from "@/lib/store";
import { normEmail, rateLimit } from "@/lib/auth";
import { createResetLink } from "@/lib/resets";
import { appUrl, emailConfigured, sendResetEmail } from "@/lib/mail";

export const runtime = "nodejs";

/** Email a reset link. Always answers the same way, so it doesn't reveal who has an account. */
export const POST = handle(async (req: Request) => {
  const { email: raw } = (await req.json()) as { email?: string };
  const email = normEmail(raw ?? "");
  rateLimit(`forgot:${email}`);
  const configured = await emailConfigured();
  if (configured) {
    const user = (await read()).users.find((u) => u.email === email);
    if (user) {
      const path = await createResetLink(user.id);
      await sendResetEmail(email, (await appUrl(new URL(req.url).origin)) + path).catch((err) => console.error("[luma mail] reset email failed:", err.message));
    }
  }
  return ok({ emailConfigured: configured });
});
