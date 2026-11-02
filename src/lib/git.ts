import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { DATA_DIR, read } from "./store";
import { publish } from "./bus";
import { workspaceRoot } from "./files";
import { runProcess, toolPath } from "./proc";
import { recordChanges, snapshot } from "./commands";
import { updateWorkspace } from "./repo";
import type { GitSettings, Workspace } from "./types";

/**
 * Git / GitHub sync (Phase 4). Each workspace's files folder can be a git repo.
 * Luma commits after every agent run that changed files (one commit per ticket run,
 * authored as the agent), and can push to GitHub and open pull requests through your
 * own `git` credentials and `gh` login. Agents never run git themselves.
 */

const GITIGNORE = `# Added by Luma
.DS_Store
node_modules/
build/
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
ios/Pods/
ios/.symlinks/
ios/Flutter/ephemeral/
.luma-sim/
.idea/
*.log
`;

export const DEFAULT_GIT: GitSettings = { enabled: false, branch: "main", baseBranch: "main", autoCommit: true, autoPush: false };

function env() {
  // GIT_CEILING_DIRECTORIES stops git from ever using a repo *above* the workspace folder.
  return { ...process.env, PATH: toolPath(), GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GIT_CEILING_DIRECTORIES: path.join(DATA_DIR, "workspaces") } as NodeJS.ProcessEnv;
}

async function sh(cwd: string, cmd: string, args: string[], timeoutMs = 60_000) {
  const r = await runProcess(cmd, args, { cwd, env: env(), timeoutMs });
  return { ...r, out: r.stdout.trim(), err: (r.stderr || r.stdout).trim() };
}

async function git(wsId: string, args: string[], timeoutMs?: number) {
  return sh(workspaceRoot(wsId), "git", args, timeoutMs);
}

async function must(wsId: string, args: string[], what: string, timeoutMs?: number) {
  const r = await git(wsId, args, timeoutMs);
  if (r.code !== 0) throw new Error(`${what} failed: ${r.err.split("\n").slice(-6).join("\n") || `git exited with ${r.code}`}`);
  return r.out;
}

