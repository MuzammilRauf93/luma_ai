"use client";

import dynamic from "next/dynamic";
import type { Monaco as MonacoNs } from "@monaco-editor/react";

/** Monaco is served from /public/monaco (copied on npm install), so no CDN is needed. */
let configured = false;
async function lib() {
  const m = await import("@monaco-editor/react");
  if (!configured) {
    m.loader.config({ paths: { vs: `${window.location.origin}/monaco/vs` } });
    configured = true;
  }
  return m;
}

const Loading = () => <div style={{ padding: 16, fontSize: 13, opacity: 0.6 }}>Loading editor…</div>;

export const CodeEditor = dynamic(() => lib().then((m) => m.default), { ssr: false, loading: Loading });
export const DiffCodeEditor = dynamic(() => lib().then((m) => m.DiffEditor), { ssr: false, loading: Loading });

/** VS Code's "Modern" themes (Monaco ships only the classic Dark+/Light+). */
export function defineThemes(monaco: MonacoNs) {
  monaco.editor.defineTheme("luma-dark-modern", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#1f1f1f",
      "editor.lineHighlightBorder": "#282828",
      "editorGutter.background": "#1f1f1f",
      "editorWidget.background": "#202020",
      "editorLineNumber.foreground": "#6e7681",
      "editorLineNumber.activeForeground": "#cccccc",
      "editorStickyScroll.background": "#1f1f1f",
    },
  });
  monaco.editor.defineTheme("luma-light-modern", {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#ffffff",
      "editorLineNumber.foreground": "#6e7681",
      "editorLineNumber.activeForeground": "#171184",
      "editorWidget.background": "#f8f8f8",
      "editor.lineHighlightBorder": "#eeeeee",
    },
  });
}

export const LANG: Record<string, string> = {
  html: "html", htm: "html", css: "css", scss: "scss", less: "less", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", tsx: "typescript", dart: "dart", json: "json", md: "markdown", svg: "xml", xml: "xml", py: "python", yml: "yaml", yaml: "yaml",
  sh: "shell", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", rb: "ruby", php: "php", sql: "sql", vue: "html", txt: "plaintext",
  gradle: "groovy", plist: "xml", c: "c", h: "c", cpp: "cpp", cs: "csharp",
};
export const langOf = (p: string) => (/(^|\/)dockerfile$/i.test(p) ? "dockerfile" : LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext");

export const LANG_NAMES: Record<string, string> = {
  html: "HTML", css: "CSS", scss: "SCSS", less: "Less", javascript: "JavaScript", typescript: "TypeScript", dart: "Dart", json: "JSON", markdown: "Markdown",
  xml: "XML", python: "Python", yaml: "YAML", shell: "Shell Script", plaintext: "Plain Text", go: "Go", rust: "Rust", java: "Java", kotlin: "Kotlin",
  swift: "Swift", ruby: "Ruby", php: "PHP", sql: "SQL", groovy: "Groovy", c: "C", cpp: "C++", csharp: "C#", dockerfile: "Dockerfile",
};
