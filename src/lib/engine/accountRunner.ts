import "server-only";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { mutate, newId, now } from "../store";
import { publish } from "../bus";
import { addEvent, updateTicket } from "../repo";
import { buildSystemPrompt } from "../presets";
import { accountEnv, sdkCwd, LOGIN_HELP } from "../claudeAccount";
import { newRunState, QUIET_TOOLS, toolsFor, type ToolContext } from "./tools";
import { budgetTokens, buildBriefing, type RunInput, type RunResult } from "./orchestrator";
import type { TicketStatus } from "../types";

/**
 * Runs one agent on one ticket through the Claude Agent SDK, signed in with the
 * user's Claude account (subscription). Same tools, events and safety limits as
 * the API-key engine; Claude Code's built-in tools are switched off, so agents
 * can only touch the workspace through Luma's own tools.
 */

const MAX_TURNS = 30;
const SERVER = "luma";

export async function executeWithAccount(input: RunInput): Promise<RunResult> {
  const { ticket, agent, workspace, model, team, controller } = input;
  const ctx: ToolContext = { workspace, agent, ticket, team, run: newRunState(), signal: controller.signal };
  const defs = toolsFor(agent);
  // Claude Code's own web tools, only for agents allowed to research the web.
  const webTools = agent.permissions.includes("web_research") ? ["WebSearch", "WebFetch"] : [];
  let finalStatus: TicketStatus | null = null;
  let handoff: RunResult["handoff"];
  let tokensUsed = 0;

  const server = createSdkMcpServer({
    name: SERVER,
    version: "0.1.0",
    tools: defs.map((def) =>
      tool(def.name, def.description, def.shape, async (args: Record<string, unknown>) => {
        const summary = def.summarize(args);
        publish(workspace.id, { kind: "tool", ticketId: ticket.id, name: def.name, summary });
        if (!QUIET_TOOLS.includes(def.name)) {
          await addEvent(ticket.id, agent.id, "tool_call", summary, { tool: def.name });
        }
        let outcome;
        try {
          outcome = await def.run(args, ctx);
        } catch (err) {
          outcome = { kind: "continue" as const, result: err instanceof Error ? err.message : String(err), isError: true };
        }
        if (outcome.kind === "continue") {
          return { content: [{ type: "text" as const, text: outcome.result }], isError: outcome.isError };
        }
        if (outcome.kind === "ask_user") {
          await addEvent(ticket.id, agent.id, "question", outcome.question);
          finalStatus = "waiting_for_user";
          return { content: [{ type: "text" as const, text: "Question sent to the user. Stop now and end your turn." }] };
        }
        if (outcome.kind === "handoff") {
          handoff = { toAgentId: outcome.toAgentId, note: outcome.note };
          finalStatus = "todo";
          return { content: [{ type: "text" as const, text: "Handoff recorded. Stop now and end your turn." }] };
        }
        await addEvent(ticket.id, agent.id, "summary", outcome.summary);
        finalStatus = outcome.status;
        return { content: [{ type: "text" as const, text: "Ticket finished. End your turn now." }] };
      }),
    ),
  });

  publish(workspace.id, { kind: "run_started", ticketId: ticket.id, agentId: agent.id });
  await updateTicket(ticket.id, { status: "in_progress" }, agent.id);

  const q = query({
    prompt: await buildBriefing(ticket, workspace, team),
    options: {
      systemPrompt: buildSystemPrompt(agent.systemPrompt, agent.tone),
      model: model || undefined,
      tools: webTools, // no other built-in Claude Code tools (no shell, no access outside the workspace)
      mcpServers: { [SERVER]: server },
      allowedTools: [...defs.map((d) => `mcp__${SERVER}__${d.name}`), ...webTools],
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      maxTurns: MAX_TURNS,
      abortController: controller,
      cwd: await sdkCwd(),
      env: await accountEnv(),
    },
  });

  let lastText = "";
  for await (const m of q) {
    if (m.type === "assistant" && !m.parent_tool_use_id) {
      if (m.error === "authentication_failed") throw new Error(LOGIN_HELP);
      if (m.error === "oauth_org_not_allowed")
        throw new Error("Your organization doesn't allow Claude Code / Agent SDK use with this account. Ask your Claude admin, or switch to an API key in Settings.");
      if (m.error === "rate_limit")
        throw new Error("You've hit your Claude plan's usage limit. Wait for it to reset, then run the ticket again.");
      const u = m.message.usage;
      if (u) tokensUsed += budgetTokens(u);
      const text = m.message.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) {
        lastText = text;
        publish(workspace.id, { kind: "text", ticketId: ticket.id, text });
        await addEvent(ticket.id, agent.id, "agent_message", text);
      }
      if (!finalStatus && tokensUsed > workspace.ticketBudgetTokens) {
        await addEvent(
          ticket.id,
          "system",
          "question",
          `This ticket reached its budget of ${workspace.ticketBudgetTokens.toLocaleString()} tokens, so ${agent.name} paused. Reply with a comment and run it again to continue.`,
        );
        finalStatus = "waiting_for_user";
        q.close();
        break;
      }
    } else if (m.type === "result") {
      const inputTokens =
        m.usage.input_tokens + (m.usage.cache_creation_input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0);
      await mutate((db) => {
        db.usage.push({
          id: newId("us"),
          workspaceId: workspace.id,
          agentId: agent.id,
          ticketId: ticket.id,
          model: model || "claude-account",
          inputTokens,
          outputTokens: m.usage.output_tokens,
          costUsd: 0, // covered by the Claude subscription, not billed per token
          createdAt: now(),
        });
      });
      if (m.subtype !== "success" && !finalStatus) {
        if (m.subtype === "error_max_turns") {
          await addEvent(ticket.id, "system", "question", `${agent.name} reached the step limit (${MAX_TURNS}) without finishing. Review the progress and run again to continue.`);
          finalStatus = "waiting_for_user";
        } else if (m.is_error) {
          throw new Error(`The agent stopped with an error (${m.subtype}).`);
        }
      }
    }
  }

  if (!finalStatus) {
    // Agent ended without calling finish_ticket: treat its last message as the summary.
    await addEvent(ticket.id, agent.id, "summary", lastText || "Finished without a summary.");
    finalStatus = "in_review";
  }
  return { status: finalStatus, handoff };
}
