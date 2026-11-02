// Shared domain types for Luma AI (mirrors the data model in the product plan §9).

export type TicketStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "waiting_for_user"
  | "done"
  | "blocked"
  | "failed";

export const TICKET_STATUSES: { id: TicketStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "in_review", label: "In Review" },
  { id: "waiting_for_user", label: "Waiting for You" },
  { id: "done", label: "Done" },
  { id: "blocked", label: "Blocked" },
  { id: "failed", label: "Failed" },
];

export type Priority = "low" | "medium" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

export const LABELS = ["feature", "bug", "design", "content"] as const;
export type Label = (typeof LABELS)[number];

export type Permission =
  | "read_files"
  | "edit_files"
  | "create_files"
  | "create_tickets"
  | "close_tickets"
  | "web_research"
  | "run_commands";

export const PERMISSIONS: { id: Permission; label: string; hint: string }[] = [
  { id: "read_files", label: "Read files", hint: "Look at the project's files" },
  { id: "edit_files", label: "Edit files", hint: "Change or delete existing files" },
  { id: "create_files", label: "Create files", hint: "Add new files" },
  { id: "create_tickets", label: "Create tickets", hint: "Split work into new tickets" },
  { id: "close_tickets", label: "Close tickets", hint: "Mark tickets Done without your review" },
  { id: "web_research", label: "Search the web", hint: "Look things up online (web search)" },
  { id: "run_commands", label: "Run commands", hint: "Run safe project commands like tests, analyzers and formatters" },
];

export type AuthMode = "api_key" | "claude_account";

export interface ClaudeAccount {
  email?: string;
  organization?: string;
  subscriptionType?: string;
}

export interface Settings {
  /** How agents reach Claude. Default: api_key (for older data files). */
  authMode?: AuthMode;
  claudeAccount?: ClaudeAccount;
  encryptedApiKey?: string;
  apiKeyHint?: string; // e.g. "sk-ant-…a1b2"
  defaultModel?: string;
  monthlyLimitUsd?: number;
  /** Phase 6: outgoing email (SMTP). Password encrypted. */
  email?: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
  /** Phase 6: public address of this Luma, used in email links (e.g. https://luma.studio93.io). */
  appUrl?: string;
  /** Encrypted GitHub token (fine-grained or classic PAT) used for push, repos, PRs and Pages. */
  githubToken?: string;
  githubUser?: string;
  /** Encrypted Claude subscription token (from `claude setup-token`), for servers without a Claude Code login. */
  claudeOauthToken?: string;
  /** Encrypted deploy tokens (Phase 4). */
  deployTokens?: { netlify?: string; vercel?: string };
}

/**
 * Approval modes (Phase 2):
 * - manual: nothing starts on its own; every handoff waits for your OK; finished work waits for review.
 * - ask_before_done: handoffs and planned tickets run automatically; finished work waits for your review.
 * - automatic: fully autonomous; agents with "Close tickets" mark their own work Done.
 */
export type ApprovalMode = "manual" | "ask_before_done" | "automatic";

export const APPROVAL_MODES: { id: ApprovalMode; label: string; hint: string }[] = [
  { id: "manual", label: "Ask me at every step", hint: "Nothing starts on its own. You approve each handoff and run each ticket yourself." },
  { id: "ask_before_done", label: "Run automatically, ask before Done", hint: "Agents pass work along and start planned tickets on their own. You review finished work." },
  { id: "automatic", label: "Fully autonomous", hint: "Like above, and agents with “Close tickets” mark their own work Done." },
];

export interface GitSettings {
  enabled: boolean;
  /** Branch Luma commits to. "main" = push straight to main; anything else = pull-request mode. */
  branch: string;
  baseBranch: string;
  /** Commit automatically after every agent run that changed files. */
  autoCommit: boolean;
  /** Push automatically after each commit (needs a remote). */
  autoPush: boolean;
  remoteUrl?: string;
  /** "owner/repo" when the remote is on GitHub. */
  githubRepo?: string;
  lastPushAt?: string;
  lastError?: string;
}

export type DeployProvider = "netlify" | "vercel" | "github_pages" | "zip";

export interface DeployTarget {
  provider: DeployProvider;
  siteId?: string;
  siteName?: string;
  url?: string;
}

export interface Deploy {
  id: string;
  workspaceId: string;
  provider: DeployProvider;
  status: "building" | "ready" | "error";
  url?: string;
  /** Unique URL for this deploy (when the provider gives one). */
  deployUrl?: string;
  error?: string;
  warnings: string[];
  fileCount: number;
  commit?: string;
  createdAt: string;
  finishedAt?: string;
}

/** Phase 5: an encrypted environment variable for the app being built (never shown to agents). */
export interface Secret {
  id: string;
  workspaceId: string;
  name: string;
  /** AES-256-GCM encrypted value. */
  value: string;
  /** Last 4 characters, for recognising it in the UI. */
  hint: string;
  updatedAt: string;
}

