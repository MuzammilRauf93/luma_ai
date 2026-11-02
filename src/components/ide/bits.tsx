"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Braces, File, FileCode2, FileImage, FileJson, FileText, FileType, Settings2 } from "lucide-react";

// ---------------------------------------------------------------- file icons

const ICONS: Record<string, { c: string; I: typeof File }> = {
  html: { c: "#e44d26", I: FileCode2 }, htm: { c: "#e44d26", I: FileCode2 }, css: { c: "#42a5f5", I: Braces }, scss: { c: "#f06292", I: Braces },
  js: { c: "#f1dd35", I: FileCode2 }, mjs: { c: "#f1dd35", I: FileCode2 }, cjs: { c: "#f1dd35", I: FileCode2 }, jsx: { c: "#61dafb", I: FileCode2 },
  ts: { c: "#3178c6", I: FileCode2 }, tsx: { c: "#61dafb", I: FileCode2 }, json: { c: "#cbcb41", I: FileJson }, md: { c: "#519aba", I: FileText },
  dart: { c: "#40c4ff", I: FileCode2 }, py: { c: "#3572a5", I: FileCode2 }, yml: { c: "#cb171e", I: Settings2 }, yaml: { c: "#cb171e", I: Settings2 },
  svg: { c: "#ffb13b", I: FileImage }, png: { c: "#a074c4", I: FileImage }, jpg: { c: "#a074c4", I: FileImage }, jpeg: { c: "#a074c4", I: FileImage },
  gif: { c: "#a074c4", I: FileImage }, webp: { c: "#a074c4", I: FileImage }, ico: { c: "#a074c4", I: FileImage }, txt: { c: "#9d9d9d", I: FileText },
  woff: { c: "#9d9d9d", I: FileType }, woff2: { c: "#9d9d9d", I: FileType }, ttf: { c: "#9d9d9d", I: FileType }, lock: { c: "#9d9d9d", I: FileText },
};

export function FileIcon({ path, size = 15 }: { path: string; size?: number }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const { c, I } = ICONS[ext] ?? { c: "#9d9d9d", I: File };
  return <I size={size} color={c} className="shrink-0" strokeWidth={1.8} />;
}

export const baseName = (p: string) => p.split("/").pop() ?? p;
export const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

// ---------------------------------------------------------------- keyboard labels

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** "Mod+Shift+P" → "⇧⌘P" on Mac, "Ctrl+Shift+P" elsewhere. */
export function kbd(k: string) {
  if (!k) return "";
  if (!isMac()) return k.replace(/Mod/g, "Ctrl");
  return k
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((p) => ({ Mod: "⌘", Ctrl: "⌃", Shift: "⇧", Alt: "⌥", Enter: "↩", Backspace: "⌫", Delete: "⌦" })[p] ?? p)
        .sort((a, b) => order(a) - order(b))
        .join(""),
    )
    .join(" ");
}
const order = (s: string) => ["⌃", "⌥", "⇧", "⌘"].indexOf(s) + (["⌃", "⌥", "⇧", "⌘"].includes(s) ? 0 : 10);

/** Does a keyboard event match "Mod+Shift+P"? */
export function matches(e: KeyboardEvent, combo: string) {
  const parts = combo.split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), ctrl: parts.includes("Ctrl") };
  if (want.shift !== e.shiftKey || want.alt !== e.altKey) return false;
  if (isMac()) {
    if (want.mod !== e.metaKey || want.ctrl !== e.ctrlKey) return false;
  } else if ((want.mod || want.ctrl) !== e.ctrlKey || e.metaKey) return false;
  const code = e.code;
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === "`") return code === "Backquote";
  if (k === "\\") return code === "Backslash";
  if (k === ",") return code === "Comma";
  if (k === "=") return code === "Equal";
  if (k === "-") return code === "Minus";
  if (/^[a-z]$/.test(k)) return code === `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return code === `Digit${k}`;
  return e.key === key || code === key;
}

// ---------------------------------------------------------------- fuzzy match (quick open)

/** Subsequence match with a score; returns matched indices for highlighting. */
export function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    hits.push(at);
    score += at === prev + 1 ? 6 : 1;
    if (at === 0 || "/._-".includes(t[at - 1])) score += 4;
    prev = at;
    ti = at + 1;
  }
  const base = t.lastIndexOf("/") + 1;
  if (hits.length && hits[0] >= base) score += 8; // matched in the file name
  return { score: score - text.length * 0.01, hits };
}

export function Highlight({ text, hits, offset = 0 }: { text: string; hits: number[]; offset?: number }) {
  const set = new Set(hits.map((h) => h - offset));
  return (
    <>
      {[...text].map((ch, i) => (set.has(i) ? <b key={i} style={{ color: "#2aaaff", fontWeight: 700 }}>{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  );
}

// ---------------------------------------------------------------- context menus

export interface MenuItem {
  label?: string;
  keys?: string;
  onClick?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(x, window.innerWidth - r.width - 6), y: Math.min(y, window.innerHeight - r.height - 6) });
  }, [x, y]);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ide-menu" style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="ide-menu-sep" />
        ) : (
          <div
            key={i}
            role="menuitem"
            className={`ide-menu-item${it.disabled ? " is-disabled" : ""}`}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span>{it.label}</span>
            {it.keys && <span className="ide-kbd">{kbd(it.keys)}</span>}
          </div>
        ),
      )}
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const open = (e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation?.();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const node: ReactNode = menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} /> : null;
  return { open, node };
}

/** Collapsible sidebar section header (EXPLORER › OPEN EDITORS style). */
export function Section({ title, open, onToggle, actions, children, grow }: { title: string; open: boolean; onToggle: () => void; actions?: ReactNode; children: ReactNode; grow?: boolean }) {
  return (
    <div className={grow && open ? "flex flex-col min-h-0 flex-1" : "flex flex-col"} style={{ borderTop: "1px solid var(--ide-border)" }}>
      <div className="ide-section group" onClick={onToggle}>
        <span style={{ width: 16, display: "inline-block", transform: open ? "rotate(90deg)" : undefined, transition: "transform .1s" }}>›</span>
        <span className="truncate">{title}</span>
        <span className="ml-auto flex opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          {open && actions}
        </span>
      </div>
      {open && <div className={grow ? "min-h-0 flex-1 overflow-auto" : ""}>{children}</div>}
    </div>
  );
}
