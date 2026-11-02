import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";
import { z } from "zod";
import type { Agent, Label, Permission, Priority, Ticket, Workspace } from "../types";
import { LABELS, PRIORITIES } from "../types";
import { deleteFile, listFiles, readFile, safePath, writeFile } from "../files";
import { read } from "../store";
import { formatMemory, searchMemories, upsertMemory } from "../memory";
import { describeRun, MAX_TIMEOUT_S, runCommand } from "../commands";
import { redactFor } from "../secrets";
import { MEMORY_KINDS, type MemoryKind } from "../types";
import { addEvent, createTicket } from "../repo";
import { publish } from "../bus";

/** Agent tools (plan §8 "Agent engine"). Each is gated by the agent's permissions. */

export interface ToolContext {
  workspace: Workspace;
  agent: Agent;
  ticket: Ticket;
  team: Agent[];
  run: RunState;
  /** Aborts when the user stops the run. */
  signal?: AbortSignal;
}

/** Per-run memory used for optimistic file locking and loop protection. */
export interface RunState {
  /** path → content hash this run last saw (read or wrote). */
  seen: Map<string, string>;
  ticketsCreated: number;
}

export const newRunState = (): RunState => ({ seen: new Map(), ticketsCreated: 0 });

// ---- Loop protection limits ----
/** A ticket can be handed off at most this many times. */
export const MAX_HANDOFFS = 6;
/** Two agents may pass the same ticket between them at most this many times in total. */
export const MAX_PAIR_HANDOFFS = 2;
/** Agent-created tickets deeper than this are created but never auto-started. */
export const MAX_AUTO_DEPTH = 3;
/** An agent can create at most this many tickets in one run. */
export const MAX_TICKETS_PER_RUN = 10;

/** Tools whose effects are logged by their own events (no generic "tool_call" line). */
export const QUIET_TOOLS = ["write_file", "delete_file", "add_comment", "create_ticket", "handoff_ticket", "run_command"];

/** Anthropic server-side web search, for agents with the "web_research" permission (API-key mode). */
export const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 8 } as Anthropic.WebSearchTool20250305;

const hash = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

