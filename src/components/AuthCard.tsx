"use client";

import type { ReactNode } from "react";

/** Centered card used by the sign-in and invite pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center p-4" style={{ background: "radial-gradient(60% 50% at 50% 0%, var(--accent-soft), var(--bg) 70%)" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 justify-center mb-6">
          <span className="w-8 h-8 rounded-lg grid place-items-center text-white text-sm font-bold" style={{ background: "linear-gradient(135deg,#7c3aed,#db2777)" }}>L</span>
          <span className="font-semibold text-lg tracking-tight">Luma AI</span>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1 mb-4">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
