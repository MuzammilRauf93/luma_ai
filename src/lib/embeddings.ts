import "server-only";
import { createRequire } from "module";
import path from "path";
import { DATA_DIR } from "./store";

/**
 * Text embeddings for team memory (Phase 5), with no external service.
 *
 * - "minilm": all-MiniLM-L6-v2 run locally with transformers.js (optional dependency
 *   `@huggingface/transformers`; the ~25 MB model downloads once into .luma/models).
 * - "ngram": built-in fallback — hashed words, word pairs and character trigrams with light
 *   stemming and US/UK spelling folding. Not truly semantic, but robust to plurals, typos and
 *   word order, and instant.
 *
 * LUMA_EMBEDDINGS = auto (default: minilm if installed, else ngram) | minilm | ngram
 */

export interface Embedder {
  model: string;
  /** Cosine similarity above which an agent's new memory updates the existing one instead. */
  dupThreshold: number;
  /** Lower bar for "possible duplicates" suggestions shown to the user. */
  suggestThreshold: number;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------- n-gram fallback

const DIM = 1024;
const FOLD: [RegExp, string][] = [
  [/our\b/g, "or"], // colour → color, behaviour → behavior
  [/ise\b/g, "ize"],
  [/isation\b/g, "ization"],
  [/tre\b/g, "ter"], // centre → center
];

export function stem(word: string) {
  let w = word
    .toLowerCase()
    .replace(/(ies)$/, "y")
    .replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
    .replace(/([^s])s$/, "$1");
  for (const [re, to] of FOLD) w = w.replace(re, to); // after plurals: colours → colour → color
  if (w.length > 5) w = w.replace(/(ing|ed)$/, "");
  return w.replace(/(.)\1$/, "$1");
}

function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const STOP = new Set("a an and are as at be by for from has have in is it its of on or that the this to was were will with you your we our use using what which who how does do should".split(" "));

export function ngramVector(text: string): number[] {
  const v = new Float64Array(DIM);
  const words = text.toLowerCase().split(/[^a-z0-9#]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  const add = (feat: string, weight: number) => {
    const h = fnv(feat);
    v[h % DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  words.forEach((w, i) => {
    add(`w:${w}`, 1);
    if (i > 0) add(`b:${words[i - 1]}_${w}`, 0.6);
    const padded = `^${w}$`;
    for (let k = 0; k + 3 <= padded.length; k++) add(`c:${padded.slice(k, k + 3)}`, 0.25);
  });
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e4) / 1e4);
}

const ngram: Embedder = { model: "ngram-v2", dupThreshold: 0.82, suggestThreshold: 0.55, embed: async (texts) => texts.map(ngramVector) };

// ---------------------------------------------------------------- transformers.js (optional)

type Pipe = (text: string | string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

const g = globalThis as unknown as { __lumaEmbedder?: Promise<Embedder> };

async function loadMiniLM(): Promise<Embedder | null> {
  try {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const mod = req("@huggingface/transformers") as {
      pipeline: (task: string, model: string, opts?: Record<string, unknown>) => Promise<Pipe>;
      env: { cacheDir: string; allowLocalModels: boolean };
    };
    mod.env.cacheDir = path.join(DATA_DIR, "models");
    const pipe = await mod.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
    return {
      model: "minilm-l6-v2",
      dupThreshold: 0.9,
      suggestThreshold: 0.78,
      embed: async (texts) => {
        const out: number[][] = [];
        for (const t of texts) {
          const r = await pipe(t.slice(0, 2000), { pooling: "mean", normalize: true });
          out.push(Array.from(r.data, (x) => Math.round(x * 1e4) / 1e4));
        }
        return out;
      },
    };
  } catch (err) {
    if (process.env.LUMA_EMBEDDINGS === "minilm") console.warn("[luma] MiniLM embeddings unavailable, using n-grams:", (err as Error).message);
    return null;
  }
}

export function getEmbedder(): Promise<Embedder> {
  const mode = process.env.LUMA_EMBEDDINGS ?? "auto";
  if (mode === "ngram") return Promise.resolve(ngram);
  return (g.__lumaEmbedder ??= loadMiniLM().then((e) => e ?? ngram));
}

export function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
