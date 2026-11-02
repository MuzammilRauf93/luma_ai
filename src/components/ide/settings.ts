"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * IDE settings use VS Code's own setting names, so a VS Code settings.json can be pasted
 * in as-is (unknown keys are ignored). Stored per browser.
 */

export type ThemeId = "Default Dark Modern" | "Default Dark+" | "Default Light Modern" | "Default Light+" | "Default High Contrast" | "Follow Luma";

export interface IdeSettings {
  "workbench.colorTheme": ThemeId;
  "workbench.sideBar.location": "left" | "right";
  "breadcrumbs.enabled": boolean;
  "editor.fontSize": number;
  "editor.fontFamily": string;
  "editor.fontLigatures": boolean;
  "editor.lineHeight": number;
  "editor.tabSize": number;
  "editor.insertSpaces": boolean;
  "editor.wordWrap": "off" | "on" | "bounded" | "wordWrapColumn";
  "editor.minimap.enabled": boolean;
  "editor.lineNumbers": "on" | "off" | "relative";
  "editor.renderWhitespace": "none" | "boundary" | "selection" | "trailing" | "all";
  "editor.cursorStyle": "line" | "block" | "underline" | "line-thin" | "block-outline" | "underline-thin";
  "editor.cursorBlinking": "blink" | "smooth" | "phase" | "expand" | "solid";
  "editor.bracketPairColorization.enabled": boolean;
  "editor.guides.bracketPairs": boolean;
  "editor.stickyScroll.enabled": boolean;
  "editor.smoothScrolling": boolean;
  "editor.formatOnSave": boolean;
  "editor.formatOnPaste": boolean;
  "editor.multiCursorModifier": "alt" | "ctrlCmd";
  "editor.rulers": number[];
  "editor.renderLineHighlight": "none" | "gutter" | "line" | "all";
  "files.autoSave": "off" | "afterDelay" | "onFocusChange" | "onWindowChange";
  "files.autoSaveDelay": number;
  "files.trimTrailingWhitespace": boolean;
  "files.insertFinalNewline": boolean;
  "diffEditor.renderSideBySide": boolean;
  "diffEditor.ignoreTrimWhitespace": boolean;
}

export const DEFAULTS: IdeSettings = {
  "workbench.colorTheme": "Follow Luma",
  "workbench.sideBar.location": "left",
  "breadcrumbs.enabled": true,
  "editor.fontSize": 14,
  "editor.fontFamily": "Menlo, Monaco, 'Courier New', monospace",
  "editor.fontLigatures": false,
  "editor.lineHeight": 0,
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.minimap.enabled": true,
  "editor.lineNumbers": "on",
  "editor.renderWhitespace": "selection",
  "editor.cursorStyle": "line",
  "editor.cursorBlinking": "blink",
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.bracketPairs": false,
  "editor.stickyScroll.enabled": true,
  "editor.smoothScrolling": false,
  "editor.formatOnSave": false,
  "editor.formatOnPaste": false,
  "editor.multiCursorModifier": "alt",
  "editor.rulers": [],
  "editor.renderLineHighlight": "line",
  "files.autoSave": "off",
  "files.autoSaveDelay": 1000,
  "files.trimTrailingWhitespace": false,
  "files.insertFinalNewline": false,
  "diffEditor.renderSideBySide": true,
  "diffEditor.ignoreTrimWhitespace": true,
};

type Kind = { type: "boolean" } | { type: "number"; min?: number; max?: number } | { type: "string" } | { type: "enum"; options: readonly string[] } | { type: "numbers" };

export interface SettingDef {
  key: keyof IdeSettings;
  group: "Commonly Used" | "Text Editor" | "Workbench" | "Files" | "Diff Editor";
  title: string;
  description: string;
  kind: Kind;
}

export const THEMES: ThemeId[] = ["Follow Luma", "Default Dark Modern", "Default Light Modern", "Default Dark+", "Default Light+", "Default High Contrast"];

