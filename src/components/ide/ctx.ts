"use client";

import { createContext, useContext } from "react";
import type { Monaco as MonacoNs } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import type { ReviewThread } from "@/lib/types";
import type { IdeSettings } from "./settings";

export type View = "explorer" | "search" | "scm" | "review";
export type PanelTab = "problems" | "output" | "terminal" | "comments";

export type Tab =
  | { id: string; kind: "file"; path: string; preview?: boolean }
  | { id: string; kind: "diff"; path: string; source: "working" | "staged" }
  | { id: string; kind: "review"; path: string; ticketId: string; ticketNumber: number }
  | { id: string; kind: "preview" }
  | { id: string; kind: "settings" }
  | { id: string; kind: "settings-json" }
  | { id: string; kind: "keybindings" }
  | { id: string; kind: "welcome" };

export interface Group {
  tabs: Tab[];
  active: string | null;
}

export interface FileEntry {
  path: string;
  size: number;
}
export interface Buffer {
  content: string;
  saved: string;
}

export type Thread = ReviewThread & { outdated?: boolean };

export interface ScmChange {
  path: string;
  status: "M" | "A" | "D" | "U" | "R" | "C";
  staged: boolean;
  from?: string;
}
export type ScmState =
  | { repo: false; installed: boolean }
  | {
      repo: true;
      installed: boolean;
      branch: string;
      remote: string | null;
      autoCommit: boolean;
      ahead: number | null;
      behind: number | null;
      staged: ScmChange[];
      changes: ScmChange[];
      lastCommit: { sha: string; subject: string; date: string } | null;
    };

export interface Problem {
  path: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
}

export interface OutputLine {
  at: number;
  channel: "Luma" | "Source Control" | "Code Review";
  text: string;
}

export interface Command {
  id: string;
  title: string;
  category?: string;
  keys?: string;
  run: () => void;
  when?: () => boolean;
}

export interface Ide {
  wsId: string;
  workspaceName: string;
  canEdit: boolean;
  files: FileEntry[];
  buffers: Record<string, Buffer>;
  settings: IdeSettings;
  updateSettings: (p: Partial<IdeSettings>, replace?: boolean) => void;
  monacoTheme: string;
  dark: boolean;
  monaco: MonacoNs | null;
  setMonaco: (m: MonacoNs) => void;

  view: View | null;
  showView: (v: View, toggle?: boolean) => void;
  openFile: (path: string, opts?: { preview?: boolean; line?: number; col?: number; endCol?: number; side?: boolean }) => Promise<void>;
  openDiff: (path: string, source: "working" | "staged") => void;
  openReview: (ticketId: string, ticketNumber: number, path: string) => void;
  openSpecial: (kind: "preview" | "settings" | "settings-json" | "keybindings" | "welcome", side?: boolean) => void;
  ensureBuffer: (path: string) => Promise<Buffer | null>;
  setBuffer: (path: string, content: string) => void;
  save: (path?: string) => Promise<void>;
  saveAll: () => Promise<void>;
  revert: (path: string) => Promise<void>;
  loadFiles: () => Promise<FileEntry[] | undefined>;
  activePath: string | null;
  revealPath: string | null;
  createEntry: (dir: string, kind: "file" | "folder", name: string) => Promise<void>;
  renameEntry: (from: string, to: string, isDir: boolean) => Promise<void>;
  deleteEntry: (path: string, isDir: boolean) => Promise<void>;

  scm: ScmState | null;
  refreshScm: () => Promise<void>;
  threads: Thread[];
  refreshThreads: () => Promise<void>;
  problems: Problem[];
  output: OutputLine[];
  log: (channel: OutputLine["channel"], text: string) => void;
  showPanel: (t: PanelTab) => void;

  commands: Command[];
  runCommand: (id: string) => void;
  askAgent: (path: string, selection?: string) => void;
  registerEditor: (key: string, ed: editor.IStandaloneCodeEditor | null) => void;
  focusedEditor: () => editor.IStandaloneCodeEditor | null;
  setCursor: (c: { line: number; col: number; sel: number } | null) => void;
  searchSeed: { q: string; n: number } | null;
  reveal: { path: string; line: number; col?: number; endCol?: number; n: number } | null;
  previewVersion: number;
  bumpPreview: () => void;
}

export const IdeCtx = createContext<Ide | null>(null);
export function useIde() {
  const c = useContext(IdeCtx);
  if (!c) throw new Error("useIde outside IDE");
  return c;
}

export const tabId = {
  file: (p: string) => `file:${p}`,
  diff: (p: string, s: string) => `diff:${s}:${p}`,
  review: (t: string, p: string) => `review:${t}:${p}`,
};

export function tabTitle(t: Tab) {
  const base = (p: string) => p.split("/").pop() ?? p;
  switch (t.kind) {
    case "file":
      return base(t.path);
    case "diff":
      return `${base(t.path)} (${t.source === "staged" ? "Index" : "Working Tree"})`;
    case "review":
      return `${base(t.path)} (LUM-${t.ticketNumber} Review)`;
    case "preview":
      return "Preview";
    case "settings":
      return "Settings";
    case "settings-json":
      return "settings.json";
    case "keybindings":
      return "Keyboard Shortcuts";
    case "welcome":
      return "Welcome";
  }
}