/** Phase 5 multi-user. With no users, Luma runs in single-user mode (no sign-in). */
export interface User {
  id: string;
  email: string;
  name: string;
  /** scrypt$salt$hash */
  passwordHash: string;
  /** Admins manage Luma (Settings, users) and can open every workspace. */
  role: "admin" | "member";
  createdAt: string;
  lastSeenAt?: string;
  /** Phase 6: email notifications: off, right away (important ones), or a daily digest. */
  notifyEmail?: "off" | "instant" | "daily";
  lastDigestAt?: string;
}

/** Phase 6: something that needs a person's attention. userId is "local" in single-user mode. */
export type NotificationKind = "waiting" | "review" | "failed" | "approval" | "mention" | "memory_review" | "deploy" | "autopilot" | "invite";

export interface Notification {
  id: string;
  userId: string;
  workspaceId: string;
  ticketId?: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  /** In-app path to open, e.g. /w/ws_x/board?ticket=tk_y */
  link: string;
  readAt?: string | null;
  emailedAt?: string | null;
  createdAt: string;
}

/** Phase 6: password reset tokens (sha256), valid one hour. */
export interface PasswordReset {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface Session {
  /** sha256 of the cookie token. */
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface Invite {
  /** sha256 of the invite token. */
  id: string;
  email: string;
  role: "admin" | "member";
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
}

/** Phase 5: a durable record of an agent run, shared by every Luma process (web + workers). */
export interface RunRecord {
  id: string;
  ticketId: string;
  workspaceId: string;
  agentId: string;
  /** Process that executes it: "host:pid:nonce". */
  workerId: string;
  status: "running" | "finished" | "failed" | "cancelled" | "interrupted";
  cancelRequested?: boolean;
  startedAt: string;
  heartbeatAt: string;
  finishedAt?: string;
}

export interface CommandRun {
  id: string;
  workspaceId: string;
  ticketId: string | null;
  actor: string;
  command: string;
  status: "running" | "ok" | "failed" | "refused" | "timeout";
  exitCode: number | null;
  output: string;
  durationMs: number;
  changedFiles: string[];
  sandboxed: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string; // emoji
  description: string;
  template: string;
  techStack: string;
  /** "web" (static site, browser preview) or "flutter" (mobile app, iOS Simulator preview). */
  platform?: "web" | "flutter";
  /** iOS Simulator device chosen for this workspace. */
  simulatorUdid?: string;
  /** Rebuild / hot-reload the simulator automatically when agents change code. */
  autoRunSimulator?: boolean;
  approvalMode: ApprovalMode;
  /** How many agents may work at the same time in this workspace (1–4). Default 2. */
  maxParallelRuns?: number;
  /** Autopilot = Luma starting queued tickets and handoffs on its own. */
  autopilotPaused?: boolean;
  /** Why autopilot was paused automatically (loop protection), shown as a banner. */
  autopilotNote?: string;
  /** Phase 5: who can open this workspace (ignored in single-user mode; admins see everything). */
  members?: { userId: string; role: WorkspaceRole }[];
  /** Phase 5: which agent memories need your approval. Default "conventions". */
  memoryReview?: "off" | "conventions" | "all";
  /** Phase 4: let agents with "Run commands" run allowlisted commands. Default true. */
  commandsEnabled?: boolean;
  /** Extra command prefixes you allow, e.g. "make test" or "python3". */
  extraCommands?: string[];
  /** Phase 4: Git / GitHub sync for this workspace. */
  git?: GitSettings;
  /** Phase 4: where this workspace deploys to. */
  deploy?: DeployTarget;
  ticketBudgetTokens: number;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  presetKey?: string;
  name: string; // display name, e.g. "Sara"
  role: string; // e.g. "Frontend Developer"
  avatar: string; // emoji
  color: string; // tailwind-ish hex for the avatar chip
  description: string;
  tone: string;
  systemPrompt: string;
  model: string; // "" = use default model
  permissions: Permission[];
  paused: boolean;
  isPredefined: boolean;
  createdAt: string;
}

export interface Handoff {
  fromAgentId: string;
  toAgentId: string;
  note: string;
  at: string;
}

export interface Ticket {
  id: string;
  number: number; // per-workspace sequence, shown as LUM-12
  workspaceId: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  labels: Label[];
  assigneeId: string | null;
  parentId: string | null;
  createdBy: string; // "user" or agent id
  createdAt: string;
  updatedAt: string;
  /** Waiting for the scheduler to start it automatically (autopilot). */
  queued?: boolean;
  /** Ticket ids that must be finished (Done or In Review) before this one auto-starts. */
  dependsOn?: string[];
  /** Every handoff this ticket went through, oldest first (loop protection uses this). */
  handoffs?: Handoff[];
  /** A handoff proposed by an agent, waiting for your approval (manual mode). */
  pendingHandoff?: Handoff | null;
  /** 0 for tickets you create; +1 for each generation of agent-created sub-tickets. */
  chainDepth?: number;
  /** Start even if dependencies aren't finished (you pressed Run, or a run is being resumed). */
  forceStart?: boolean;
  /** How many times an interrupted run was resumed automatically. */
  resumeCount?: number;
  /** Code review state (IDE review panel). */
  review?: TicketReview;
}

export interface TicketReview {
  /** Files the reviewer marked as viewed / accepted. */
  viewed?: string[];
  verdict?: "approved" | "changes_requested";
  by?: string;
  at?: string;
}

export interface ReviewComment {
  id: string;
  /** User id, "user" (single-user mode) or "reviewer" (AI review). */
  author: string;
  authorName: string;
  text: string;
  createdAt: string;
}

/** A line comment thread, like a pull-request review comment. */
export interface ReviewThread {
  id: string;
  workspaceId: string;
  path: string;
  /** 1-based line in the file when the thread was created. */
  line: number;
  /** Text of that line, used to re-anchor the thread when the file changes. */
  lineText: string;
  ticketId: string | null;
  status: "open" | "resolved";
  severity?: "info" | "warning" | "error";
  comments: ReviewComment[];
  createdAt: string;
  updatedAt: string;
}

export type TicketEventType =
  | "created"
  | "comment"
  | "status_change"
  | "assignment"
  | "agent_message"
  | "tool_call"
  | "file_change"
  | "question"
  | "summary"
  | "handoff"
  | "approval"
  | "command"
  | "commit"
  | "error";

export interface TicketEvent {
  id: string;
  ticketId: string;
  actor: string; // "user" | "system" | agent id
  type: TicketEventType;
  content: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export interface Checkpoint {
  id: string;
  workspaceId: string;
  path: string;
  /** Blob id of the content *before* this change (null = file did not exist). */
  beforeBlob: string | null;
  /** Blob id of the content *after* this change (null = file deleted). */
  afterBlob: string | null;
  actor: string;
  ticketId: string | null;
  /** Phase 5: which signed-in person made a "user" change. */
  userId?: string;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  workspaceId: string;
  agentId: string;
  ticketId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

/** Shared memory (Phase 3): durable team knowledge every agent sees in its briefing. */
export type MemoryKind = "decision" | "convention" | "preference" | "fact" | "note";

export const MEMORY_KINDS: { id: MemoryKind; label: string; hint: string; emoji: string }[] = [
  { id: "decision", label: "Decision", hint: "Something the team decided (palette, layout, library…)", emoji: "🧭" },
  { id: "convention", label: "Convention", hint: "How things are done here (file structure, naming, style)", emoji: "📐" },
  { id: "preference", label: "Preference", hint: "What you like or don't like", emoji: "💜" },
  { id: "fact", label: "Fact", hint: "Facts about the business, audience or product", emoji: "📌" },
  { id: "note", label: "Note", hint: "Anything else worth remembering", emoji: "📝" },
];

export interface Memory {
  id: string;
  workspaceId: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  /** "user" or the agent id that last wrote it. */
  authorId: string;
  ticketId: string | null;
  /** Pinned memories are always included in every agent's briefing. */
  pinned: boolean;
  /** Phase 5 memory review: "proposed" = an agent suggested it and it waits for your approval. */
  status?: "active" | "proposed";
  /** An agent's suggested new content for an approved memory, waiting for review. */
  proposal?: { content: string; authorId: string; ticketId: string | null; at: string } | null;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: string;
  updatedAt: string;
}

/** An agent saved to the cross-workspace library (custom agent builder). */
export interface LibraryAgent {
  id: string;
  name: string;
  role: string;
  avatar: string;
  color: string;
  description: string;
  tone: string;
  systemPrompt: string;
  model: string;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export interface DB {
  version: 1;
  settings: Settings;
  workspaces: Workspace[];
  agents: Agent[];
  tickets: Ticket[];
  events: TicketEvent[];
  checkpoints: Checkpoint[];
  usage: UsageRecord[];
  library: LibraryAgent[];
  memories: Memory[];
  commandRuns: CommandRun[];
  deploys: Deploy[];
  secrets: Secret[];
  runs: RunRecord[];
  users: User[];
  sessions: Session[];
  invites: Invite[];
  notifications: Notification[];
  resets: PasswordReset[];
  reviewThreads: ReviewThread[];
}

/** Live events streamed to the UI while an agent works. */
export type LiveEvent =
  | { kind: "run_started"; ticketId: string; agentId: string }
  | { kind: "text"; ticketId: string; text: string }
  | { kind: "tool"; ticketId: string; name: string; summary: string }
  | { kind: "event"; ticketId: string; event: TicketEvent }
  | { kind: "ticket"; ticket: Ticket }
  | { kind: "files_changed"; workspaceId: string; paths: string[] }
  | { kind: "run_finished"; ticketId: string; status: TicketStatus }
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "memory"; workspaceId: string }
  | { kind: "command"; run: CommandRun }
  | { kind: "command_output"; runId: string; chunk: string }
  | { kind: "deploy"; deploy: Deploy }
  | { kind: "git"; workspaceId: string }
  | { kind: "review"; workspaceId: string }
  | { kind: "notification"; userIds: string[] }
  | { kind: "run_error"; ticketId: string; message: string };
