# Luma AI — Phase 6

An agent-driven workspace: describe what you want, and a team of Claude-powered agents plans it, builds it, and reports back through a ticket board, with a built-in code editor and live preview.

This is **Phase 3** of `Luma_AI_Product_Plan.md` (§10): the Phase 1 MVP, Phase 2 multi-agent autopilot, Phase 3 shared memory, diffs, templates gallery and onboarding, Phase 4 sandboxed commands, GitHub sync and one-click deploy, Phase 5 smarter memory, workspace secrets, Postgres + background workers and multi-user sharing, and Phase 6 notifications, insights, email and cloud-ready file storage.

## Quick start

```bash
cd luma-ai
npm install        # also copies the Monaco editor into public/monaco (works offline)
npm run dev        # http://localhost:3000
```

Requires Node 20+. On first launch you'll be asked how to connect Claude:

* **My Claude account** (Pro / Max / Team / Enterprise): agents run through the Claude Agent SDK using the Claude Code login on this computer, and count toward your plan's usage limits. Sign in once with `npx @anthropic-ai/claude-code` → `/login` → "Claude account". Your organization must allow Claude Code for your seat.
* **API key**: paste a key from platform.claude.com → API Keys; usage is billed per token.

Then create a workspace, type a goal, and watch the team work.

## What's in the MVP

| Plan item | Status |
|---|---|
| Claude account connection (guided setup, encrypted key, model list from the API) | ✅ |
| Usage panel (tokens + estimated cost per workspace / agent / ticket, monthly limit) | ✅ |
| Workspaces (blank or landing-page template; multiple supported) | ✅ |
| 4 predefined agents: Project Manager, UI/UX Designer, Frontend Developer, QA Tester | ✅ editable: name, role, tone, model, permissions, system prompt, pause, duplicate |
| Ticket board (Kanban with drag & drop, list view, search, agent filter) | ✅ |
| Ticket detail (fields, labels, sub-tickets, activity log, comments, approve) | ✅ |
| Single-agent ticket execution with Claude tool use | ✅ live streamed to the UI |
| "Describe your goal" → Project Manager splits it into tickets | ✅ |
| Safety: ask-before-done approval, per-ticket token budget, step limit, "Waiting for You" questions, stop button | ✅ |
| Code editor (Monaco) with file tree, tabs, save, create/rename/delete | ✅ |
| Live preview (desktop / tablet / mobile widths), simple mode | ✅ |
| Version history: every change is a checkpoint, one-click undo | ✅ (pulled forward from Phase 3) |
| "Ask an agent" about selected code | ✅ |
| Automatic agent-to-agent handoff (`handoff_ticket`) | ✅ Phase 2 |
| Approval modes: step-by-step / auto with review / fully autonomous | ✅ Phase 2 |
| Loop protection: handoff caps, ping-pong guard, sub-ticket depth, per-run ticket cap, hourly circuit breaker | ✅ Phase 2 |
| Parallel runs (1–4 per workspace), ticket dependencies, optimistic file locking | ✅ Phase 2 |
| All 9 predefined agents, custom agent builder ("Draft with Claude"), agent library | ✅ Phase 2 |
| Web research permission (server web search / Claude Code WebSearch) | ✅ Phase 2 |
| Shared team memory (`remember` / `recall`, Memory page, pinned items in every briefing) | ✅ Phase 3 |
| Diff view per change and per ticket (unified + side-by-side), undo one change or a whole ticket | ✅ Phase 3 |
| Templates gallery: 9 starters with live thumbnails, suggested first goal, template-specific agents | ✅ Phase 3 |
| Onboarding tour (first visit + compass button in the sidebar) | ✅ Phase 3 |
| Sandboxed commands (`run_command`) + live Terminal panel | ✅ Phase 4 |
| GitHub sync: commit per agent run, push, pull, pull requests | ✅ Phase 4 |
| One-click deploy: Netlify, Vercel, GitHub Pages, ZIP (Flutter via `flutter build web`) | ✅ Phase 4 |
| Real-Claude smoke test script (`npm run smoke`) | ✅ Phase 4 |
| Smarter memory: local embeddings, dedupe, review of agent proposals | ✅ Phase 5 |
| Workspace secrets (encrypted env vars, redacted from agents) | ✅ Phase 5 |
| Postgres storage, durable runs that resume after restarts, background workers | ✅ Phase 5 |
| Multi-user: sign-in, invites, workspace roles, per-user activity | ✅ Phase 5 |
| Notifications: inbox + bell, @mentions, desktop alerts | ✅ Phase 6 |
| Insights dashboard (runs, reliability, speed, tokens, per agent) | ✅ Phase 6 |
| Email (SMTP): invites, password reset, instant + daily digest notifications | ✅ Phase 6 |
| Cloud-ready file storage: workspace files + history in Postgres, synced to each host | ✅ Phase 6 |

