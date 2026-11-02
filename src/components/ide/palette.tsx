"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileIcon, Highlight, baseName, dirName, fuzzy, kbd } from "./bits";
import { useIde } from "./ctx";
import { THEMES, type ThemeId } from "./settings";

export type PaletteMode = { kind: "quick"; text: string } | { kind: "theme" };

const RECENT_KEY = "luma-ide-recent-commands";
function recentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

interface Item {
  key: string;
  label: string;
  hits?: number[];
  detail?: string;
  detailHits?: number[];
  keys?: string;
  icon?: React.ReactNode;
  group?: string;
  run: (side?: boolean) => void;
}

export function Palette({ mode, onClose, recentFiles }: { mode: PaletteMode; onClose: () => void; recentFiles: string[] }) {
  const ide = useIde();
  const [text, setText] = useState(mode.kind === "quick" ? mode.text : "");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const originalTheme = useRef(ide.settings["workbench.colorTheme"]);

  useEffect(() => {
    input.current?.focus();
    if (mode.kind === "quick" && mode.text) input.current?.setSelectionRange(mode.text.length, mode.text.length);
  }, [mode]);

  const prefix = mode.kind === "theme" ? "theme" : text.startsWith(">") ? "cmd" : text.startsWith(":") ? "line" : text.startsWith("@") ? "symbol" : text.startsWith("?") ? "help" : "file";
  const query = prefix === "cmd" || prefix === "line" || prefix === "symbol" || prefix === "help" ? text.slice(1).trim() : text.trim();

  const items: Item[] = useMemo(() => {
    if (prefix === "theme") {
      return THEMES.filter((t) => fuzzyItem(t, query).ok).map((t) => ({ key: t, label: t, hits: fuzzyItem(t, query).hits, run: () => ide.updateSettings({ "workbench.colorTheme": t }) }));
    }
    if (prefix === "help")
      return [
        ["", "Go to File"],
        [">", "Show and Run Commands"],
        [":", "Go to Line/Column"],
        ["@", "Go to Symbol in Editor"],
      ].map(([p, l]) => ({ key: p || "file", label: `${p || "…"}  ${l}`, run: () => setText(p) }));
    if (prefix === "line") {
      const [l, c] = query.split(/[:,]/).map((n) => parseInt(n, 10));
      const ed = ide.focusedEditor();
      const max = ed?.getModel()?.getLineCount();
      return [
        {
          key: "line",
          label: !ed ? "Open a text editor first to go to a line." : l ? `Go to line ${l}${c ? `, character ${c}` : ""}.` : `Current Line: ${ed.getPosition()?.lineNumber}. Type a line number between 1 and ${max} to navigate to.`,
          run: () => {
            if (!ed || !l) return;
            const line = Math.min(l, max ?? l);
            ed.setPosition({ lineNumber: line, column: c || 1 });
            ed.revealLineInCenter(line);
            ed.focus();
          },
        },
      ];
    }
    if (prefix === "symbol")
      return [
        {
          key: "symbol",
          label: "Go to Symbol in Editor",
          run: () => {
            const ed = ide.focusedEditor();
            ed?.focus();
            setTimeout(() => ed?.getAction("editor.action.quickOutline")?.run(), 10);
          },
        },
      ];
    if (prefix === "cmd") {
      const recent = recentCommands();
      const cmds = ide.commands.filter((c) => !c.when || c.when());
      const scored = cmds
        .map((c) => {
          const label = `${c.category ? `${c.category}: ` : ""}${c.title}`;
          const m = fuzzy(query, label);
          return m && { c, label, m };
        })
        .filter(Boolean) as { c: (typeof cmds)[0]; label: string; m: { score: number; hits: number[] } }[];
      if (!query) scored.sort((a, b) => (recent.indexOf(a.c.id) + 1 || 999) - (recent.indexOf(b.c.id) + 1 || 999) || a.label.localeCompare(b.label));
      else scored.sort((a, b) => b.m.score - a.m.score);
      return scored.slice(0, 200).map(({ c, label, m }, i) => ({
        key: c.id,
        label,
        hits: m.hits,
        keys: c.keys,
        group: !query && recent.includes(c.id) && i < recent.length ? "recently used" : undefined,
        run: () => {
          try {
            localStorage.setItem(RECENT_KEY, JSON.stringify([c.id, ...recent.filter((x) => x !== c.id)].slice(0, 8)));
          } catch {}
          c.run();
        },
      }));
    }
    // files
    const all = ide.files.map((f) => f.path);
    if (!query) {
      const rec = recentFiles.filter((p) => all.includes(p));
      const rest = all.filter((p) => !rec.includes(p));
      return [...rec, ...rest].slice(0, 100).map((p, i) => ({
        key: p,
        label: baseName(p),
        detail: dirName(p),
        icon: <FileIcon path={p} size={15} />,
        group: i === 0 && rec.length ? "recently opened" : i === rec.length && rec.length ? "files" : undefined,
        run: (side?: boolean) => ide.openFile(p, { preview: false, side }),
      }));
    }
    const [q, lineStr] = query.split(":");
    return all
      .map((p) => ({ p, m: fuzzy(q.replace(/\s/g, ""), p) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m!.score - a.m!.score)
      .slice(0, 100)
      .map(({ p, m }) => {
        const nameStart = p.length - baseName(p).length;
        return {
          key: p,
          label: baseName(p),
          hits: m!.hits.filter((h) => h >= nameStart).map((h) => h - nameStart),
          detail: dirName(p),
          detailHits: m!.hits.filter((h) => h < nameStart),
          icon: <FileIcon path={p} size={15} />,
          run: (side?: boolean) => ide.openFile(p, { preview: false, side, line: lineStr ? parseInt(lineStr, 10) || undefined : undefined }),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefix, query, ide.files, ide.commands, recentFiles]);

  useEffect(() => {
    setIdx(prefix === "theme" ? Math.max(0, THEMES.indexOf(originalTheme.current)) : 0);
  }, [prefix, query]);
  // Live theme preview while moving through the list.
  useEffect(() => {
    if (prefix === "theme" && items[idx]) ide.updateSettings({ "workbench.colorTheme": items[idx].key as ThemeId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, prefix]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const close = (revert: boolean) => {
    if (revert && prefix === "theme") ide.updateSettings({ "workbench.colorTheme": originalTheme.current });
    onClose();
  };
  const choose = (i: number, side?: boolean) => {
    const it = items[i];
    if (!it) return;
    if (prefix === "help") return it.run();
    close(false);
    setTimeout(() => it.run(side), 0);
  };

  const placeholder =
    prefix === "theme" ? "Select Color Theme (Up/Down Keys to Preview)" : prefix === "cmd" ? "" : prefix === "line" ? "" : "Search files by name (append : to go to line or @ to go to symbol)";

  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={() => close(true)}>
      <div
        className="absolute left-1/2 -translate-x-1/2 top-[8px] w-[min(600px,calc(100vw-24px))] rounded-lg overflow-hidden"
        style={{ background: "var(--ide-widget)", border: "1px solid var(--ide-border)", boxShadow: "0 8px 30px var(--ide-shadow)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-1.5">
          <input
            ref={input}
            className="ide-input !py-1"
            style={{ borderColor: "var(--ide-focus)" }}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(items.length - 1, i + 1));
              else if (e.key === "ArrowUp") setIdx((i) => Math.max(0, i - 1));
              else if (e.key === "Enter") choose(idx, e.metaKey || e.ctrlKey);
              else if (e.key === "Escape") close(true);
              else return;
              e.preventDefault();
            }}
          />
        </div>
        <div ref={list} className="max-h-[min(440px,60vh)] overflow-auto pb-1.5" role="listbox">
          {items.length === 0 && <div className="px-3 py-1.5 text-[13px]" style={{ color: "var(--ide-muted)" }}>{prefix === "cmd" ? "No matching commands" : "No matching results"}</div>}
          {items.map((it, i) => (
            <div
              key={it.key}
              data-i={i}
              role="option"
              aria-selected={i === idx}
              className="flex items-center gap-2 mx-1.5 px-2 h-[24px] rounded cursor-pointer text-[13px]"
              style={{ background: i === idx ? "var(--ide-select-focus)" : undefined, color: i === idx && ide.dark ? "#fff" : undefined, borderTop: it.group && i > 0 ? "1px solid var(--ide-border)" : undefined }}
              onMouseMove={() => setIdx(i)}
              onClick={() => choose(i)}
            >
              {it.icon}
              <span className="truncate">{it.hits ? <Highlight text={it.label} hits={it.hits} /> : it.label}</span>
              {it.detail && <span className="truncate text-[12px]" style={{ opacity: 0.7 }}>{it.detailHits ? <Highlight text={it.detail} hits={it.detailHits} /> : it.detail}</span>}
              <span className="ml-auto flex items-center gap-2 shrink-0 text-[12px]" style={{ opacity: 0.75 }}>
                {it.group && <span>{it.group}</span>}
                {it.keys && <kbd className="px-1 rounded" style={{ background: "rgba(128,128,128,.2)", fontFamily: "inherit" }}>{kbd(it.keys)}</kbd>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function fuzzyItem(label: string, q: string) {
  const m = fuzzy(q, label);
  return { ok: !!m, hits: m?.hits ?? [] };
}
