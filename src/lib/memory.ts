import "server-only";
import { mutate, newId, now, read } from "./store";
import { publish } from "./bus";
import { cosine, getEmbedder, stem } from "./embeddings";
import { MEMORY_KINDS, type Memory, type MemoryKind, type Ticket } from "./types";

/**
 * Shared memory: a small per-workspace knowledge base that agents write with `remember`,
 * search with `recall`, and see in every briefing.
 *
 * Phase 5:
 * - Hybrid recall: embedding similarity (local MiniLM or built-in n-grams, see embeddings.ts)
 *   blended with keyword overlap.
 * - Dedupe: an agent saving something that closely matches an existing memory updates that
 *   memory instead of creating a near-copy. The Memory page lists likely duplicates to merge.
 * - Review: depending on `workspace.memoryReview`, decisions/conventions (or everything) that
 *   agents propose wait for your approval. Agents still see proposals, marked as such.
 */

export const MAX_MEMORIES = 200;
export const MAX_CONTENT = 2000;
const BRIEFING_CHARS = 6000;

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were will with you your we our i me my what which who how does do use using should".split(" "),
);

export function tokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9#]+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const KINDS = MEMORY_KINDS.map((k) => k.id);
const memText = (m: Pick<Memory, "kind" | "title" | "content" | "tags">) => `${m.title}. ${m.content} ${m.tags.join(" ")} (${m.kind})`;

/** Keyword overlap score (0…∞): title hits count 3, body 1, prefix matches 0.5. */
export function score(m: Memory, queryTokens: string[]) {
  if (!queryTokens.length) return 0;
  const title = new Set(tokens(m.title));
  const body = new Set(tokens(`${m.content} ${m.tags.join(" ")} ${m.kind}`));
  let s = 0;
  for (const q of new Set(queryTokens)) {
    if (title.has(q)) s += 3;
    else if (body.has(q)) s += 1;
    else if ([...title, ...body].some((w) => w.startsWith(q) || q.startsWith(w))) s += 0.5;
  }
  return s;
}

export async function listMemories(workspaceId: string) {
  const db = await read();
  return db.memories
    .filter((m) => m.workspaceId === workspaceId)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Make sure every memory in the workspace has an embedding from the current model (lazy backfill). */
async function withEmbeddings(workspaceId: string) {
  const emb = await getEmbedder();
  const all = await listMemories(workspaceId);
  const stale = all.filter((m) => m.embeddingModel !== emb.model || !m.embedding?.length);
  if (stale.length) {
    const vecs = await emb.embed(stale.map(memText));
    const byId = new Map(stale.map((m, i) => [m.id, vecs[i]]));
    await mutate((db) => {
      for (const m of db.memories) {
        const v = byId.get(m.id);
        if (v) {
          m.embedding = v;
          m.embeddingModel = emb.model;
        }
      }
    });
    for (const m of stale) {
      m.embedding = byId.get(m.id);
      m.embeddingModel = emb.model;
    }
  }
  return { emb, all };
}

/** Rank memories for a query: 65% semantic similarity + 35% keyword overlap. */
async function rank(workspaceId: string, query: string) {
  const { emb, all } = await withEmbeddings(workspaceId);
  const [qv] = await emb.embed([query]);
  const qt = tokens(query);
  const kw = all.map((m) => score(m, qt));
  const maxKw = Math.max(1, ...kw);
  return all
    .map((m, i) => ({ m, sim: cosine(qv, m.embedding ?? []), s: 0.65 * cosine(qv, m.embedding ?? []) + 0.35 * (kw[i] / maxKw) }))
    .sort((a, b) => b.s - a.s);
}

export async function searchMemories(workspaceId: string, query: string, limit = 10) {
  if (!query.trim()) return (await listMemories(workspaceId)).slice(0, limit);
  const ranked = await rank(workspaceId, query);
  return ranked
    .filter((x) => x.s > 0.12)
    .slice(0, limit)
    .map((x) => x.m);
}

/** Pairs of memories that probably say the same thing. */
export async function findDuplicates(workspaceId: string) {
  const { emb, all } = await withEmbeddings(workspaceId);
  const pairs: { a: Memory; b: Memory; similarity: number }[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const sim = cosine(all[i].embedding ?? [], all[j].embedding ?? []);
      if (sim >= emb.suggestThreshold) pairs.push({ a: all[i], b: all[j], similarity: Math.round(sim * 100) / 100 });
    }
  return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, 30);
}

export type UpsertResult = { memory: Memory; created: boolean; mergedInto?: string; pending: boolean };

/**
 * Create a memory, or update the existing one with the same title (case-insensitive) or, for
 * agents, a near-identical one. Agent writes may land as proposals depending on the review mode.
 */