## Mobile apps in the iOS Simulator (Mac only)

Choose the **Mobile app (Flutter)** template when you create a workspace. Agents write Dart code, and Luma runs it in the iOS Simulator and mirrors the screen in a phone frame on the Overview and Code & Preview pages.

* **Requirements:** Xcode (open it once, install an iOS simulator) and Flutter. `flutter --version` must work, or set `LUMA_FLUTTER=/path/to/flutter`.
* **First run:** `flutter create` generates the `ios/` project, then the app builds. The first build takes a few minutes; later changes hot-reload in about a second.
* **Automatic:** when an agent finishes a ticket, the app starts or hot-reloads. Editing a `.dart` file hot-reloads it. Changing `pubspec.yaml` restarts the app.
* **Build errors** are posted to the ticket, so running the agent again tells it what to fix.
* **Interaction:** the preview inside Luma is view-only. Click the window icon to open the real Simulator window to tap and scroll.
* Implementation: `src/lib/simulator.ts` (`xcrun simctl` + a long-running `flutter run` process).

## How the agent engine works

```
UI ── POST /api/tickets/:id/run ──► orchestrator.startRun()  (background)
                                       │
                         ┌─────────────┴───────────────┐
                         │ loop (≤30 turns, token budget)│
                         │  Claude messages.create       │
                         │  ↳ tool_use → run tool        │
                         │  ↳ record usage + events      │
                         └─────────────┬───────────────┘
UI ◄── SSE /api/workspaces/:id/stream ◄─ bus.publish(live events)
```

* `src/lib/engine/orchestrator.ts`: runs one agent on one ticket and ends on `finish_ticket`, `ask_user`, the budget, or the step limit.
* `src/lib/engine/tools.ts`: `list_files`, `read_file`, `write_file`, `delete_file`, `create_ticket`, `add_comment`, `ask_user`, `finish_ticket`, each gated by the agent's permissions.
* `src/lib/engine/scheduler.ts`: autopilot. `kick(workspaceId)` starts queued tickets whose dependencies are Done/In Review, up to `maxParallelRuns`, one ticket per agent, with an hourly circuit breaker.
* `src/lib/presets.ts`: the nine agents' role prompts, the default team per template, plus the shared team rules.

