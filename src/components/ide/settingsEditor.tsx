"use client";

import { useMemo, useRef, useState } from "react";
import { FileJson, RotateCcw, Upload } from "lucide-react";
import { toast } from "../Dialogs";
import { CodeEditor, defineThemes } from "./monaco";
import { kbd } from "./bits";
import { useIde } from "./ctx";
import { DEFAULTS, SETTING_DEFS, parseJsonc, sanitize, settingsJson, type IdeSettings, type SettingDef } from "./settings";

/** VS Code-style Settings editor (search box, groups, per-setting reset). */
export function SettingsEditor() {
  const ide = useIde();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("Commonly Used");
  const fileInput = useRef<HTMLInputElement>(null);
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];
  const shown = SETTING_DEFS.filter((d) => (q ? `${d.title} ${d.description} ${d.key}`.toLowerCase().includes(q.toLowerCase()) : d.group === group));
  const modified = (d: SettingDef) => JSON.stringify(ide.settings[d.key]) !== JSON.stringify(DEFAULTS[d.key]);

  const importFile = async (f: File) => {
    try {
      const parsed = sanitize(parseJsonc(await f.text()));
      const n = Object.keys(parsed).length;
      ide.updateSettings(parsed);
      toast(n ? `Imported ${n} setting${n === 1 ? "" : "s"} from ${f.name}` : "No supported settings found in that file", n ? "success" : "info");
    } catch (e) {
      toast(`Couldn't read ${f.name}: ${(e as Error).message}`, "error");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-4 pb-2 shrink-0 max-w-[1000px] w-full mx-auto">
        <div className="flex items-center gap-2">
          <input className="ide-input !py-1.5 !text-[14px]" placeholder="Search settings" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button className="ide-icon-btn" title="Open Settings (JSON)" onClick={() => ide.openSpecial("settings-json")}><FileJson size={16} /></button>
          <button className="ide-icon-btn" title="Import VS Code settings.json" onClick={() => fileInput.current?.click()}><Upload size={15} /></button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        </div>
        <div className="flex items-center gap-4 mt-3 text-[13px]" style={{ borderBottom: "1px solid var(--ide-border)" }}>
          <span className="pb-1.5" style={{ borderBottom: "1px solid var(--ide-focus)" }}>User</span>
          <span className="pb-1.5 text-[12px] ml-auto" style={{ color: "var(--ide-muted)" }}>
            Coming from VS Code? Import your <code>settings.json</code> with the upload button, or paste it into the JSON view.
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0 flex max-w-[1000px] w-full mx-auto">
        {!q && (
          <nav className="w-[180px] shrink-0 pl-6 pt-2 text-[13px] hidden md:block">
            {groups.map((g) => (
              <button key={g} className="block w-full text-left px-2 py-1 rounded" style={{ background: g === group ? "var(--ide-select)" : undefined, fontWeight: g === group ? 600 : 400 }} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
            <button className="block w-full text-left px-2 py-1 rounded mt-3" style={{ color: "#3794ff" }} onClick={() => ide.openSpecial("keybindings")}>Keyboard Shortcuts</button>
          </nav>
        )}
        <div className="flex-1 min-w-0 overflow-auto px-6 pb-10">
          <h2 className="text-[20px] font-semibold mt-2 mb-3">{q ? `${shown.length} Settings Found` : group}</h2>
          {shown.map((d) => (
            <SettingRow key={d.key} def={d} value={ide.settings[d.key]} modified={modified(d)} onChange={(v) => ide.updateSettings({ [d.key]: v } as Partial<IdeSettings>)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ def, value, modified, onChange }: { def: SettingDef; value: unknown; modified: boolean; onChange: (v: unknown) => void }) {
  const [cat, name] = def.title.includes(": ") ? [def.title.slice(0, def.title.lastIndexOf(": ") + 1), def.title.slice(def.title.lastIndexOf(": ") + 2)] : ["", def.title];
  const k = def.kind;
  return (
    <div className="group relative py-3 pl-3 -ml-3 pr-2 rounded hover:bg-[var(--ide-hover)]" style={{ borderLeft: modified ? "2px solid var(--ide-focus)" : "2px solid transparent" }}>
      <div className="text-[13px]">
        <span style={{ color: "var(--ide-muted)" }}>{cat} </span>
        <b>{name}</b>
        {modified && (
          <button className="ml-2 inline-flex align-middle ide-icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100" title="Reset Setting" onClick={() => onChange(DEFAULTS[def.key])}>
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {k.type === "boolean" ? (
        <label className="flex items-start gap-2 mt-1 text-[13px] cursor-pointer" style={{ color: "var(--ide-muted)" }}>
          <input type="checkbox" className="mt-0.5" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {def.description}
        </label>
      ) : (
        <>
          <div className="text-[13px] mt-0.5 mb-1.5" style={{ color: "var(--ide-muted)" }}>{def.description}</div>
          {k.type === "enum" ? (
            <select className="ide-input !w-auto min-w-[220px]" value={String(value)} onChange={(e) => onChange(e.target.value)}>
              {k.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : k.type === "number" ? (
            <input className="ide-input !w-[220px]" type="number" min={k.min} max={k.max} value={Number(value)} onChange={(e) => e.target.value !== "" && onChange(Math.min(k.max ?? Infinity, Math.max(k.min ?? -Infinity, Number(e.target.value))))} />
          ) : k.type === "numbers" ? (
            <input className="ide-input !w-[220px]" placeholder="e.g. 80, 120" defaultValue={(value as number[]).join(", ")} onBlur={(e) => onChange(e.target.value.split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0))} />
          ) : (
            <input className="ide-input max-w-[420px]" defaultValue={String(value)} onBlur={(e) => onChange(e.target.value)} />
          )}
        </>
      )}
    </div>
  );
}

/** settings.json — same keys as VS Code, so people can paste theirs. */
export function SettingsJsonEditor() {
  const ide = useIde();
  const initial = useMemo(() => settingsJson(ide.settings), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    try {
      const raw = parseJsonc(text);
      const clean = sanitize(raw);
      const ignored = Object.keys(raw).filter((k) => !(k in clean));
      ide.updateSettings(clean, true);
      setError(null);
      toast(`Settings saved${ignored.length ? ` (${ignored.length} unsupported setting${ignored.length === 1 ? "" : "s"} ignored)` : ""}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 h-[30px] px-3 shrink-0 text-[12px]" style={{ borderBottom: "1px solid var(--ide-border)", color: error ? "var(--ide-deleted)" : "var(--ide-muted)" }}>
        <span className="truncate">{error ?? `Edit, then press ${kbd("Mod+S")} or Apply. Comments and trailing commas are allowed.`}</span>
        <button className="ide-btn !py-0.5 !px-2 !text-[12px] ml-auto" onClick={apply}>Apply</button>
      </div>
      <div
        className="flex-1 min-h-0"
        onKeyDownCapture={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            e.stopPropagation();
            apply();
          }
        }}
      >
        <CodeEditor
          path="inmemory://luma/settings.json"
          language="json"
          value={text}
          theme={ide.monacoTheme}
          beforeMount={(m) => {
            defineThemes(m);
            m.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: "ignore" });
          }}
          onChange={(v) => setText(v ?? "")}
          options={{ fontSize: ide.settings["editor.fontSize"], fontFamily: ide.settings["editor.fontFamily"], minimap: { enabled: false }, automaticLayout: true, tabSize: 2 }}
        />
      </div>
    </div>
  );
}

export function KeybindingsEditor() {
  const ide = useIde();
  const [q, setQ] = useState("");
  const editorKeys: [string, string][] = [
    ["Find", "Mod+F"], ["Replace", "Mod+H"], ["Go to Line/Column…", "Ctrl+G"], ["Add Selection To Next Find Match", "Mod+D"], ["Select All Occurrences of Find Match", "Mod+Shift+L"],
    ["Add Cursor Above", "Mod+Alt+Up"], ["Add Cursor Below", "Mod+Alt+Down"], ["Move Line Up", "Alt+Up"], ["Move Line Down", "Alt+Down"], ["Copy Line Down", "Shift+Alt+Down"],
    ["Delete Line", "Mod+Shift+K"], ["Toggle Line Comment", "Mod+/"], ["Toggle Block Comment", "Shift+Alt+A"], ["Format Document", "Shift+Alt+F"], ["Fold", "Mod+Shift+["], ["Unfold", "Mod+Shift+]"],
    ["Go to Definition", "F12"], ["Peek Definition", "Alt+F12"], ["Rename Symbol", "F2"], ["Quick Fix…", "Mod+."], ["Trigger Suggest", "Ctrl+Space"], ["Go to Symbol in Editor…", "Mod+Shift+O"],
    ["Expand Selection", "Shift+Alt+Right"], ["Indent Line", "Mod+]"], ["Outdent Line", "Mod+["], ["Undo", "Mod+Z"], ["Redo", "Mod+Shift+Z"],
  ];
  const rows = [
    ...ide.commands.filter((c) => c.keys).map((c) => ({ title: `${c.category ? `${c.category}: ` : ""}${c.title}`, keys: c.keys!, source: "Workbench" })),
    ...editorKeys.map(([title, keys]) => ({ title, keys, source: "Editor" })),
  ].filter((r) => !q || `${r.title} ${kbd(r.keys)} ${r.keys}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="h-full flex flex-col max-w-[1000px] mx-auto w-full">
      <div className="px-6 pt-4 pb-3 shrink-0">
        <input className="ide-input !py-1.5 !text-[14px]" placeholder="Type to search in keybindings" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <p className="text-[12px] mt-2" style={{ color: "var(--ide-muted)" }}>Luma uses VS Code&apos;s default keyboard shortcuts. A few that browsers reserve use an alternative (Close Editor is {kbd("Alt+W")}).</p>
      </div>
      <div className="flex-1 overflow-auto px-6 pb-8">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left" style={{ color: "var(--ide-muted)" }}>
              <th className="font-normal py-1">Command</th>
              <th className="font-normal py-1">Keybinding</th>
              <th className="font-normal py-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-[var(--ide-hover)]" style={{ background: i % 2 ? "rgba(128,128,128,.04)" : undefined }}>
                <td className="py-1 pr-4">{r.title}</td>
                <td className="py-1 pr-4">
                  <kbd className="px-1.5 py-0.5 rounded text-[12px]" style={{ background: "rgba(128,128,128,.17)", border: "1px solid rgba(128,128,128,.3)", fontFamily: "inherit" }}>{kbd(r.keys)}</kbd>
                </td>
                <td className="py-1" style={{ color: "var(--ide-muted)" }}>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
