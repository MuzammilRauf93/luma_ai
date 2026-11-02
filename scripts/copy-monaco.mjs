// Copies Monaco's prebuilt AMD bundle into /public so the code editor works offline
// (no CDN needed). Runs automatically after `npm install`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min", "vs");
const dest = path.join(process.cwd(), "public", "monaco", "vs");
if (!existsSync(src)) {
  console.warn("[luma] monaco-editor not found; the editor will fall back to the CDN.");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("[luma] Monaco copied to public/monaco/vs");