export const SETTING_DEFS: SettingDef[] = [
  { key: "files.autoSave", group: "Commonly Used", title: "Files: Auto Save", description: "Controls auto save of editors that have unsaved changes.", kind: { type: "enum", options: ["off", "afterDelay", "onFocusChange", "onWindowChange"] } },
  { key: "editor.fontSize", group: "Commonly Used", title: "Editor: Font Size", description: "Controls the font size in pixels.", kind: { type: "number", min: 8, max: 40 } },
  { key: "editor.fontFamily", group: "Commonly Used", title: "Editor: Font Family", description: "Controls the font family.", kind: { type: "string" } },
  { key: "editor.tabSize", group: "Commonly Used", title: "Editor: Tab Size", description: "The number of spaces a tab is equal to.", kind: { type: "number", min: 1, max: 8 } },
  { key: "editor.renderWhitespace", group: "Commonly Used", title: "Editor: Render Whitespace", description: "Controls how the editor should render whitespace characters.", kind: { type: "enum", options: ["none", "boundary", "selection", "trailing", "all"] } },
  { key: "editor.cursorStyle", group: "Commonly Used", title: "Editor: Cursor Style", description: "Controls the cursor style.", kind: { type: "enum", options: ["line", "block", "underline", "line-thin", "block-outline", "underline-thin"] } },
  { key: "editor.multiCursorModifier", group: "Commonly Used", title: "Editor: Multi Cursor Modifier", description: "The modifier to be used to add multiple cursors with the mouse.", kind: { type: "enum", options: ["alt", "ctrlCmd"] } },
  { key: "editor.insertSpaces", group: "Commonly Used", title: "Editor: Insert Spaces", description: "Insert spaces when pressing Tab.", kind: { type: "boolean" } },
  { key: "editor.wordWrap", group: "Commonly Used", title: "Editor: Word Wrap", description: "Controls how lines should wrap.", kind: { type: "enum", options: ["off", "on", "bounded", "wordWrapColumn"] } },
  { key: "workbench.colorTheme", group: "Workbench", title: "Workbench: Color Theme", description: "Specifies the color theme used in the workbench.", kind: { type: "enum", options: THEMES } },
  { key: "workbench.sideBar.location", group: "Workbench", title: "Workbench › Side Bar: Location", description: "Controls the location of the primary side bar.", kind: { type: "enum", options: ["left", "right"] } },
  { key: "breadcrumbs.enabled", group: "Workbench", title: "Breadcrumbs: Enabled", description: "Enable/disable navigation breadcrumbs.", kind: { type: "boolean" } },
  { key: "editor.minimap.enabled", group: "Text Editor", title: "Editor › Minimap: Enabled", description: "Controls whether the minimap is shown.", kind: { type: "boolean" } },
  { key: "editor.lineNumbers", group: "Text Editor", title: "Editor: Line Numbers", description: "Controls the display of line numbers.", kind: { type: "enum", options: ["on", "off", "relative"] } },
  { key: "editor.fontLigatures", group: "Text Editor", title: "Editor: Font Ligatures", description: "Enables font ligatures.", kind: { type: "boolean" } },
  { key: "editor.lineHeight", group: "Text Editor", title: "Editor: Line Height", description: "Controls the line height. Use 0 to compute it from the font size.", kind: { type: "number", min: 0, max: 80 } },
  { key: "editor.cursorBlinking", group: "Text Editor", title: "Editor: Cursor Blinking", description: "Control the cursor animation style.", kind: { type: "enum", options: ["blink", "smooth", "phase", "expand", "solid"] } },
  { key: "editor.bracketPairColorization.enabled", group: "Text Editor", title: "Editor › Bracket Pair Colorization: Enabled", description: "Controls whether bracket pair colorization is enabled.", kind: { type: "boolean" } },
  { key: "editor.guides.bracketPairs", group: "Text Editor", title: "Editor › Guides: Bracket Pairs", description: "Controls whether bracket pair guides are enabled.", kind: { type: "boolean" } },
  { key: "editor.stickyScroll.enabled", group: "Text Editor", title: "Editor › Sticky Scroll: Enabled", description: "Shows the nested current scopes at the top of the editor.", kind: { type: "boolean" } },
  { key: "editor.smoothScrolling", group: "Text Editor", title: "Editor: Smooth Scrolling", description: "Controls whether the editor will scroll using an animation.", kind: { type: "boolean" } },
  { key: "editor.renderLineHighlight", group: "Text Editor", title: "Editor: Render Line Highlight", description: "Controls how the editor should render the current line highlight.", kind: { type: "enum", options: ["none", "gutter", "line", "all"] } },
  { key: "editor.rulers", group: "Text Editor", title: "Editor: Rulers", description: "Render vertical rulers after a certain number of characters, e.g. 80, 120.", kind: { type: "numbers" } },
  { key: "editor.formatOnSave", group: "Text Editor", title: "Editor: Format On Save", description: "Format a file on save (HTML, CSS, JavaScript, TypeScript, JSON).", kind: { type: "boolean" } },
  { key: "editor.formatOnPaste", group: "Text Editor", title: "Editor: Format On Paste", description: "Controls whether the editor should automatically format the pasted content.", kind: { type: "boolean" } },
  { key: "files.autoSaveDelay", group: "Files", title: "Files: Auto Save Delay", description: "Delay in milliseconds after which an editor is saved when Auto Save is afterDelay.", kind: { type: "number", min: 100, max: 60000 } },
  { key: "files.trimTrailingWhitespace", group: "Files", title: "Files: Trim Trailing Whitespace", description: "Trim trailing whitespace when saving a file.", kind: { type: "boolean" } },
  { key: "files.insertFinalNewline", group: "Files", title: "Files: Insert Final Newline", description: "Insert a final new line at the end of the file when saving it.", kind: { type: "boolean" } },
  { key: "diffEditor.renderSideBySide", group: "Diff Editor", title: "Diff Editor: Render Side By Side", description: "Show diffs side by side, or inline.", kind: { type: "boolean" } },
  { key: "diffEditor.ignoreTrimWhitespace", group: "Diff Editor", title: "Diff Editor: Ignore Trim Whitespace", description: "Ignore changes in leading or trailing whitespace.", kind: { type: "boolean" } },
];

