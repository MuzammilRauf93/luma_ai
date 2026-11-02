"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Code2, ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { SimulatorPreview } from "@/components/SimulatorPreview";
import { IDE } from "@/components/ide/IDE";
import { api } from "@/lib/client";

export default function EditorPageWrapper() {
  return (
    <Suspense>
      <EditorPage />
    </Suspense>
  );
}

/** Code: a VS Code-style IDE, or "Simple mode" that only shows the live result. */
function EditorPage() {
  const { workspace } = useWorkspace();
  const [simple, setSimple] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setSimple(localStorage.getItem("luma-simple-mode") === "1");
    } catch {
      setSimple(false);
    }
  }, []);
  const toggle = () =>
    setSimple((s) => {
      try {
        localStorage.setItem("luma-simple-mode", s ? "0" : "1");
      } catch {}
      return !s;
    });
  if (!workspace || simple === null) return <div className="p-8 text-sm text-muted">Loading…</div>;
  return (
    <div className="h-full min-h-0" data-tour="editor">
      {simple ? <SimpleView onShowCode={toggle} /> : <IDE onSimpleMode={toggle} />}
    </div>
  );
}

function SimpleView({ onShowCode }: { onShowCode: () => void }) {
  const { workspace, fileVersion } = useWorkspace();
  const [files, setFiles] = useState<{ path: string }[]>([]);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [page, setPage] = useState("");
  const [n, setN] = useState(0);
  useEffect(() => {
    api<{ files: { path: string }[] }>(`/api/workspaces/${workspace!.id}/files`).then((d) => setFiles(d.files)).catch(() => undefined);
  }, [workspace, fileVersion]);
  const html = useMemo(() => files.filter((f) => /\.html?$/.test(f.path)), [files]);
  const isFlutter = workspace?.platform === "flutter" || files.some((f) => f.path === "pubspec.yaml");
  const src = `/preview/${workspace!.id}/${page}`;
  const width = device === "mobile" ? 390 : device === "tablet" ? 768 : undefined;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 h-12 px-3 md:px-4 border-b bg-panel shrink-0">
        <h1 className="font-semibold text-sm">{isFlutter ? "Your app" : "Your website"}</h1>
        {!isFlutter && (
          <>
            <select className="input !py-0.5 !text-xs !w-auto max-w-[180px]" value={page} onChange={(e) => setPage(e.target.value)}>
              {html.map((f) => (
                <option key={f.path} value={f.path === "index.html" ? "" : f.path}>{f.path}</option>
              ))}
            </select>
            <div className="flex">
              {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} className={clsx("btn btn-ghost btn-sm !px-2", device === d && "!bg-panel-2")} onClick={() => setDevice(d)} aria-label={d}><Icon size={13} /></button>
              ))}
              <button className="btn btn-ghost btn-sm !px-2" onClick={() => setN((x) => x + 1)} aria-label="Refresh preview"><RefreshCw size={13} /></button>
              <a className="btn btn-ghost btn-sm !px-2" href={src} target="_blank" rel="noreferrer" aria-label="Open in new tab"><ExternalLink size={13} /></a>
            </div>
          </>
        )}
        <button className="btn btn-sm ml-auto" onClick={onShowCode}><Code2 size={12} /> Open code editor</button>
      </div>
      <div className="flex-1 min-h-0 flex justify-center bg-panel-2">
        {isFlutter ? (
          <SimulatorPreview workspaceId={workspace!.id} />
        ) : (
          <iframe key={`${n}-${fileVersion}`} src={src} title="Live preview" className="bg-white h-full border-0" style={{ width: width ?? "100%", boxShadow: width ? "0 0 0 1px var(--border)" : undefined }} />
        )}
      </div>
    </div>
  );
}
