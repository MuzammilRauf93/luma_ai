/**
 * Small line-based diff (LCS) used by the change viewer. Works on both server and client.
 * Common prefix/suffix are trimmed first, so typical agent edits are cheap; very large
 * rewrites fall back to "remove all, add all" instead of an expensive table.
 */

export type DiffLine = { type: "same" | "add" | "del"; text: string; a?: number; b?: number };

const MAX_CELLS = 4_000_000;

export function splitLines(s: string | null) {
  if (s === null || s === "") return [];
  const lines = s.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(before: string | null, after: string | null): DiffLine[] {
  const A = splitLines(before);
  const B = splitLines(after);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;

  const out: DiffLine[] = [];
  for (let i = 0; i < pre; i++) out.push({ type: "same", text: A[i], a: i + 1, b: i + 1 });

  const a = A.slice(pre, A.length - suf);
  const b = B.slice(pre, B.length - suf);
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    a.forEach((t, i) => out.push({ type: "del", text: t, a: pre + i + 1 }));
    b.forEach((t, j) => out.push({ type: "add", text: t, b: pre + j + 1 }));
  } else {
    // dp[i][j] = LCS length of a[i:], b[j:]
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) {
        out.push({ type: "same", text: a[i], a: pre + i + 1, b: pre + j + 1 });
        i++;
        j++;
      } else if (i < n && (j === m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) {
        // Prefer deletions first, so a replaced block reads "− old, + new".
        out.push({ type: "del", text: a[i], a: pre + i + 1 });
        i++;
      } else {
        out.push({ type: "add", text: b[j], b: pre + j + 1 });
        j++;
      }
    }
  }
  for (let k = suf; k > 0; k--) {
    out.push({ type: "same", text: A[A.length - k], a: A.length - k + 1, b: B.length - k + 1 });
  }
  return out;
}

export function diffStats(lines: DiffLine[]) {
  let adds = 0;
  let dels = 0;
  for (const l of lines) {
    if (l.type === "add") adds++;
    else if (l.type === "del") dels++;
  }
  return { adds, dels };
}

export type Hunk = { lines: DiffLine[] } | { skipped: number; from: number };

/** Group into hunks with `context` unchanged lines around each change; long unchanged runs collapse. */
export function toHunks(lines: DiffLine[], context = 3): Hunk[] {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.type !== "same") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: Hunk[] = [];
  let cur: DiffLine[] = [];
  let skip = 0;
  let skipFrom = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skip) {
        out.push({ skipped: skip, from: skipFrom });
        skip = 0;
      }
      cur.push(l);
    } else {
      if (cur.length) {
        out.push({ lines: cur });
        cur = [];
      }
      if (!skip) skipFrom = i;
      skip++;
    }
  });
  if (cur.length) out.push({ lines: cur });
  if (skip) out.push({ skipped: skip, from: skipFrom });
  return out;
}