const KEY = "luma-ide-settings";

/** Keep only known keys with values of the right type. Accepts VS Code's own theme names. */
export function sanitize(input: Record<string, unknown>): Partial<IdeSettings> {
  const out: Record<string, unknown> = {};
  for (const d of SETTING_DEFS) {
    let v = input[d.key];
    if (v === undefined) continue;
    if (d.key === "workbench.colorTheme" && typeof v === "string") {
      const map: Record<string, ThemeId> = {
        "Dark Modern": "Default Dark Modern", "Light Modern": "Default Light Modern", "Dark+": "Default Dark+", "Light+": "Default Light+",
        "Dark+ (default dark)": "Default Dark+", "Light+ (default light)": "Default Light+", "Default High Contrast": "Default High Contrast", "High Contrast": "Default High Contrast",
      };
      v = THEMES.includes(v as ThemeId) ? v : map[v] ?? (/light/i.test(v) ? "Default Light Modern" : /dark|monokai|dracula|night|one/i.test(v) ? "Default Dark Modern" : undefined);
      if (v) out[d.key] = v;
      continue;
    }
    const k = d.kind;
    if (k.type === "boolean" && typeof v === "boolean") out[d.key] = v;
    else if (k.type === "number" && typeof v === "number" && Number.isFinite(v)) out[d.key] = Math.min(k.max ?? Infinity, Math.max(k.min ?? -Infinity, v));
    else if (k.type === "string" && typeof v === "string") out[d.key] = v;
    else if (k.type === "enum" && typeof v === "string" && k.options.includes(v)) out[d.key] = v;
    else if (k.type === "numbers" && Array.isArray(v)) out[d.key] = v.filter((x) => typeof x === "number").slice(0, 6);
  }
  // VS Code stores word wrap and rulers slightly differently in older configs.
  if (typeof input["editor.wordWrap"] === "boolean") out["editor.wordWrap"] = input["editor.wordWrap"] ? "on" : "off";
  return out as Partial<IdeSettings>;
}

/** settings.json allows comments and trailing commas (JSONC). */
export function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  const parsed = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json must be an object.");
  return parsed as Record<string, unknown>;
}

function load(): IdeSettings {
  try {
    return { ...DEFAULTS, ...sanitize(JSON.parse(localStorage.getItem(KEY) ?? "{}")) };
  } catch {
    return DEFAULTS;
  }
}

export function useIdeSettings() {
  const [settings, setAll] = useState<IdeSettings>(DEFAULTS);
  useEffect(() => setAll(load()), []);
  const update = useCallback((patch: Partial<IdeSettings>, replace = false) => {
    setAll((s) => {
      const next = { ...(replace ? DEFAULTS : s), ...patch };
      try {
        // Only store what differs from the defaults, like VS Code does.
        const diff: Record<string, unknown> = {};
        for (const k of Object.keys(next) as (keyof IdeSettings)[]) if (JSON.stringify(next[k]) !== JSON.stringify(DEFAULTS[k])) diff[k] = next[k];
        localStorage.setItem(KEY, JSON.stringify(diff));
      } catch {}
      return next;
    });
  }, []);
  return [settings, update] as const;
}

export function settingsJson(s: IdeSettings) {
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(s) as (keyof IdeSettings)[]) if (JSON.stringify(s[k]) !== JSON.stringify(DEFAULTS[k])) diff[k] = s[k];
  return `// Luma IDE settings — same names as VS Code. Paste your VS Code settings.json here;\n// settings Luma doesn't support are ignored.\n${JSON.stringify(diff, null, 2)}\n`;
}

/** Resolved theme: CSS class for the workbench and the Monaco theme name. */
export function resolveTheme(id: ThemeId, lumaDark: boolean) {
  const t = id === "Follow Luma" ? (lumaDark ? "Default Dark Modern" : "Default Light Modern") : id;
  switch (t) {
    case "Default Dark+":
      return { cls: "dark-plus", monaco: "vs-dark", dark: true };
    case "Default Light+":
      return { cls: "light-plus", monaco: "vs", dark: false };
    case "Default Light Modern":
      return { cls: "light-modern", monaco: "luma-light-modern", dark: false };
    case "Default High Contrast":
      return { cls: "hc", monaco: "hc-black", dark: true };
    default:
      return { cls: "dark-modern", monaco: "luma-dark-modern", dark: true };
  }
}
