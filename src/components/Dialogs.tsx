"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

/**
 * In-app dialogs and toasts (replaces browser alert/confirm/prompt).
 *   if (!(await confirmDialog({ title, body, confirmLabel, danger }))) return;
 *   const name = await promptDialog({ title, label, initial });
 *   toast("Saved");  toast("Couldn't save", "error");
 * <DialogHost /> is mounted once in AppShell.
 */

type ConfirmOpts = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type PromptOpts = { title: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string };
type Req =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };
type Toast = { id: number; text: string; tone: "success" | "error" | "info" };

let push: ((r: Req) => void) | null = null;
let pushToast: ((t: Toast) => void) | null = null;
let seq = 0;

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => (push ? push({ kind: "confirm", opts, resolve }) : resolve(window.confirm(opts.title))));
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => (push ? push({ kind: "prompt", opts, resolve }) : resolve(window.prompt(opts.title, opts.initial))));
}

export function toast(text: string, tone: Toast["tone"] = "success") {
  pushToast?.({ id: ++seq, text, tone });
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const cur = queue[0];

  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    pushToast = (t) => {
      setToasts((ts) => [...ts.slice(-3), t]);
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.tone === "error" ? 6000 : 3000);
    };
    return () => {
      push = null;
      pushToast = null;
    };
  }, []);

  useEffect(() => {
    if (!cur) return;
    if (cur.kind === "prompt") {
      setValue(cur.opts.initial ?? "");
      setTimeout(() => input.current?.select(), 30);
    } else setTimeout(() => ok.current?.focus(), 30);
  }, [cur]);

  const close = (answer: boolean) => {
    if (!cur) return;
    if (cur.kind === "confirm") cur.resolve(answer);
    else cur.resolve(answer ? value.trim() || null : null);
    setQueue((q) => q.slice(1));
  };

  return (
    <>
      {cur && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4 bg-black/35 backdrop-blur-[2px]" onMouseDown={() => close(false)}>
          <form
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="dlg-title"
            className="card w-full max-w-md p-5 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && close(false)}
            onSubmit={(e) => {
              e.preventDefault();
              close(true);
            }}
          >
            <div className="flex gap-3">
              {cur.kind === "confirm" && cur.opts.danger && (
                <span className="w-9 h-9 rounded-full bg-danger/10 text-danger grid place-items-center shrink-0"><AlertTriangle size={17} /></span>
              )}
              <div className="min-w-0 flex-1">
                <h2 id="dlg-title" className="font-semibold">{cur.opts.title}</h2>
                {cur.kind === "confirm" && cur.opts.body && <p className="text-sm text-muted mt-1.5">{cur.opts.body}</p>}
                {cur.kind === "prompt" && (
                  <>
                    {cur.opts.label && <label className="label mt-3" htmlFor="dlg-input">{cur.opts.label}</label>}
                    <input id="dlg-input" ref={input} className="input mt-1" value={value} placeholder={cur.opts.placeholder} onChange={(e) => setValue(e.target.value)} />
                  </>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" className="btn" onClick={() => close(false)}>
                {(cur.kind === "confirm" && cur.opts.cancelLabel) || "Cancel"}
              </button>
              <button ref={ok} className={clsx("btn", cur.kind === "confirm" && cur.opts.danger ? "btn-danger-solid" : "btn-primary")}>
                {cur.opts.confirmLabel ?? (cur.kind === "prompt" ? "OK" : "Confirm")}
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="fixed bottom-4 right-4 z-[80] flex flex-col gap-2 items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card shadow-xl px-3.5 py-2.5 text-sm flex items-center gap-2 max-w-sm">
            {t.tone === "success" ? <CheckCircle2 size={15} className="text-success" /> : t.tone === "error" ? <AlertTriangle size={15} className="text-danger" /> : <Info size={15} className="text-accent" />}
            <span>{t.text}</span>
            <button className="text-muted hover:text-ink ml-1" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))} aria-label="Dismiss"><X size={13} /></button>
          </div>
        ))}
      </div>
    </>
  );
}
