import "server-only";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { read } from "./store";
import { getClient } from "./anthropic";
import { accountEnv, sdkCwd, LOGIN_HELP } from "./claudeAccount";

/**
 * A single prompt → text completion with no tools, through whichever connection the
 * user chose in Settings (API key or Claude account). Used by small helpers such as
 * "Draft this agent with Claude" in the agent builder.
 */
export async function complete(system: string, prompt: string, maxTokens = 2000): Promise<string> {
  const db = await read();
  const model = db.settings.defaultModel || "";
  if (db.settings.authMode === "claude_account") {
    const q = query({
      prompt,
      options: {
        systemPrompt: system,
        model: model || undefined,
        tools: [],
        maxTurns: 1,
        permissionMode: "dontAsk",
        settingSources: [],
        persistSession: false,
        cwd: await sdkCwd(),
        env: accountEnv(),
      },
    });
    let out = "";
    for await (const m of q) {
      if (m.type === "assistant" && m.error === "authentication_failed") throw new Error(LOGIN_HELP);
      if (m.type === "result") {
        if (m.subtype === "success") out = m.result;
        else throw new Error(`Claude couldn't answer (${m.subtype}).`);
      }
    }
    return out;
  }
  if (!model) throw new Error("No model selected. Choose a default model in Settings.");
  const client = await getClient();
  const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Claude didn't return a usable draft. Try again with a bit more detail.");
  return JSON.parse(text.slice(start, end + 1));
}