export function parseGithub(url: string | undefined) {
  const m = url?.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const settingsOf = (ws: Workspace): GitSettings => ({ ...DEFAULT_GIT, ...(ws.git ?? {}) });

async function save(wsId: string, patch: Partial<GitSettings>) {
  const db = await read();
  const ws = db.workspaces.find((w) => w.id === wsId);
  if (!ws) throw new Error("Workspace not found");
  const git = { ...settingsOf(ws), ...patch };
  await updateWorkspace(wsId, { git } as Partial<Workspace>);
  publish(wsId, { kind: "git", workspaceId: wsId });
  return git;
}

export async function tools() {
  const [g, gh] = await Promise.all([
    runProcess("git", ["--version"], { env: env(), timeoutMs: 5000 }),
    runProcess("gh", ["auth", "status", "--hostname", "github.com"], { env: env(), timeoutMs: 8000 }),
  ]);
  const ghText = gh.stdout + gh.stderr;
  return {
    git: g.code === 0,
    gh: gh.code !== 127 && !/ENOENT/.test(ghText),
    ghAuthed: gh.code === 0,
    ghUser: ghText.match(/account\s+(\S+)/i)?.[1] ?? ghText.match(/as\s+(\S+)/i)?.[1],
  };
}

async function isRepo(wsId: string) {
  try {
    await fs.access(path.join(workspaceRoot(wsId), ".git"));
    return true;
  } catch {
    return false;
  }
}

async function ensureBranch(wsId: string, branch: string) {
  const cur = await git(wsId, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (cur.out === branch) return;
  const exists = (await git(wsId, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  await must(wsId, exists ? ["checkout", branch] : ["checkout", "-b", branch], `Switching to branch ${branch}`);
}

/** Turn git on for a workspace: init, .gitignore, first commit, work branch. */
export async function enableGit(ws: Workspace, opts: { branch?: string; baseBranch?: string } = {}) {
  const t = await tools();
  if (!t.git) throw new Error("Git isn't installed on this computer. Install the Xcode command line tools (xcode-select --install) or git from git-scm.com.");
  const s = settingsOf(ws);
  const base = opts.baseBranch?.trim() || s.baseBranch || "main";
  const branch = opts.branch?.trim() || s.branch || base;
  const root = workspaceRoot(ws.id);
  if (!(await isRepo(ws.id))) {
    const init = await git(ws.id, ["init", "-b", base]);
    if (init.code !== 0) await must(ws.id, ["init"], "git init");
    await must(ws.id, ["symbolic-ref", "HEAD", `refs/heads/${base}`], "Setting the main branch");
  }
  const gi = path.join(root, ".gitignore");
  try {
    const cur = await fs.readFile(gi, "utf8");
    if (!cur.includes("# Added by Luma")) await fs.writeFile(gi, cur.trimEnd() + "\n\n" + GITIGNORE);
  } catch {
    await fs.writeFile(gi, GITIGNORE);
  }
  // Use your global git identity if you have one; otherwise a local placeholder.
  if (!(await git(ws.id, ["config", "user.email"])).out) {
    await must(ws.id, ["config", "user.email", "luma@localhost"], "git config");
    await must(ws.id, ["config", "user.name", "Luma"], "git config");
  }
  const hasCommit = (await git(ws.id, ["rev-parse", "--verify", "--quiet", "HEAD"])).code === 0;
  if (!hasCommit) {
    await must(ws.id, ["add", "-A"], "git add");
    await must(ws.id, ["commit", "--allow-empty", "-m", `Start ${ws.name} (Luma ${ws.template} template)`], "First commit");
  }
  if (branch !== base) await ensureBranch(ws.id, branch);
  return save(ws.id, { enabled: true, branch, baseBranch: base, lastError: undefined });
}

export async function updateGitSettings(ws: Workspace, patch: Partial<Pick<GitSettings, "autoCommit" | "autoPush" | "branch" | "enabled">>) {
  const s = settingsOf(ws);
  if (patch.branch && patch.branch !== s.branch) {
    if (!/^[\w./-]+$/.test(patch.branch)) throw new Error("Branch names can use letters, numbers, - _ / and . only.");
    if (s.enabled) await ensureBranch(ws.id, patch.branch);
  }
  return save(ws.id, patch);
}

/** Commit everything that changed. Returns the short sha, or null when there was nothing to commit. */
export async function commitAll(ws: Workspace, message: string, author?: { name: string; email?: string }, paths?: string[]) {
  const s = settingsOf(ws);
  if (!s.enabled || !(await isRepo(ws.id))) return null;
  if (paths && !paths.length) return null;
  await ensureBranch(ws.id, s.branch);
  // With parallel runs, only commit the files this run touched (others commit their own).
  await must(ws.id, paths ? ["add", "-A", "--", ...paths] : ["add", "-A"], "git add");
  if ((await git(ws.id, ["diff", "--cached", "--quiet"])).code === 0) return null;
  const args = ["commit", "-m", message];
  if (author) args.push("--author", `${author.name} <${author.email ?? "agents@luma.local"}>`);
  await must(ws.id, args, "git commit");
  const sha = await must(ws.id, ["rev-parse", "--short", "HEAD"], "git rev-parse");
  publish(ws.id, { kind: "git", workspaceId: ws.id });
  return sha;
}

export async function connectRemote(ws: Workspace, input: { repo?: string; create?: { name: string; private: boolean } }) {
  let s = settingsOf(ws);
  if (!s.enabled) s = await enableGit(ws);
  const root = workspaceRoot(ws.id);
  if (input.create) {
    const name = input.create.name.trim();
    if (!/^[\w.-]+(\/[\w.-]+)?$/.test(name)) throw new Error("Use a repository name like my-site or my-org/my-site.");
    const t = await tools();
    if (!t.gh) throw new Error("Creating a repo needs the GitHub CLI. Install it (brew install gh), run `gh auth login`, then try again.");
    if (!t.ghAuthed) throw new Error("The GitHub CLI isn't signed in. Run `gh auth login` in Terminal, then try again.");
    await git(ws.id, ["remote", "remove", "origin"]);
    const r = await sh(root, "gh", ["repo", "create", name, input.create.private ? "--private" : "--public", "--source", ".", "--remote", "origin", "--description", ws.description || `${ws.name}, built with Luma AI`], 90_000);
    if (r.code !== 0) throw new Error(`Creating the GitHub repo failed: ${r.err.split("\n").slice(-4).join(" ")}`);
  } else {
    let url = input.repo?.trim() ?? "";
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}.git`;
    if (!url) throw new Error("Enter a repository like owner/name or a git URL.");
    const has = (await git(ws.id, ["remote", "get-url", "origin"])).code === 0;
    await must(ws.id, has ? ["remote", "set-url", "origin", url] : ["remote", "add", "origin", url], "Adding the remote");
  }
  const remoteUrl = await must(ws.id, ["remote", "get-url", "origin"], "Reading the remote");
  s = await save(ws.id, { remoteUrl, githubRepo: parseGithub(remoteUrl) });
  // Publish the base branch too, so pull requests have something to target.
  const pushed = await push({ ...ws, git: s }, { includeBase: true });
  return { git: s, ...pushed };
}

export async function push(ws: Workspace, opts: { includeBase?: boolean } = {}) {
  const s = settingsOf(ws);
  if (!s.enabled || !s.remoteUrl) throw new Error("Connect a GitHub repository first.");
  const branches = [...new Set([...(opts.includeBase ? [s.baseBranch] : []), s.branch])];
  for (const b of branches) {
    if ((await git(ws.id, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`])).code !== 0) continue;
    const r = await git(ws.id, ["push", "-u", "origin", `${b}:${b}`], 120_000);
    if (r.code !== 0) {
      const hint = /rejected|non-fast-forward|fetch first/i.test(r.err)
        ? " GitHub has changes Luma doesn't have yet: use “Pull” first."
        : /auth|permission|403|could not read Username/i.test(r.err)
          ? " Git couldn't sign in to GitHub. Run `gh auth login` (and `gh auth setup-git`) in Terminal."
          : "";
      await save(ws.id, { lastError: `Push failed.${hint}` });
      throw new Error(`Push failed: ${r.err.split("\n").slice(-3).join(" ")}${hint}`);
    }
  }
  await save(ws.id, { lastPushAt: new Date().toISOString(), lastError: undefined });
  return { pushed: branches };
}

