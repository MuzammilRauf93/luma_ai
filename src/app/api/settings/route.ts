import { handle, ok, fail } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { encrypt, maskKey } from "@/lib/crypto";
import { listModels, pickDefaultModel } from "@/lib/anthropic";
import { inspectAccount } from "@/lib/claudeAccount";
import { verifyToken } from "@/lib/deploy";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";

export const GET = handle(async () => {
  const db = await read();
  const authMode = db.settings.authMode ?? "api_key";
  return ok({
    authMode,
    account: authMode === "claude_account" ? db.settings.claudeAccount ?? null : null,
    connected: authMode === "claude_account" ? Boolean(db.settings.claudeAccount) : Boolean(db.settings.encryptedApiKey),
    apiKeyHint: db.settings.apiKeyHint ?? null,
    defaultModel: db.settings.defaultModel ?? null,
    monthlyLimitUsd: db.settings.monthlyLimitUsd ?? null,
    deployAccounts: { netlify: Boolean(db.settings.deployTokens?.netlify), vercel: Boolean(db.settings.deployTokens?.vercel) },
    email: db.settings.email ? { ...db.settings.email, pass: undefined, hasPassword: Boolean(db.settings.email.pass) } : null,
    emailFromEnv: Boolean(process.env.LUMA_SMTP_URL),
    appUrl: db.settings.appUrl ?? null,
    github: db.settings.githubToken ? db.settings.githubUser ?? "connected" : null,
    claudeToken: Boolean(db.settings.claudeOauthToken),
  });
});

/** Save + validate a new API key, or update other settings. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as {
    apiKey?: string;
    authMode?: "claude_account" | "api_key";
    claudeToken?: string;
    githubToken?: string | null;
    defaultModel?: string;
    monthlyLimitUsd?: number | null;
    deployToken?: { provider: "netlify" | "vercel"; token: string | null };
    email?: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string } | null;
    appUrl?: string | null;
    testEmail?: boolean;
  };
  if (body.testEmail) {
    const me = currentUser();
    const to = me?.email ?? body.email?.from;
    if (!to) return fail("Sign in (or set a From address) so Luma knows where to send the test.");
    const { sendMail } = await import("@/lib/mail");
    const sent = await sendMail(to, "Luma test email", "<p>Email from Luma AI works. 🎉</p>", "Email from Luma AI works.");
    if (!sent) return fail("Email isn't set up yet.");
    return ok({ sentTo: to });
  }
  if (body.email !== undefined || body.appUrl !== undefined) {
    let pass: string | undefined;
    if (body.email?.pass) pass = await encrypt(body.email.pass);
    await mutate((db) => {
      if (body.appUrl !== undefined) db.settings.appUrl = body.appUrl?.trim().replace(/\/+$/, "") || undefined;
      if (body.email === null) delete db.settings.email;
      else if (body.email) {
        const e = body.email;
        if (!e.host?.trim() || !e.from?.trim()) throw new Error("Enter at least the SMTP host and a From address.");
        db.settings.email = {
          host: e.host.trim(),
          port: Number(e.port) || 587,
          secure: Boolean(e.secure),
          user: e.user?.trim() || undefined,
          pass: pass ?? db.settings.email?.pass,
          from: e.from.trim(),
        };
      }
    });
    return ok({ saved: true });
  }
  if (body.githubToken !== undefined) {
    if (!body.githubToken) {
      await mutate((db) => {
        delete db.settings.githubToken;
        delete db.settings.githubUser;
      });
      return ok({ connected: false });
    }
    const { verifyGithubToken } = await import("@/lib/github");
    const login = await verifyGithubToken(body.githubToken.trim());
    const enc = await encrypt(body.githubToken.trim());
    await mutate((db) => {
      db.settings.githubToken = enc;
      db.settings.githubUser = login;
    });
    return ok({ connected: true, account: login });
  }
  if (body.deployToken) {
    const { provider, token } = body.deployToken;
    if (provider !== "netlify" && provider !== "vercel") return fail("Unknown deploy provider");
    if (!token) {
      await mutate((db) => {
        if (db.settings.deployTokens) delete db.settings.deployTokens[provider];
      });
      return ok({ connected: false });
    }
    const account = await verifyToken(provider, token.trim());
    const enc = await encrypt(token.trim());
    await mutate((db) => {
      db.settings.deployTokens = { ...(db.settings.deployTokens ?? {}), [provider]: enc };
    });
    return ok({ connected: true, account });
  }
  if (body.authMode === "claude_account") {
    if (body.claudeToken !== undefined) {
      const t = body.claudeToken.trim();
      const enc = t ? await encrypt(t) : undefined;
      await mutate((db) => {
        db.settings.claudeOauthToken = enc;
      });
    }
    let account, models;
    try {
      ({ account, models } = await inspectAccount());
    } catch (err) {
      if (body.claudeToken) await mutate((db) => void delete db.settings.claudeOauthToken);
      throw err;
    }
    await mutate((db) => {
      db.settings.authMode = "claude_account";
      db.settings.claudeAccount = account;
      if (!db.settings.defaultModel || !models.some((m) => m.id === db.settings.defaultModel)) {
        db.settings.defaultModel = pickDefaultModel(models);
      }
    });
    return ok({ connected: true, account, models });
  }
  if (body.apiKey !== undefined) {
    const key = body.apiKey.trim();
    if (!key.startsWith("sk-ant-")) return fail("That doesn't look like an Anthropic API key. It should start with sk-ant-.");
    let models;
    try {
      models = await listModels(key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(/401|auth/i.test(msg) ? "Anthropic rejected this key. Check that you copied all of it." : `Couldn't reach Anthropic: ${msg}`);
    }
    const encryptedApiKey = await encrypt(key);
    await mutate((db) => {
      db.settings.authMode = "api_key";
      db.settings.encryptedApiKey = encryptedApiKey;
      db.settings.apiKeyHint = maskKey(key);
      if (!db.settings.defaultModel || !models.some((m) => m.id === db.settings.defaultModel)) {
        db.settings.defaultModel = pickDefaultModel(models);
      }
    });
    return ok({ connected: true, models });
  }
  await mutate((db) => {
    if (body.defaultModel) db.settings.defaultModel = body.defaultModel;
    if (body.monthlyLimitUsd !== undefined) db.settings.monthlyLimitUsd = body.monthlyLimitUsd ?? undefined;
  });
  return ok({ saved: true });
});

export const DELETE = handle(async () => {
  await mutate((db) => {
    delete db.settings.encryptedApiKey;
    delete db.settings.apiKeyHint;
    delete db.settings.claudeAccount;
    delete db.settings.authMode;
  });
  return ok({ connected: false });
});