function findTeammate(team: Agent[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return (
    team.find((a) => a.role.toLowerCase() === q) ??
    team.find((a) => a.name.toLowerCase() === q) ??
    team.find((a) => a.role.toLowerCase().includes(q) || q.includes(a.role.toLowerCase()))
  );
}

/** Refuse a write when the file changed since this run last saw it (another agent edited it). */
async function checkFresh(ctx: ToolContext, rel: string, current: string | null) {
  if (current === null) return null;
  const seen = ctx.run.seen.get(rel);
  if (seen === hash(current)) return null;
  if (seen === undefined) {
    return `${rel} already exists and you haven't read it in this session. Read it first with read_file, then write the complete updated file.`;
  }
  const db = await read();
  const last = [...db.checkpoints].reverse().find((c) => c.workspaceId === ctx.workspace.id && c.path === rel);
  const who = last ? ctx.team.find((a) => a.id === last.actor)?.name ?? (last.actor === "user" ? "the user" : "someone") : "someone";
  return `${rel} was changed by ${who} after you read it. Read it again and re-apply your changes on top of the new version, so their work isn't lost.`;
}

export type ToolOutcome =
  | { kind: "continue"; result: string; isError?: boolean }
  | { kind: "ask_user"; question: string }
  | { kind: "handoff"; toAgentId: string; note: string }
  | { kind: "finish"; summary: string; status: "done" | "in_review" };

export interface ToolDef {
  name: string;
  description: string;
  /** zod raw shape: used directly by the Agent SDK and converted to JSON Schema for the API. */
  shape: z.ZodRawShape;
  /** Any of these permissions unlocks the tool. Empty = always available. */
  needs: Permission[];
  summarize: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const MAX_READ = 60_000;

const str = (v: unknown) => (typeof v === "string" ? v : "");

const TOOLS: ToolDef[] = [
  {
    needs: ["read_files"],
    name: "list_files",
    description: "List every file in the project with its size in bytes.",
    shape: {},
    summarize: () => "Looked at the project files",
    run: async (_i, ctx) => {
      const files = await listFiles(ctx.workspace.id);
      return { kind: "continue", result: files.length ? files.map((f) => `${f.path} (${f.size} B)`).join("\n") : "(the project is empty)" };
    },
  },
  {
    needs: ["read_files"],
    name: "read_file",
    description: "Read the full text content of a file in the project.",
    shape: { path: z.string().describe("Path relative to the project root, e.g. css/style.css") },
    summarize: (i) => `Read ${str(i.path)}`,
    run: async (i, ctx) => {
      const { rel } = safePath(ctx.workspace.id, str(i.path));
      const content = await readFile(ctx.workspace.id, rel);
      if (content === null) return { kind: "continue", result: `File not found: ${str(i.path)}`, isError: true };
      ctx.run.seen.set(rel, hash(content));
      const safe = await redactFor(ctx.workspace.id, content);
      return {
        kind: "continue",
        result: safe.length > MAX_READ ? safe.slice(0, MAX_READ) + "\n…(truncated)" : safe,
      };
    },
  },
  {
    needs: ["edit_files", "create_files"],
    name: "write_file",
    description: "Create a new file or replace an existing file. Always provide the COMPLETE file content, never a partial snippet or diff.",
    shape: { path: z.string().describe("Path relative to the project root"), content: z.string().describe("The complete new file content") },
    summarize: (i) => `Wrote ${str(i.path)}`,
    run: async (i, ctx) => {
      const { rel: path } = safePath(ctx.workspace.id, str(i.path));
      const current = await readFile(ctx.workspace.id, path);
      const exists = current !== null;
      const perms = ctx.agent.permissions;
      if (exists && !perms.includes("edit_files"))
        return { kind: "continue", result: "You don't have permission to edit existing files.", isError: true };
      if (!exists && !perms.includes("create_files"))
        return { kind: "continue", result: "You don't have permission to create new files.", isError: true };
      const stale = await checkFresh(ctx, path, current);
      if (stale) return { kind: "continue", result: stale, isError: true };
      const res = await writeFile(ctx.workspace.id, path, str(i.content), { actor: ctx.agent.id, ticketId: ctx.ticket.id });
      ctx.run.seen.set(res.rel, hash(str(i.content)));
      if (res.changed) {
        await addEvent(ctx.ticket.id, ctx.agent.id, "file_change", `${res.created ? "Created" : "Updated"} ${res.rel}`, {
          path: res.rel,
        });
        publish(ctx.workspace.id, { kind: "files_changed", workspaceId: ctx.workspace.id, paths: [res.rel] });
      }
      return { kind: "continue", result: res.changed ? `Saved ${res.rel}` : `No changes to ${res.rel}` };
    },
  },
  {
    needs: ["edit_files"],
    name: "delete_file",
    description: "Delete a file from the project. The user can restore it from version history.",
    shape: { path: z.string() },
    summarize: (i) => `Deleted ${str(i.path)}`,
    run: async (i, ctx) => {
      const { rel } = safePath(ctx.workspace.id, str(i.path));
      const stale = await checkFresh(ctx, rel, await readFile(ctx.workspace.id, rel));
      if (stale) return { kind: "continue", result: stale, isError: true };
      ctx.run.seen.delete(rel);
      const ok = await deleteFile(ctx.workspace.id, str(i.path), { actor: ctx.agent.id, ticketId: ctx.ticket.id });
      if (!ok) return { kind: "continue", result: `File not found: ${str(i.path)}`, isError: true };
      await addEvent(ctx.ticket.id, ctx.agent.id, "file_change", `Deleted ${str(i.path)}`, { path: str(i.path) });
      publish(ctx.workspace.id, { kind: "files_changed", workspaceId: ctx.workspace.id, paths: [str(i.path)] });
      return { kind: "continue", result: `Deleted ${str(i.path)}` };
    },
  },
  {
    needs: ["create_tickets"],
    name: "create_ticket",
    description: "Create a new ticket on the board for a teammate. Use for splitting work into steps or reporting bugs.",
    shape: {
      title: z.string().describe("Short, plain-language title"),
      description: z.string().describe("What needs to happen and what 'done' looks like"),
      assignee_role: z.string().describe("Role of the teammate who should do it, e.g. 'Frontend Developer'"),
      priority: z.enum(PRIORITIES).optional(),
      labels: z.array(z.enum(LABELS)).optional(),
      depends_on: z
        .array(z.number().int())
        .optional()
        .describe("Ticket numbers (e.g. 3 for LUM-3) that must be finished before this one starts"),
    },
    summarize: (i) => `Created ticket “${str(i.title)}”`,
    run: async (i, ctx) => {
      if (ctx.run.ticketsCreated >= MAX_TICKETS_PER_RUN) {
        return {
          kind: "continue",
          isError: true,
          result: `You've created ${MAX_TICKETS_PER_RUN} tickets in this run, which is the limit. Group the remaining work into fewer tickets, or finish now.`,
        };
      }
      const assignee = findTeammate(ctx.team, str(i.assignee_role));
      const db = await read();
      const wsTickets = db.tickets.filter((t) => t.workspaceId === ctx.workspace.id);
      const nums = (Array.isArray(i.depends_on) ? i.depends_on : []).map(Number).filter(Number.isFinite);
      const dependsOn = nums
        .map((n) => wsTickets.find((t) => t.number === n)?.id)
        .filter((id): id is string => Boolean(id) && id !== ctx.ticket.id);
      const parent = wsTickets.find((t) => t.id === ctx.ticket.id) ?? ctx.ticket;
      const chainDepth = (parent.chainDepth ?? 0) + 1;
      const autopilot = ctx.workspace.approvalMode !== "manual";
      const queued = autopilot && Boolean(assignee) && !assignee!.paused && chainDepth <= MAX_AUTO_DEPTH;
      const priority = PRIORITIES.includes(i.priority as Priority) ? (i.priority as Priority) : "medium";
      const labels = (Array.isArray(i.labels) ? i.labels : []).filter((l): l is Label => LABELS.includes(l as Label));
      const t = await createTicket({
        workspaceId: ctx.workspace.id,
        title: str(i.title),
        description: str(i.description),
        priority,
        labels,
        assigneeId: assignee?.id ?? null,
        parentId: ctx.ticket.id,
        createdBy: ctx.agent.id,
        dependsOn,
        queued,
        chainDepth,
      });
      ctx.run.ticketsCreated++;
      const when = !autopilot
        ? "It will wait on the board until the user runs it."
        : queued
          ? dependsOn.length
            ? "It will start automatically once its dependencies are finished."
            : "It will start automatically when a teammate is free."
          : assignee
            ? chainDepth > MAX_AUTO_DEPTH
              ? "It will NOT start automatically (too many levels of follow-up tickets); the user will decide."
              : "It will wait until the assignee is resumed."
            : "";
      return {
        kind: "continue",
        result: `Created LUM-${t.number} “${t.title}” ${assignee ? `assigned to ${assignee.name} (${assignee.role})` : "(unassigned — no teammate has that role)"}. ${when}`.trim(),
      };
    },
  },
  {
    needs: ["run_commands"],
    name: "run_command",
    description:
      "Run ONE project command in the workspace folder and get its exit code and output. Use it to verify your work: e.g. `flutter analyze`, `flutter test`, `dart format lib`, `npm install`, `npm test`, `npx html-validate index.html`, `npx prettier --check .`. No shell: no pipes, redirects, `&&` or variables. Only allowlisted tools are permitted; a refused command tells you why.",
    shape: {
      command: z.string().describe("The command line, e.g. 'flutter analyze'"),
      timeout_seconds: z.number().int().optional().describe(`Default 180, max ${MAX_TIMEOUT_S}`),
    },
    summarize: (i) => `Ran \`${str(i.command).slice(0, 80)}\``,
    run: async (i, ctx) => {
      const run = await runCommand({
        workspace: ctx.workspace,
        command: str(i.command),
        actor: ctx.agent.id,
        ticketId: ctx.ticket.id,
        timeoutSec: typeof i.timeout_seconds === "number" ? i.timeout_seconds : undefined,
        signal: ctx.signal,
      });
      await addEvent(
        ctx.ticket.id,
        ctx.agent.id,
        "command",
        `$ ${run.command}`,
        { runId: run.id, status: run.status, exitCode: run.exitCode, output: run.output.slice(-3000) },
      );
      return { kind: "continue", result: describeRun(run), isError: run.status !== "ok" };
    },
  },
  {
    needs: [],
    name: "remember",
    description:
      "Save something to the team's shared memory so every teammate (now and in future tickets) knows it: decisions (palette, fonts, libraries, page structure), conventions (file layout, naming, coding style), user preferences, and important facts. Saving with an existing title updates that memory. Keep each memory short and specific.",
    shape: {
      kind: z.enum(MEMORY_KINDS.map((k) => k.id) as [MemoryKind, ...MemoryKind[]]).describe("decision | convention | preference | fact | note"),
      title: z.string().describe("Short, unique title, e.g. 'Colour palette'"),
      content: z.string().describe("The details, in 1–5 short lines"),
      tags: z.array(z.string()).optional(),
    },
    summarize: (i) => `Saved to team memory: “${str(i.title)}”`,
    run: async (i, ctx) => {
      const { memory, created, mergedInto, pending } = await upsertMemory({
        workspaceId: ctx.workspace.id,
        kind: str(i.kind),
        title: str(i.title),
        content: str(i.content),
        tags: Array.isArray(i.tags) ? i.tags.map(String) : [],
        authorId: ctx.agent.id,
        ticketId: ctx.ticket.id,
      });
      const what = mergedInto
        ? `This is very close to the existing memory “${mergedInto}”, so I updated that one instead of adding a near-copy.`
        : `${created ? "Saved" : "Updated"} memory “${memory.title}”.`;
      return {
        kind: "continue",
        result: pending ? `${what} The user reviews decisions and conventions before they're final: it's marked as proposed for now. Follow it unless they say otherwise.` : what,
      };
    },
  },
  {
    needs: [],
    name: "recall",
    description: "Search the team's shared memory for decisions, conventions, preferences and facts. Use it before making a choice others may already have made.",
    shape: { query: z.string().describe("What you're looking for, e.g. 'colours fonts' or 'contact form'") },
    summarize: (i) => `Searched team memory for “${str(i.query)}”`,
    run: async (i, ctx) => {
      const found = await searchMemories(ctx.workspace.id, str(i.query), 10);
      if (!found.length) return { kind: "continue", result: "Nothing in team memory matches that." };
      const nameOf = (id: string) => (id === "user" ? "from the user" : `by ${ctx.team.find((a) => a.id === id)?.name ?? "a teammate"}`);
      return { kind: "continue", result: found.map((m) => formatMemory(m, nameOf)).join("\n") };
    },
  },
  {
    needs: [],
    name: "add_comment",
    description: "Post a short progress note on the ticket for the user to read.",
    shape: { text: z.string() },
    summarize: () => "Posted a comment",
    run: async (i, ctx) => {
      await addEvent(ctx.ticket.id, ctx.agent.id, "comment", str(i.text));
      return { kind: "continue", result: "Comment posted." };
    },
  },
  {
    needs: [],
    name: "ask_user",
    description: "Pause and ask the user ONE clear question when you are blocked or a decision is theirs to make. The ticket moves to 'Waiting for You' and you stop working.",
    shape: { question: z.string() },
    summarize: () => "Asked you a question",
    run: async (i) => ({ kind: "ask_user", question: str(i.question) }),
  },
  {
    needs: [],
    name: "handoff_ticket",
    description:
      "Hand THIS ticket to a teammate for the next step (e.g. designer → developer, developer → QA). Use instead of finish_ticket when your part is done but the ticket needs someone else's work. You stop working after calling it.",
    shape: {
      to_role: z.string().describe("Role (or name) of the teammate who should continue, e.g. 'Frontend Developer'"),
      note: z.string().describe("What you did, and exactly what they should do next"),
    },
    summarize: (i) => `Handed off to ${str(i.to_role)}`,
    run: async (i, ctx) => {
      const err = (result: string) => ({ kind: "continue" as const, result, isError: true });
      const target = findTeammate(ctx.team, str(i.to_role));
      if (!target) return err(`No teammate matches “${str(i.to_role)}”. Team roles: ${ctx.team.map((a) => a.role).join(", ")}.`);
      if (target.id === ctx.agent.id) return err("You can't hand a ticket to yourself. Finish it with finish_ticket instead.");
      if (target.paused) return err(`${target.name} is paused right now. Finish the ticket, or ask the user what to do.`);
      if (!str(i.note).trim()) return err("Add a note so your teammate knows what to do next.");
      const history = ctx.ticket.handoffs ?? [];
      if (history.length >= MAX_HANDOFFS)
        return err(`This ticket has already been handed off ${history.length} times, which is the limit. Finish it with finish_ticket (say what's left) or ask the user.`);
      const pair = history.filter(
        (h) =>
          (h.fromAgentId === ctx.agent.id && h.toAgentId === target.id) ||
          (h.fromAgentId === target.id && h.toAgentId === ctx.agent.id),
      ).length;
      if (pair >= MAX_PAIR_HANDOFFS)
        return err(`You and ${target.name} have already passed this ticket back and forth. To avoid a loop, finish it with finish_ticket and list what's left, or ask the user.`);
      return { kind: "handoff", toAgentId: target.id, note: str(i.note).trim() };
    },
  },
  {
    needs: [],
    name: "finish_ticket",
    description: "Call this once when the ticket's work is complete. Provide a short plain-language summary.",
    shape: { summary: z.string().describe("2–5 bullet points: what you did and what the user should check") },
    summarize: () => "Finished the ticket",
    run: async (i, ctx) => {
      const canClose = ctx.agent.permissions.includes("close_tickets") && ctx.workspace.approvalMode === "automatic";
      return { kind: "finish", summary: str(i.summary), status: canClose ? "done" : "in_review" };
    },
  },
];

export function toApiTool(def: ToolDef): Anthropic.Tool {
  const { $schema: _s, ...schema } = z.toJSONSchema(z.object(def.shape)) as Record<string, unknown>;
  void _s;
  return { name: def.name, description: def.description, input_schema: schema as Anthropic.Tool["input_schema"] };
}

export function toolsFor(agent: Agent) {
  // web_research is provided by the model platform (server web search), not a Luma tool.
  return TOOLS.filter((t) => t.needs.length === 0 || t.needs.some((p) => agent.permissions.includes(p)));
}
