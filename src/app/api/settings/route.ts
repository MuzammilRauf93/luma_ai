import { handle, ok, fail } from "@/lib/http";
import { mutate, read } from "@/lib/store";
import { encrypt, maskKey } from "@/lib/crypto";
import { listModels, pickDefaultModel } from "@/lib/anthropic";
import { inspectAccount } from "@/lib/claudeAccount";
import { verifyToken } from "@/lib/deploy";

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
  });
});

/** Save + validate a new API key, or update other settings. */
export const POST = handle(async (req: Request) => {
  const body = (await req.json()) as {
    apiKey?: string;
    authMode?: "claude_account" | "api_key";
    defaultModel?: string;
    monthlyLimitUsd?: number | null;
    deployToken?: { provider: "netlify" | "vercel"; token: string | null };
  };
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
    const { account, models } = await inspectAccount();
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