export async function upsertMemory(input: {
  workspaceId: string;
  kind?: string;
  title: string;
  content: string;
  tags?: string[];
  authorId: string;
  ticketId?: string | null;
  pinned?: boolean;
}): Promise<UpsertResult> {
  const title = input.title.trim().slice(0, 120);
  const content = input.content.trim().slice(0, MAX_CONTENT);
  if (!title || !content) throw new Error("A memory needs a title and some content.");
  const kind: MemoryKind = KINDS.includes(input.kind as MemoryKind) ? (input.kind as MemoryKind) : "note";
  const tags = (input.tags ?? []).map((t) => String(t).trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 8);
  const byAgent = input.authorId !== "user";

  const db0 = await read();
  const ws = db0.workspaces.find((w) => w.id === input.workspaceId);
  const review = ws?.memoryReview ?? "conventions";
  const needsReview = byAgent && (review === "all" || (review === "conventions" && (kind === "decision" || kind === "convention")));

  const emb = await getEmbedder();
  const [vec] = await emb.embed([memText({ kind, title, content, tags })]);
  // Near-duplicate detection for agent writes (the user is allowed to keep similar notes).
  let dupId: string | undefined;
  if (byAgent) {
    const { all } = await withEmbeddings(input.workspaceId);
    let best = 0;
    for (const m of all) {
      if (norm(m.title) === norm(title)) continue;
      const sim = cosine(vec, m.embedding ?? []);
      if (sim > best && sim >= emb.dupThreshold) {
        best = sim;
        dupId = m.id;
      }
    }
  }

  const res = await mutate((db): UpsertResult => {
    const existing =
      db.memories.find((m) => m.workspaceId === input.workspaceId && norm(m.title) === norm(title)) ??
      (dupId ? db.memories.find((m) => m.id === dupId) : undefined);
    if (existing) {
      const merged = existing.id === dupId && norm(existing.title) !== norm(title);
      if (needsReview && existing.status !== "proposed") {
        // Keep the approved version; park the agent's change as a proposal.
        existing.proposal = { content, authorId: input.authorId, ticketId: input.ticketId ?? null, at: now() };
        existing.updatedAt = now();
        return { memory: { ...existing }, created: false, mergedInto: merged ? existing.title : undefined, pending: true };
      }
      Object.assign(existing, {
        kind,
        content,
        tags: tags.length ? tags : existing.tags,
        authorId: input.authorId,
        ticketId: input.ticketId ?? existing.ticketId,
        pinned: input.pinned ?? existing.pinned,
        embedding: merged ? existing.embedding : vec,
        embeddingModel: emb.model,
        status: byAgent ? existing.status ?? "active" : "active",
        proposal: byAgent ? existing.proposal ?? null : null,
        updatedAt: now(),
      });
      if (merged) existing.embedding = undefined; // recompute from the merged text next time
      return { memory: { ...existing }, created: false, mergedInto: merged ? existing.title : undefined, pending: existing.status === "proposed" };
    }
    if (db.memories.filter((m) => m.workspaceId === input.workspaceId).length >= MAX_MEMORIES) {
      throw new Error(`Team memory is full (${MAX_MEMORIES} entries). Update an existing memory (same title) instead, or ask the user to tidy up.`);
    }
    const m: Memory = {
      id: newId("mem"),
      workspaceId: input.workspaceId,
      kind,
      title,
      content,
      tags,
      authorId: input.authorId,
      ticketId: input.ticketId ?? null,
      pinned: Boolean(input.pinned),
      status: needsReview ? "proposed" : "active",
      proposal: null,
      embedding: vec,
      embeddingModel: emb.model,
      createdAt: now(),
      updatedAt: now(),
    };
    db.memories.push(m);
    return { memory: m, created: true, pending: needsReview };
  });
  publish(input.workspaceId, { kind: "memory", workspaceId: input.workspaceId });
  if (res.pending) {
    const who = db0.agents.find((a) => a.id === input.authorId)?.name ?? "An agent";
    void import("./notifications")
      .then((n) =>
        n.notify({
          workspaceId: input.workspaceId,
          kind: "memory_review",
          title: `${who} proposed a team ${res.memory.kind}: “${res.memory.title}”`,
          body: (res.memory.proposal?.content ?? res.memory.content).slice(0, 240),
          link: `/w/${input.workspaceId}/memory`,
        }),
      )
      .catch(() => undefined);
  }
  return res;
}