### Phase 8: VS Code-style IDE + code review
- **Code** page is now a VS Code-style workbench: menu bar, command center, activity bar, Explorer (with Open Editors and Timeline), Search (find/replace across files, regex/case/word, include/exclude), Source Control (stage, unstage, discard, commit, push/pull, graph), tabs with preview mode, split editors, breadcrumbs, Problems/Output/Terminal/Comments panel and a status bar.
- **Same keyboard shortcuts as VS Code** (Ctrl/Cmd+P, Ctrl/Cmd+Shift+P, Ctrl/Cmd+B, Ctrl/Cmd+J, Ctrl+`, Ctrl/Cmd+K Ctrl/Cmd+T…). Close Editor is Alt+W because browsers reserve Ctrl+W.
- **Settings use VS Code's names** (`editor.fontSize`, `files.autoSave`, `workbench.colorTheme`…): Settings UI, `settings.json`, import your VS Code settings.json, Keyboard Shortcuts list, themes Dark/Light Modern, Dark+/Light+, High Contrast.
- **Code Review**: every agent ticket is a change set. Side-by-side diffs, revert single changes, Viewed checkboxes, Reject a file, line comments (click + in the gutter), Approve (ticket → Done) or Request Changes (comments are sent to the agent, which starts again), and AI review on demand that posts line comments.
- Unsaved edits survive leaving the page (kept in the browser). Simple mode still shows only the live result.

### Phase 7: everything in one box
- **Landing page** at `/welcome`; signed-out visitors land there, deep links go to sign-in and come back (open-redirect safe).
- **Settings hub** with tabs: Claude & models, Profile, Team, Integrations, Email, Usage & limits, System.
- **GitHub without a terminal**: paste a personal access token in Settings → Integrations; Luma creates repos, pushes, opens PRs and enables Pages through the GitHub API (the `gh` CLI is now optional).
- **Claude subscription token** can be pasted during setup and is stored encrypted, so agents don't depend on a terminal login.
- **System tab** (admins): server diagnostics, one-click install of optional components (pg, nodemailer, transformers), tool checks, server configuration written to `.env.local`, database connection test, pin the encryption secret, and restart Luma from the browser.
- **Security**: the live preview runs in a sandboxed origin (CSP `sandbox`) with a signed, workspace-scoped token, so agent-written pages can't call Luma's API as you; tickets can only reference agents and tickets from their own workspace.
- **Polish**: in-app dialogs and toasts instead of browser pop-ups, 404 page, favicon, page titles, keyboard focus rings.

### Phase 6: notifications, insights, email, cloud files

* **Notifications** (`src/lib/notifications.ts`, bell in the sidebar). Per-person inbox: an agent needs your answer, a handoff to approve, ready for review, a run failed, @mentions in comments (`@Ana`), proposed team memories, deploys, autopilot paused. Owners/editors are notified (viewers only for mentions), never the person who caused it; repeats within 30 min are merged. Click opens the ticket (`/w/<id>/board?ticket=<id>`). Optional desktop alerts. In single-user mode everything goes to you.
* **Insights** (`src/lib/metrics.ts`, `/w/<id>/insights`): runs, completion rate, tickets done and median time to Done / first review, typical run length, tokens and cost, checks passed, handoffs/questions, daily runs + tokens charts (with a table view), and a per-agent table. 7 / 30 / 90 days.
* **Email** (`src/lib/mail.ts`, Settings → Email, optional `nodemailer`): any SMTP provider (presets for Google Workspace, Microsoft 365, SendGrid, Postmark) or `LUMA_SMTP_URL` + `LUMA_MAIL_FROM` + `LUMA_APP_URL`. Sends invite emails, password reset links (`/forgot` → `/reset/<token>`, one hour, one use, signs out other sessions), and notifications: important ones right away (questions, approvals, failures, mentions) or a daily digest, per person (Settings → Profile). Admins can also create a reset link for anyone (Team table, key icon) when email isn't set up.
* **Cloud-ready files** (`src/lib/fileMirror.ts`): with Postgres, workspace files and checkpoint blobs are stored in `luma_files` / `luma_blobs`; each process keeps a local working copy, pushes every change with a version number and pulls newer versions before reading (every 2 s, or immediately after a NOTIFY from another host). Fresh hosts download on first use; existing disk-only workspaces are uploaded once at start-up. Commands and git pulls sync what they change. A missing `.git` is rebuilt from the GitHub remote. `LUMA_FILES=disk` turns it off. **Every process must share the same `LUMA_SECRET`** (it encrypts API keys, tokens, secrets and the SMTP password). This lets the UI run on a host without a persistent disk (e.g. `LUMA_DATA_DIR=/tmp/luma`) while workers run agents elsewhere.

### Phase 5: memory, secrets, Postgres + workers, multi-user

* **Smarter memory** (`src/lib/embeddings.ts`, `src/lib/memory.ts`). Recall blends embedding similarity (65%) with keyword overlap (35%). Embeddings: all-MiniLM-L6-v2 via the optional `@huggingface/transformers` package (model downloads once into `.luma/models`), else a built-in n-gram vectoriser (plurals, UK/US spelling, typos). `LUMA_EMBEDDINGS=auto|minilm|ngram`. An agent saving something very close to an existing memory updates it instead of adding a copy; Memory → "Find duplicates" suggests merges. Review mode (Memory page): agents' decisions & conventions (default), everything, or nothing wait for your approval; agents still see proposals, marked as such; proposed changes to approved memories show old vs new.
* **Workspace secrets** (`src/lib/secrets.ts`, Ship page → Secrets). Encrypted per-workspace env vars. Injected into sandboxed commands as environment variables and into Flutter web builds as `--dart-define`; agents only see the names (briefing tells them to reference by name); values are replaced with `[secret NAME]` in command output, streamed output and `read_file` results.
* **Postgres + workers** (`src/lib/store.ts`, `storePg.ts`, `runtime.ts`, `role.ts`, `src/instrumentation.ts`). Set `LUMA_DATABASE_URL=postgres://…` and `npm install pg`; on first start the JSON database is imported. Each process keeps the DB in memory and writes through (advisory lock → catch up from a change log → upsert changed records → NOTIFY). Runs are recorded in `db.runs` with heartbeats; if a process dies mid-run, the run is resumed automatically (up to 2 times) — also in plain JSON mode after a restart. Split processes: `npm run start:web` (UI only, `LUMA_ROLE=web`) + one or more `npm run worker` (`LUMA_ROLE=worker`); live events cross processes over `NOTIFY luma_live`, and Stop works across processes. Keep the iOS Simulator preview on a single `npm start` (role "all") process.
* **Multi-user** (`src/lib/auth.ts`, `invites.ts`). Single-user until an admin turns on sign-in (Settings → Team). Then: email + password (scrypt), 30-day httpOnly session cookie, invite links (7 days, one use; Luma doesn't send email), admins vs members, and workspace roles owner / editor / viewer (Share button on a workspace). Every API route is authorised centrally in `handle()` from the request path (viewer = read, editor = change, owner = share/delete; Settings writes, usage and user management are admin-only); preview, live stream and simulator routes are guarded too. Ticket activity shows which person did what. `npm run smoke` takes `LUMA_EMAIL` / `LUMA_PASSWORD` when sign-in is on.

### Phase 4: commands, GitHub, deploy

* **Sandboxed commands** (`src/lib/commands.ts`). Agents with the new `run_commands` permission (Sara, Nadia, Ravi, Theo, Omar by default) call `run_command`; you can run the same commands from the Terminal panel in Code & Preview. Layers: no shell (argv only), allowlist (flutter/dart/npm/npx linters/git read-only/ls/grep…, plus your "extra allowed commands" per workspace), arguments can't point outside the project, scrubbed env, timeout (default 180 s, max 600 s), one command at a time per workspace, and an OS sandbox: `sandbox-exec` on macOS (no writes outside the project and tool caches; no reads of ~/.ssh, ~/.aws, ~/.claude, gh config, keychains or Luma's data), `bwrap` on Linux. `node`/`python3` are only allowed inside the OS sandbox. Files a command changes get checkpoints (diff + undo). Existing teams: Workspace settings → "Give developers & QA the Run commands permission".
* **GitHub sync** (`src/lib/git.ts`, Ship page). The workspace folder becomes a git repo. After every agent run Luma commits exactly the files that run changed, authored as the agent ("Sara (Luma Frontend Developer)") with the ticket summary; optional auto-push. Connect a repo (create with `gh repo create`, or any existing URL), push, pull (fast-forward; pulled changes get checkpoints), and pull-request mode (agents commit to `luma/agents`, "Open pull request" uses `gh pr create`). Uses your own git credentials and `gh` login.
* **Deploy** (`src/lib/deploy.ts`, Ship page). Netlify (zip deploy API) and Vercel (inline files API) with tokens saved encrypted in Settings → Deploy accounts; GitHub Pages (pushes a `gh-pages` branch, enables Pages via `gh api`); or a ZIP download. Redeploys reuse the same site. Pre-deploy checks: index.html present, size limit, broken local links reported as warnings. Flutter workspaces deploy a `flutter build web` build. `LUMA_NETLIFY_API` / `LUMA_VERCEL_API` point at mock servers for testing.
* **Smoke test**: with Luma running, `npm run smoke -- web` (or `flutter`) creates a workspace, sends a goal, lets autopilot run, and writes `smoke-report-*.md`.
* **Prompt tuning from real runs**: briefings now include "Recently finished by the team" (stops QA reporting already-built features), shared rules require wiring new files into the app and verifying with commands, the PM writes how each ticket connects to the app, and the per-run token budget counts cache reads at 10%.

### Phase 3: memory, diffs, templates, tour

* **Shared memory** (`src/lib/memory.ts`, `db.memories`). Agents call `remember(kind, title, content)` (same title = update) and `recall(query)`. Every briefing gets a "Team memory" section: pinned items first, then the most relevant by keyword overlap with the ticket, within ~6k chars. Users manage it on the Memory page or with "Remember" in the ticket comment box (saved as a preference). Kinds: decision, convention, preference, fact, note. Cap: 200 per workspace.
* **Diffs** (`src/lib/diff.ts`, `GET /api/workspaces/:id/diff`). `?checkpointId=` one change; `?ticketId=&path=` combined change a ticket made to a file; `?ticketId=` per-file +/− summary. `POST /checkpoints {ticketId, path?}` undoes a whole ticket. UI: "Changes" section in the ticket panel, `DiffModal` (unified with collapsed context, or Monaco side-by-side), "Diff" in editor history.
* **Templates gallery** (`src/lib/templates-gallery.ts`, `GET /api/templates`): portfolio, blog, restaurant/local business, admin dashboard, docs site, event page (plus blank, landing, Flutter). Templates can add agents (`extraAgents`) and suggest a first goal that's sent to the PM on create.
* **Onboarding tour** (`src/components/Tour.tsx`): spotlights elements marked `data-tour="…"` across Overview → Board → Agents → Memory → Editor. Shown once per browser (localStorage), replay with the compass button.

### Phase 2: autopilot

* **Handoff.** An agent calls `handoff_ticket(to_role, note)` when the same ticket needs a teammate next. Outside manual mode the ticket is reassigned and queued; in manual mode it becomes a "Waiting for You" approval (`POST /api/tickets/:id/handoff {action}`).
* **Planned work runs itself.** `create_ticket` accepts `depends_on` (ticket numbers). Agent-created tickets are queued automatically (except in manual mode) and start once their dependencies finish.
* **Approval modes** (`workspace.approvalMode`): `manual`, `ask_before_done` (default), `automatic`.
* **Loop protection** (constants in `tools.ts` / `scheduler.ts`): ≤6 handoffs per ticket, ≤2 between the same pair of agents, sub-tickets deeper than 3 levels are never auto-started, ≤10 tickets created per run, and autopilot pauses itself after 40 automatic starts in an hour.
* **Parallel runs.** `startRun()` queues instead of failing when all slots are busy or the agent is busy. Writes use optimistic locking: an agent must have read the current version of an existing file in its run, otherwise the write is refused and it is told who changed the file.
* **Agent library.** `GET/POST /api/library`, `PATCH/DELETE /api/library/:id`; add agents to a workspace with `{presetKey}`, `{libraryId}` or builder fields. `POST /api/agents/draft` drafts an agent from a sentence (one-shot completion via `lib/oneshot.ts`, works with API key or Claude account).
* `src/lib/store.ts`: a JSON-file database in `.luma/` behind `read()`/`mutate()`. Swap this module for Postgres/Prisma later without touching the rest.
* `src/lib/files.ts`: per-workspace files plus content-addressed checkpoint blobs.
* `src/lib/bus.ts`: in-process pub/sub. Replace it with Redis when moving runs to BullMQ workers.

## Project layout

```
src/
  app/
    setup/            guided Claude connection
    settings/         key, default model, usage
    w/[id]/           overview, board, agents, editor (+ ticket side panel)
    preview/[wsId]/   serves workspace files to the preview iframe
    api/…             REST + SSE endpoints
  components/         AppShell, TicketPanel, modals, UI primitives
  lib/                types, store, crypto, files, repo, anthropic, engine/
```

## Configuration

Optional settings go in `.env.local` (see `.env.example`):

* `LUMA_DATA_DIR`: where data is stored (default `./.luma`).
* `LUMA_SECRET`: the secret used to encrypt your API key. If you leave it unset, one is generated in `.luma/secret.key`.
* `ANTHROPIC_BASE_URL`: points the SDK at a proxy or mock server.

Cost figures are **estimates** that use family-level prices in `src/lib/anthropic.ts`. Update them to match current pricing.

## Notes

* Generated sites are plain HTML/CSS/JS so the preview works with no build step. Change a workspace's tech stack in Workspace settings.
* Data is local and single-user. Auth (Supabase/Clerk) and Postgres come with multi-user support.
* "Luma AI" is already used by another company (plan §11), so pick a final name before you launch publicly.
