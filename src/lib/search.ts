import "server-only";
import { listFiles, readFile, writeFile } from "./files";

/** Workspace-wide find & replace (IDE search view). */

export interface SearchOpts {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  include?: string;
  exclude?: string;
}
export interface SearchMatch {
  line: number;
  col: number;
  length: number;
  text: string;
}

const MAX_MATCHES = 5000;
const MAX_PER_FILE = 300;
const MAX_SIZE = 1_000_000;

function globRe(list: string | undefined) {
  const pats = (list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!pats.length) return null;
  const res = pats.map((p) => {
    let g = p.replace(/^\.\//, "").replace(/\/$/, "");
    if (!/[*?]/.test(g) && !/\.[a-z0-9]+$/i.test(g)) g = `${g}/**`; // a folder name
    if (!g.startsWith("**/") && !g.startsWith("/")) g = `**/${g}`;
    g = g.replace(/^\//, "");
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*" && g[i + 1] === "*") {
        re += g[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += g[i + 2] === "/" ? 2 : 1;
      } else if (c === "*") re += "[^/]*";
      else if (c === "?") re += "[^/]";
      else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return re;
  });
  return new RegExp(`^(?:${res.join("|")})$`, "i");
}

export function buildRegex(o: SearchOpts) {
  if (!o.query) throw new Error("Type something to search for.");
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (o.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, o.caseSensitive ? "gm" : "gim");
  } catch (e) {
    throw new Error(`Invalid regular expression: ${(e as Error).message}`);
  }
}

async function candidates(wsId: string, o: SearchOpts) {
  const inc = globRe(o.include);
  const exc = globRe(o.exclude);
  return (await listFiles(wsId)).filter((f) => f.size <= MAX_SIZE && (!inc || inc.test(f.path)) && !(exc && exc.test(f.path)));
}

export async function searchWorkspace(wsId: string, o: SearchOpts) {
  const re = buildRegex(o);
  const results: { path: string; matches: SearchMatch[] }[] = [];
  let total = 0;
  let truncated = false;
  for (const f of await candidates(wsId, o)) {
    const text = await readFile(wsId, f.path, { skipPull: true });
    if (text === null || text.includes("\0")) continue;
    const lines = text.split("\n");
    const matches: SearchMatch[] = [];
    for (let i = 0; i < lines.length && matches.length < MAX_PER_FILE; i++) {
      re.lastIndex = 0;
      const line = lines[i];
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) && matches.length < MAX_PER_FILE) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        matches.push({ line: i + 1, col: m.index + 1, length: m[0].length, text: line.length > 400 ? line.slice(Math.max(0, m.index - 100), m.index + 300) : line });
      }
    }
    if (matches.length) {
      results.push({ path: f.path, matches });
      total += matches.length;
      if (total >= MAX_MATCHES) {
        truncated = true;
        break;
      }
    }
  }
  return { results, total, truncated };
}

export async function replaceInWorkspace(wsId: string, o: SearchOpts & { replace: string; paths?: string[] }) {
  const re = buildRegex(o);
  const only = o.paths ? new Set(o.paths) : null;
  const changed: { path: string; count: number }[] = [];
  for (const f of await candidates(wsId, o)) {
    if (only && !only.has(f.path)) continue;
    const text = await readFile(wsId, f.path, { skipPull: true });
    if (text === null || text.includes("\0")) continue;
    const count = (text.match(re) ?? []).filter((m) => m.length > 0).length;
    // Regex mode supports $1, $&… like VS Code; plain mode inserts the text literally.
    const next = o.regex ? text.replace(re, o.replace) : text.replace(re, () => o.replace);
    if (count && next !== text) {
      await writeFile(wsId, f.path, next, { actor: "user" });
      changed.push({ path: f.path, count });
    }
  }
  return changed;
}