/** Fast-forward from GitHub (e.g. after you merged a PR or edited on github.com). */
export async function pull(ws: Workspace) {
  const s = settingsOf(ws);
  if (!s.enabled || !s.remoteUrl) throw new Error("Connect a GitHub repository first.");
  const before = await snapshot(ws.id);
  const r = await git(ws.id, ["pull", "--ff-only", "origin", s.branch], 120_000);
  if (r.code !== 0) {
    if (/couldn't find remote ref/i.test(r.err)) return { updated: [] as string[], message: "Nothing on GitHub yet for this branch." };
    throw new Error(`Pull failed: ${r.err.split("\n").slice(-3).join(" ")}${/not possible to fast-forward|diverg/i.test(r.err) ? " Your branch and GitHub have both changed; resolve it in a terminal with git, or open a pull request." : ""}`);
  }
  const updated = await recordChanges(ws.id, before, "user", null);
  if (updated.length) publish(ws.id, { kind: "files_changed", workspaceId: ws.id, paths: updated });
  publish(ws.id, { kind: "git", workspaceId: ws.id });
  return { updated, message: updated.length ? `Updated ${updated.length} file(s).` : "Already up to date." };
}

/** Open (or find) a pull request from the work branch into the base branch. */
export async function openPullRequest(ws: Workspace) {
  const s = settingsOf(ws);
  if (s.branch === s.baseBranch) throw new Error(`Luma commits straight to ${s.baseBranch}. Set a work branch (e.g. luma/agents) to use pull requests.`);
  if (!s.githubRepo) throw new Error("Pull requests need a GitHub repository.");
  const t = await tools();
  if (!t.gh || !t.ghAuthed) throw new Error("Pull requests use the GitHub CLI. Install it (brew install gh) and run `gh auth login`.");
  await push(ws, { includeBase: true });
  const root = workspaceRoot(ws.id);
  const existing = await sh(root, "gh", ["pr", "view", s.branch, "--repo", s.githubRepo, "--json", "url,state", "--jq", "select(.state==\"OPEN\") | .url"]);
  if (existing.code === 0 && existing.out.startsWith("http")) return { url: existing.out, created: false };
  const commits = await git(ws.id, ["log", `${s.baseBranch}..${s.branch}`, "--pretty=format:- %s (%an)"]);
  const n = commits.out ? commits.out.split("\n").length : 0;
  const body = `Work from your Luma AI agents on **${ws.name}**.\n\n${commits.out || "(no commits yet)"}\n\n_Opened by Luma AI._`;
  const r = await sh(root, "gh", ["pr", "create", "--repo", s.githubRepo, "--base", s.baseBranch, "--head", s.branch, "--title", `Luma: ${n} update${n === 1 ? "" : "s"} from your agents`, "--body", body], 60_000);
  if (r.code !== 0) throw new Error(`Opening the pull request failed: ${r.err.split("\n").slice(-3).join(" ")}`);
  return { url: r.out.split("\n").find((l) => l.startsWith("http")) ?? r.out, created: true };
}

export async function gitStatus(ws: Workspace) {
  const s = settingsOf(ws);
  const t = await tools();
  if (!s.enabled || !(await isRepo(ws.id))) return { settings: s, tools: t, repo: false as const };
  const [branch, status, log, ahead] = await Promise.all([
    git(ws.id, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(ws.id, ["status", "--porcelain"]),
    git(ws.id, ["log", "-n", "30", "--pretty=format:%h%x1f%an%x1f%aI%x1f%s"]),
    s.remoteUrl ? git(ws.id, ["rev-list", "--count", `origin/${s.branch}..${s.branch}`]) : Promise.resolve(null),
  ]);
  return {
    settings: s,
    tools: t,
    repo: true as const,
    branch: branch.out,
    uncommitted: status.out ? status.out.split("\n").length : 0,
    unpushed: ahead && ahead.code === 0 ? Number(ahead.out) : null,
    commits: log.out
      ? log.out.split("\n").map((l) => {
          const [sha, author, date, subject] = l.split("\x1f");
          return { sha, author, date, subject };
        })
      : [],
  };
}

/** Called after every agent run: commit what the agent changed (and push if enabled). */
export async function autoCommitRun(ws: Workspace, info: { ticketNumber: number; title: string; agentName: string; agentRole: string; summary?: string; paths: string[] }) {
  const s = settingsOf(ws);
  if (!s.enabled || !s.autoCommit) return null;
  const subject = `LUM-${info.ticketNumber}: ${info.title}`.slice(0, 72);
  const body = [info.summary?.trim().slice(0, 1500), "", `Agent: ${info.agentName} (${info.agentRole})`, `Luma-Ticket: LUM-${info.ticketNumber}`]
    .filter((x) => x !== undefined)
    .join("\n");
  const sha = await commitAll(ws, `${subject}\n\n${body}`, { name: `${info.agentName} (Luma ${info.agentRole})` }, info.paths);
  let pushed = false;
  let pushError: string | undefined;
  if (sha && s.autoPush && s.remoteUrl) {
    try {
      await push(ws);
      pushed = true;
    } catch (err) {
      pushError = err instanceof Error ? err.message : String(err);
    }
  }
  return sha ? { sha, pushed, pushError } : null;
}
