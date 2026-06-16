"use client";

import {
  AreaChart, Area, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  Droplets, Dna, Newspaper, GitMerge, CircleCheck, CircleAlert, CircleSlash,
  Clock, Users, TrendingUp, Activity,
} from "lucide-react";
import { Sparkline } from "./Sparkline";
import { levelHex } from "./SiteLocatorMap";
import type { SiteState, LogEvent, StreamHealth, Lineage } from "@/lib/demo/sites";

/* ------------------------------ Site header --------------------------- */

export function SiteHeader({ site }: { site: SiteState }) {
  const c = levelHex(site.level);
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/50 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
          <Droplets className="h-6 w-6" style={{ color: c }} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: c }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c }} />
            </span>
            <h1 className="text-lg font-semibold text-foreground sm:text-xl">{site.label}</h1>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{site.international ? `SITE ${site.wwtpId}` : `NWSS WWTP-${site.wwtpId}`}</span>
            <span className="mx-1.5">·</span>
            {site.county}, {site.jurisdiction}
            <span className="mx-1.5">·</span>
            <span style={{ color: c }}>{site.statusLabel}</span>
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-background px-4 py-2.5 text-right">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Wastewater lead time</p>
        <p className="font-mono text-xl font-semibold text-primary">{site.leadDays} d</p>
        <p className="text-[10px] text-emerald-400">ahead of clinical confirmation</p>
      </div>
    </div>
  );
}

/* --------------------------- Early-warning banner --------------------- */

export function EarlyWarningBanner({ site }: { site: SiteState }) {
  const stats = [
    { icon: TrendingUp, value: `${(site.pOutbreak * 100).toFixed(0)}%`, label: "P(Rt > 1) fused posterior" },
    { icon: Activity, value: site.rt.toFixed(2), label: `Rt  [${site.rtLow.toFixed(2)}–${site.rtHigh.toFixed(2)}]` },
    { icon: Users, value: site.populationServed.toLocaleString(), label: "population under surveillance" },
    { icon: Clock, value: `${site.leadDays} d`, label: "median early-warning lead" },
  ];
  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 px-5 py-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Early warning</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clinical case data confirms an outbreak only after people seek care. MOSAIC reads the
            wastewater first — flagging growth roughly {site.leadDays} days ahead.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="flex items-center gap-1.5">
                <s.icon className="h-3.5 w-3.5 text-primary" />
                <span className="font-mono text-lg font-semibold text-foreground">{s.value}</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Event log ----------------------------- */

const STREAM_ICON: Record<LogEvent["stream"], React.ElementType> = {
  wastewater: Droplets, genomic: Dna, text: Newspaper, fusion: GitMerge, system: Activity,
};

export function EventLog({ events, compact }: { events: LogEvent[]; compact?: boolean }) {
  return (
    <div className="space-y-2">
      {events.map((e) => {
        const Icon = STREAM_ICON[e.stream];
        const c = levelHex(e.level);
        return (
          <div key={e.id} className="flex gap-3 rounded-lg border border-border/50 bg-card/40 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60" style={{ color: c }}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium text-foreground">{e.title}</p>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {e.daysAgo === 0 ? "today" : `${e.daysAgo}d ago`}
                </span>
              </div>
              {!compact && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{e.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------ Lineages ------------------------------ */

const LIN_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#22d3ee", "#f472b6"];

export function LineagePanel({ lineages }: { lineages: Lineage[] }) {
  return (
    <div>
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full">
        {lineages.map((l, i) => (
          <div key={l.name} style={{ width: `${l.frequency * 100}%`, backgroundColor: LIN_COLORS[i % LIN_COLORS.length] }} title={`${l.name} ${(l.frequency * 100).toFixed(0)}%`} />
        ))}
      </div>
      <div className="space-y-1.5">
        {lineages.map((l, i) => (
          <div key={l.name} className="flex items-center justify-between text-[12px]">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LIN_COLORS[i % LIN_COLORS.length] }} />
              <span className="font-mono text-foreground">{l.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground">{(l.frequency * 100).toFixed(0)}%</span>
              <span className={`w-12 text-right text-[10px] ${l.delta > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {l.delta > 0 ? "+" : ""}{(l.delta * 100).toFixed(1)}pp
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Stream health -------------------------- */

const HEALTH_ICON = { ok: CircleCheck, stale: CircleAlert, down: CircleSlash };
const HEALTH_COLOR = { ok: "#34d399", stale: "#fbbf24", down: "#f87171" };

export function StreamHealthPanel({ streams }: { streams: StreamHealth[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {streams.map((s) => {
        const Icon = HEALTH_ICON[s.status];
        const c = HEALTH_COLOR[s.status];
        return (
          <div key={s.name} className="rounded-lg border border-border/50 bg-card/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{s.name}</span>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: c }}>
                <Icon className="h-3.5 w-3.5" /> {s.status}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{s.source}</p>
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{s.detail}</span>
              <span className="font-mono">~{s.latencyHours}h latency</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Briefing ----------------------------- */

export function BriefingCard({ site }: { site: SiteState }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Daily surveillance briefing</h3>
        <span className="text-[10px] text-muted-foreground">auto-generated · {site.dateEnd}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{site.briefing}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/50 pt-3 text-center">
        <div>
          <p className="font-mono text-base font-semibold text-foreground">{(site.pOutbreak * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-muted-foreground">P(Rt&gt;1)</p>
        </div>
        <div>
          <p className="font-mono text-base font-semibold text-foreground">{site.rt.toFixed(2)}</p>
          <p className="text-[10px] text-muted-foreground">Rt median</p>
        </div>
        <div>
          <p className="font-mono text-base font-semibold text-foreground">{site.lineages[0]?.name ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground">dominant lineage</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Forecast ------------------------------ */

export function ForecastPanel({ site }: { site: SiteState }) {
  const c = levelHex(site.level);
  const data = site.posteriorSeries;
  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="postFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                <stop offset="100%" stopColor={c} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(215 20% 60%)" }} tickFormatter={(d) => (d === 0 ? "now" : `${d > 0 ? "+" : ""}${d}d`)} stroke="hsl(217 33% 20%)" />
            <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(215 20% 60%)" }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} stroke="hsl(217 33% 20%)" />
            <Tooltip
              contentStyle={{ background: "hsl(222 44% 9%)", border: "1px solid hsl(217 33% 20%)", borderRadius: 8, fontSize: 11 }}
              labelFormatter={(d) => (d === 0 ? "today" : `${d > 0 ? "+" : ""}${d} days`)}
              formatter={(v: number) => [`${(v * 100).toFixed(0)}%`, "P(Rt>1)"]}
            />
            <ReferenceLine y={0.5} stroke="hsl(215 20% 50%)" strokeDasharray="3 3" />
            <ReferenceLine x={0} stroke={c} strokeDasharray="2 2" />
            <Area type="monotone" dataKey="p" stroke={c} strokeWidth={2} fill="url(#postFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Fused P(Rt&gt;1) posterior, 45 days back through a 14-day projection. The dashed line marks
        the 50% decision threshold; the vertical marker is today.
      </p>
    </div>
  );
}
