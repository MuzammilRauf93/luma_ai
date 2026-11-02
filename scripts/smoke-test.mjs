#!/usr/bin/env node
/**
 * Real-Claude smoke test for Luma AI.
 *
 *   1. Start Luma:            npm run dev        (Node 22: `nvm use 22`)
 *   2. In another terminal:   node scripts/smoke-test.mjs [web|flutter] [maxMinutes]
 *
 * Creates a fresh workspace, sends a small goal to the Project Manager, lets autopilot run
 * (default 25 minutes max), then prints a report: tickets, handoffs, commands, memories,
 * commits, tokens and anything that looks wrong. Paste the report back to Claude for tuning.
 * Uses your Claude connection (plan usage or API credits). Stop any time with Ctrl+C.
 */

const BASE = process.env.LUMA_URL || "http://localhost:3000";
const kind = process.argv[2] === "flutter" ? "flutter" : "web";
const maxMin = Number(process.argv[3] || 25);

const GOALS = {
  web: "A one-page website for a small neighbourhood coffee shop called Bean There: hero with tagline, a menu section with 6 drinks and prices, opening hours, and a contact form that shows a thank-you message. Mobile friendly.",
  flutter: "A simple habit tracker app: a list of habits, add a habit with a name, tap to mark today done (with a streak count), swipe to delete, and a friendly empty state.",
};

let cookie = "";
async function api(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: init.json ? JSON.stringify(init.json) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// With sign-in turned on (Phase 5), pass LUMA_EMAIL and LUMA_PASSWORD.
const me = await api("/api/auth/me").catch(() => null);
if (me?.authEnabled) {
  if (!process.env.LUMA_EMAIL || !process.env.LUMA_PASSWORD) throw new Error("Sign-in is on: run with LUMA_EMAIL=… LUMA_PASSWORD=… npm run smoke");
  await api("/api/auth/login", { method: "POST", json: { email: process.env.LUMA_EMAIL, password: process.env.LUMA_PASSWORD } });
}
const settings = await api("/api/settings").catch(() => null);
if (!settings) throw new Error(`Luma isn't running at ${BASE}. Start it with npm run dev.`);
if (!settings.connected) throw new Error("Connect Claude in Luma's Settings first.");
console.log(`Luma at ${BASE} · ${settings.authMode} · model ${settings.defaultModel}`);

const { workspace } = await api("/api/workspaces", {
  method: "POST",
  json: { name: `Smoke test ${new Date().toISOString().slice(0, 16)}`, template: kind === "flutter" ? "flutter" : "blank", description: "Automated smoke test" },
});
const id = workspace.id;
await api(`/api/workspaces/${id}/git`, { method: "POST", json: { action: "enable" } }).catch((e) => console.log("git:", e.message));
console.log(`Workspace ${id} (${kind}). Open ${BASE}/w/${id}/board to watch.`);
const goal = await api(`/api/workspaces/${id}/goal`, { method: "POST", json: { goal: GOALS[kind] } });
if (goal.error) throw new Error(goal.error);

const started = Date.now();
let quietSince = Date.now();
let last = "";
while (Date.now() - started < maxMin * 60_000) {
  await sleep(10_000);
  const d = await api(`/api/workspaces/${id}`);
  const busy = d.tickets.some((t) => t.running || t.queued);
  const line = d.tickets.map((t) => `${t.number}:${t.status}${t.running ? "*" : t.queued ? "q" : ""}`).join(" ");
  if (line !== last) {
    console.log(`${Math.round((Date.now() - started) / 1000)}s  ${line}`);
    last = line;
    quietSince = Date.now();
  }
  if (!busy && Date.now() - quietSince > 20_000) break;
}

// ---- report
const d = await api(`/api/workspaces/${id}`);
const name = (aid) => d.agents.find((a) => a.id === aid)?.name ?? aid;
const out = [];
const warn = [];
out.push(`# Luma smoke test report (${kind})`, `Workspace: ${id} · ${Math.round((Date.now() - started) / 60000)} min · model ${settings.defaultModel}`, "");
let tokens = 0;
for (const t of d.tickets.sort((a, b) => a.number - b.number)) {
  const b = await api(`/api/tickets/${t.id}`);
  tokens += b.usage.tokens;
  const ev = b.events;
  const cmds = ev.filter((e) => e.type === "command");
  const files = ev.filter((e) => e.type === "file_change").length;
  const handoffs = ev.filter((e) => e.type === "handoff");
  const tools = ev.filter((e) => e.type === "tool_call").map((e) => e.content);
  const summary = [...ev].reverse().find((e) => e.type === "summary")?.content ?? "";
  out.push(`## LUM-${t.number} ${t.title}`);
  out.push(`- ${t.status} · ${name(t.assigneeId)} · ${b.usage.tokens.toLocaleString()} tokens · ${files} file changes · deps ${b.dependsOn.map((x) => "LUM-" + x.number).join(",") || "none"}`);
  for (const h of handoffs) out.push(`- handoff: ${h.content.slice(0, 160)}`);
  for (const c of cmds) out.push(`- ${c.content} → ${c.meta?.status}${c.meta?.exitCode != null ? ` (${c.meta.exitCode})` : ""}`);
  if (tools.some((x) => x.startsWith("Saved to team memory"))) out.push(`- memory: ${tools.filter((x) => x.startsWith("Saved to team memory")).join("; ")}`);
  for (const e of ev.filter((e) => e.type === "error" || e.type === "question")) out.push(`- ${e.type}: ${e.content.slice(0, 200)}`);
  if (summary) out.push(`- summary: ${summary.replace(/\s+/g, " ").slice(0, 400)}`);
  out.push("");
  if (t.status === "failed") warn.push(`LUM-${t.number} failed`);
  if (t.status === "waiting_for_user") warn.push(`LUM-${t.number} is waiting for you`);
  const builder = ["Frontend Developer", "Mobile Developer", "Backend Developer"].includes(d.agents.find((a) => a.id === t.assigneeId)?.role);
  if (builder && files && !cmds.length) warn.push(`LUM-${t.number}: builder changed files but ran no checks`);
  if (cmds.some((c) => c.meta?.status === "refused")) warn.push(`LUM-${t.number}: a command was refused`);
}
const mem = await api(`/api/workspaces/${id}/memory`);
const git = await api(`/api/workspaces/${id}/git`).catch(() => null);
out.push(`## Totals`, `- ${d.tickets.length} tickets · ${tokens.toLocaleString()} tokens`, `- memories: ${mem.memories.map((m) => `${m.kind}:${m.title}`).join(", ") || "none"}`);
if (git?.commits) out.push(`- commits: ${git.commits.length}`, ...git.commits.slice(0, 15).map((c) => `  - ${c.sha} ${c.author.replace(/ \(Luma .*\)/, "")}: ${c.subject}`));
if (!mem.memories.length) warn.push("No team memories were saved");
out.push("", "## Things to look at", ...(warn.length ? warn.map((w) => `- ${w}`) : ["- nothing obvious"]));
const report = out.join("\n");
console.log("\n" + report);
const fs = await import("fs");
const file = `smoke-report-${kind}-${Date.now()}.md`;
fs.writeFileSync(file, report);
console.log(`\nSaved ${file}`);
