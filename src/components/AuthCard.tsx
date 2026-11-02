"use client";

import type { ReactNode } from "react";

/** Centered card used by the sign-in and invite pages. */
export function AuthCard({ title, subtitle, children, back }: { title: string; subtitle?: ReactNode; children: ReactNode; back?: boolean }) {
  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-soft), var(--bg) 70%)" }}>
      <div className="w-full max-w-sm">
        <a href="/welcome" className="flex items-center gap-2.5 justify-center mb-6" aria-label="Luma AI home">
          <span className="w-8 h-8 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>L</span>
          <span className="font-semibold text-lg tracking-tight">Luma AI</span>
        </a>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1 mb-4">{subtitle}</p>}
          {children}
        </div>
        {back && <p className="text-center text-xs text-muted mt-4"><a className="hover:underline" href="/welcome">← Back to the Luma home page</a></p>}
      </div>
    </div>
  );
}