export async function updateMemory(id: string, patch: Partial<Pick<Memory, "kind" | "title" | "content" | "tags" | "pinned">>) {
  const m = await mutate((db) => {
    const m = db.memories.find((x) => x.id === id);
    if (!m) throw new Error("Memory not found");
    if (patch.title !== undefined) m.title = String(patch.title).trim().slice(0, 120) || m.title;
    if (patch.content !== undefined) m.content = String(patch.content).trim().slice(0, MAX_CONTENT) || m.content;
    if (patch.kind !== undefined && KINDS.includes(patch.kind)) m.kind = patch.kind;
    if (Array.isArray(patch.tags)) m.tags = patch.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8);
    if (patch.pinned !== undefined) m.pinned = Boolean(patch.pinned);
    if (patch.title !== undefined || patch.content !== undefined || patch.kind !== undefined) {
      m.authorId = "user";
      m.embedding = undefined;
    }
    m.updatedAt = now();
    return { ...m };
  });
  publish(m.workspaceId, { kind: "memory", workspaceId: m.workspaceId });
  return m;
}

/** Approve or reject an agent proposal (a new proposed memory, or a proposed change). */
export async function reviewMemory(id: string, approve: boolean) {
  const res = await mutate((db) => {
    const m = db.memories.find((x) => x.id === id);
    if (!m) throw new Error("Memory not found");
    if (m.status === "proposed") {
      if (approve) {
        m.status = "active";
        m.updatedAt = now();
        return { memory: { ...m }, removed: false };
      }
      db.memories = db.memories.filter((x) => x.id !== id);
      return { memory: m, removed: true };
    }
    if (!m.proposal) throw new Error("Nothing to review on this memory.");
    if (approve) {
      m.content = m.proposal.content;
      m.authorId = m.proposal.authorId;
      m.ticketId = m.proposal.ticketId;
      m.embedding = undefined;
    }
    m.proposal = null;
    m.updatedAt = now();
    return { memory: { ...m }, removed: false };
  });
  publish(res.memory.workspaceId, { kind: "memory", workspaceId: res.memory.workspaceId });
  return res;
}

/** Merge `dropId` into `keepId`: keep's title, both contents (deduplicated), pinned if either was. */
export async function mergeMemories(keepId: string, dropId: string) {
  const m = await mutate((db) => {
    const keep = db.memories.find((x) => x.id === keepId);
    const drop = db.memories.find((x) => x.id === dropId);
    if (!keep || !drop || keep.workspaceId !== drop.workspaceId) throw new Error("Memory not found");
    if (!keep.content.includes(drop.content.trim())) keep.content = `${keep.content.trim()}\n${drop.content.trim()}`.slice(0, MAX_CONTENT);
    keep.tags = [...new Set([...keep.tags, ...drop.tags])].slice(0, 8);
    keep.pinned = keep.pinned || drop.pinned;
    keep.status = keep.status === "proposed" && drop.status !== "proposed" ? "active" : keep.status;
    keep.embedding = undefined;
    keep.authorId = "user";
    keep.updatedAt = now();
    db.memories = db.memories.filter((x) => x.id !== dropId);
    return { ...keep };
  });
  publish(m.workspaceId, { kind: "memory", workspaceId: m.workspaceId });
  return m;
}

export async function deleteMemory(id: string) {
  const wsId = await mutate((db) => {
    const m = db.memories.find((x) => x.id === id);
    db.memories = db.memories.filter((x) => x.id !== id);
    return m?.workspaceId;
  });
  if (wsId) publish(wsId, { kind: "memory", workspaceId: wsId });
}

export function formatMemory(m: Memory, nameOf: (id: string) => string) {
  const base = `- [${m.kind}] ${m.title}: ${m.content.replace(/\s*\n\s*/g, " ")} (${nameOf(m.authorId)})`;
  if (m.status === "proposed") return `${base} — PROPOSED, awaiting the user's approval`;
  if (m.proposal) return `${base}\n  · proposed change by ${nameOf(m.proposal.authorId)}, awaiting approval: ${m.proposal.content.replace(/\s*\n\s*/g, " ")}`;
  return base;
}

/** The "Team memory" section of an agent briefing: pinned first, then most relevant, within a size budget. */
export async function memoryBriefing(ticket: Ticket, nameOf: (id: string) => string) {
  const all = await listMemories(ticket.workspaceId);
  if (!all.length) return { text: "", shown: 0, total: 0 };
  const ranked = await rank(ticket.workspaceId, `${ticket.title}\n${ticket.description}\n${ticket.labels.join(" ")}`);
  const boost = (m: Memory) => (m.kind === "decision" || m.kind === "convention" || m.kind === "preference" ? 0.08 : 0);
  const ordered = [
    ...all.filter((m) => m.pinned && m.status !== "proposed"),
    ...ranked
      .filter((x) => !(x.m.pinned && x.m.status !== "proposed"))
      .sort((a, b) => b.s + boost(b.m) - (a.s + boost(a.m)))
      .map((x) => x.m),
  ];
  const lines: string[] = [];
  let used = 0;
  for (const m of ordered) {
    const line = formatMemory(m, nameOf);
    if (used + line.length > BRIEFING_CHARS && lines.length) break;
    lines.push(line);
    used += line.length;
  }
  return { text: lines.join("\n"), shown: lines.length, total: all.length };
}
