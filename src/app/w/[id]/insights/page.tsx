"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { BarChart3, Table2 } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { AgentAvatar, EmptyState, PageHeader } from "@/components/ui";
import { api, fmtTokens, fmtUsd } from "@/lib/client";
import type { WorkspaceMetrics } from "@/lib/metrics";

/* Chart colours: validated categorical slots 1–2, with dark steps for Luma's .dark theme. */
const VIZ_CSS = `
.viz { --s1:#2a78d6; --s2:#eb6834; --grid: color-mix(in srgb, var(--text) 10%, transparent); }
.dark .viz { --s1:#3987e5; --s2:#d95926; }
`;

const RANGES = [7, 30, 90] as const;

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
function dur(sec: number | null) {
  if (sec === null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
const hours = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
const shortDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export default function InsightsPage() {
  const { workspace, eventVersion } = useWorkspace();
  const [days, setDays] = useState<number>(30);
  const [m, setM] = useState<WorkspaceMetrics | null>(null);
  const [asTable, setAsTable] = useState(false);

  const load = useCallback(async () => {
    if (workspace) setM(await api<WorkspaceMetrics>(`/api/workspaces/${workspace.id}/metrics?days=${days}`));
  }, [workspace, days]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load, eventVersion]);

  if (!workspace) return <div className="p-8 text-sm text-muted">Loading…</div>;
  const t = m?.totals;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-8 viz">
      <style>{VIZ_CSS}</style>
      <PageHeader title="Insights" subtitle="How your AI team is doing: runs, reliability, speed and usage." />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={clsx("btn btn-sm !h-7 !border-0", days === r ? "!bg-panel-2" : "btn-ghost text-muted")}>
              Last {r} days
            </button>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost ml-auto" onClick={() => setAsTable((x) => !x)}>
          {asTable ? <><BarChart3 size={13} /> Show charts</> : <><Table2 size={13} /> Show as table</>}
        </button>
      </div>

      {!m || !t ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : t.runs === 0 && t.tokens === 0 ? (
        <div className="card">
          <EmptyState icon={<BarChart3 size={22} />} title="No activity in this period" body="Run some tickets and the numbers show up here." />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Tile label="Agent runs" value={String(t.runs)} sub={`${t.completed} completed · ${t.failed} failed`} />
            <Tile label="Completed without errors" value={pct(t.successRate)} sub={`${t.cancelled} stopped · ${t.interrupted} interrupted`} />
            <Tile label="Tickets done" value={String(t.ticketsDone)} sub={`median ${hours(t.medianHoursToDone)} from created to Done`} />
            <Tile label="Tokens" value={fmtTokens(t.tokens)} sub={t.costUsd > 0 ? `≈ ${fmtUsd(t.costUsd)}` : "plan usage"} />
            <Tile label="Typical run" value={dur(t.medianRunSeconds)} sub="median length of a completed run" />
            <Tile label="To first review" value={hours(t.medianHoursToReview)} sub="median, created → In Review" />
            <Tile label="Checks passed" value={pct(t.commandPassRate)} sub={`${t.commands} commands run`} />
            <Tile label="Handoffs · questions" value={`${t.handoffs} · ${t.questions}`} sub={`${t.deploys} deploys${t.deployFailures ? `, ${t.deployFailures} failed` : ""}`} />
          </div>

          {asTable ? (
            <section className="card p-5 mb-5 overflow-x-auto">
              <h2 className="font-semibold mb-3">Daily activity</h2>
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted text-left">
                  <tr><th className="font-medium py-1.5">Day</th><th className="font-medium text-right">Completed runs</th><th className="font-medium text-right">Didn't finish</th><th className="font-medium text-right">Tokens</th></tr>
                </thead>
                <tbody>
                  {m.series.filter((d) => d.completed || d.notFinished || d.tokens).map((d) => (
                    <tr key={d.date} className="border-t"><td className="py-1.5">{shortDate(d.date)}</td><td className="text-right">{d.completed}</td><td className="text-right">{d.notFinished}</td><td className="text-right">{fmtTokens(d.tokens)}</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4 mb-5">
              <section className="card p-5">
                <h2 className="font-semibold">Runs per day</h2>
                <Legend items={[{ color: "var(--s1)", label: "Completed" }, { color: "var(--s2)", label: "Didn't finish (failed, stopped or interrupted)" }]} />
                <Bars
                  data={m.series}
                  keys={[{ key: "completed", color: "var(--s1)", label: "Completed" }, { key: "notFinished", color: "var(--s2)", label: "Didn't finish" }]}
                  fmt={(v) => String(v)}
                  label="Agent runs per day"
                />
              </section>
              <section className="card p-5">
                <h2 className="font-semibold">Tokens per day</h2>
                <p className="text-xs text-muted mb-2">Input + output tokens across all agents.</p>
                <Bars data={m.series} keys={[{ key: "tokens", color: "var(--s1)", label: "Tokens" }]} fmt={fmtTokens} label="Tokens per day" />
              </section>
            </div>
          )}

          <section className="card p-5 overflow-x-auto">
            <h2 className="font-semibold mb-3">By agent</h2>
            <table className="w-full text-sm tabular-nums min-w-[640px]">
              <thead className="text-xs text-muted text-left">
                <tr>
                  <th className="font-medium py-1.5">Agent</th>
                  <th className="font-medium text-right">Runs</th>
                  <th className="font-medium w-[22%] pl-6">Completed</th>
                  <th className="font-medium text-right">Typical run</th>
                  <th className="font-medium text-right">Tickets done</th>
                  <th className="font-medium text-right">Handoffs</th>
                  <th className="font-medium text-right">Checks run</th>
                  <th className="font-medium text-right">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {m.agents.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-2">
                      <span className="flex items-center gap-2"><AgentAvatar agent={a} size={24} /><span><span className="font-medium">{a.name}</span> <span className="text-xs text-muted">{a.role}</span></span></span>
                    </td>
                    <td className="text-right">{a.runs}</td>
                    <td>
                      <span className="flex items-center gap-2 pl-3">
                        <span className="flex-1 h-1.5 rounded-full bg-panel-2 overflow-hidden" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${(a.successRate ?? 0) * 100}%`, background: "var(--s1)" }} />
                        </span>
                        <span className="w-10 text-right">{pct(a.successRate)}</span>
                      </span>
                    </td>
                    <td className="text-right">{dur(a.avgSeconds)}</td>
                    <td className="text-right">{a.ticketsDone}</td>
                    <td className="text-right">{a.handoffsOut}</td>
                    <td className="text-right">{a.commands}</td>
                    <td className="text-right">{fmtTokens(a.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted mt-1 mb-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

type Row = WorkspaceMetrics["series"][number];

/** Stacked daily bars with a recessive grid, 2px gaps between segments and a hover tooltip. */
function Bars({ data, keys, fmt, label }: { data: Row[]; keys: { key: "completed" | "notFinished" | "tokens"; color: string; label: string }[]; fmt: (n: number) => string; label: string }) {
  const W = 560;
  const H = 180;
  const pad = { l: 40, r: 8, t: 8, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const total = (d: Row) => keys.reduce((s, k) => s + d[k.key], 0);
  const max = Math.max(1, ...data.map(total));
  const nice = useMemo(() => {
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step;
    return { top, ticks: [0, top / 2, top] };
  }, [max]);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / data.length;
  const barW = Math.max(2, Math.min(18, bw - 2));
  const y = (v: number) => pad.t + ih - (v / nice.top) * ih;
  const every = Math.ceil(data.length / 6);

  return (
    <div className="relative" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}>
        {nice.ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(tk) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">{fmt(tk)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * bw + (bw - barW) / 2;
          let acc = 0;
          const segs = keys.map((k, j) => {
            const v = d[k.key];
            if (!v) return null;
            const y0 = y(acc);
            acc += v;
            const y1 = y(acc);
            const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0)); // 2px surface gap between stacked segments
            const isTop = keys.slice(j + 1).every((kk) => !d[kk.key]);
            return <rect key={k.key} x={x} y={y1} width={barW} height={h} rx={isTop ? Math.min(4, barW / 2) : 0} fill={k.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
          });
          return (
            <g key={d.date}>
              {segs}
              {/* Hit target: the whole day column, bigger than the bar */}
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
              {i % every === 0 && (
                <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">{shortDate(d.date)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute pointer-events-none card px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%`, top: 0, transform: `translateX(${hover > data.length / 2 ? "-105%" : "5%"})` }}
        >
          <div className="font-medium mb-0.5">{shortDate(data[hover].date)}</div>
          {keys.map((k) => (
            <div key={k.key} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: k.color }} />
              <span className="text-muted">{k.label}</span>
              <span className="ml-auto pl-3 tabular-nums">{fmt(data[hover][k.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
