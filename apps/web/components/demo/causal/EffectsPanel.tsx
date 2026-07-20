"use client";

/**
 * Forest plot of the average treatment effect of raising immunity coverage
 * (50% to 80%) on P(Rt>1), estimated four ways, against the SCM's known truth.
 * The naive estimate is biased by confounding; g-computation / IPW / AIPW
 * recover the truth. A separate row shows that adding a descendant of the
 * outcome (ICU headroom) as a control reintroduces bias.
 */

import { AlertTriangle } from "lucide-react";
import { IMMUNITY_CONTROL, IMMUNITY_TREATED, type Estimate, type EffectsReport, type CateRow } from "@/lib/causal";

const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}pp`;

function Forest({ rows, truth }: { rows: Array<Estimate & { tone: string }>; truth: number }) {
  const vals = rows.flatMap((r) => [r.ciLow, r.ciHigh, r.ate]).concat([truth, 0]);
  const lo = Math.min(...vals) - 0.02;
  const hi = Math.max(...vals) + 0.02;
  const W = 520, H = rows.length * 34 + 26, padL = 168, padR = 16;
  const x = (v: number) => padL + ((v - lo) / (hi - lo || 1)) * (W - padL - padR);

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[480px]" role="img" aria-label="Treatment-effect forest plot">
        {/* zero line and truth line */}
        <line x1={x(0)} y1={16} x2={x(0)} y2={H - 4} stroke="hsl(215 20% 40%)" strokeWidth={1} strokeDasharray="2 3" />
        <line x1={x(truth)} y1={10} x2={x(truth)} y2={H - 4} stroke="#e2e8f0" strokeWidth={1.4} strokeDasharray="4 3" />
        <text x={x(truth)} y={9} textAnchor="middle" fontSize="9" fill="#e2e8f0">true ATE {pp(truth)}</text>

        {rows.map((r, i) => {
          const y = 26 + i * 34;
          return (
            <g key={r.method}>
              <text x={4} y={y + 4} fontSize="11" fill="hsl(210 40% 92%)">{r.method}</text>
              <line x1={x(r.ciLow)} y1={y} x2={x(r.ciHigh)} y2={y} stroke={r.tone} strokeWidth={2} />
              <line x1={x(r.ciLow)} y1={y - 4} x2={x(r.ciLow)} y2={y + 4} stroke={r.tone} strokeWidth={1.5} />
              <line x1={x(r.ciHigh)} y1={y - 4} x2={x(r.ciHigh)} y2={y + 4} stroke={r.tone} strokeWidth={1.5} />
              <circle cx={x(r.ate)} cy={y} r={4} fill={r.tone} />
              <text x={W - padR} y={y - 6} textAnchor="end" fontSize="10" fill="hsl(215 20% 65%)" fontFamily="monospace">
                {pp(r.ate)} [{pp(r.ciLow)}, {pp(r.ciHigh)}]
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CateBars({ cate }: { cate: CateRow[] }) {
  const maxAbs = Math.max(...cate.map((c) => Math.abs(c.ate)), 0.01);
  return (
    <div className="space-y-2">
      {cate.map((c) => (
        <div key={c.subgroup}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-foreground">{c.subgroup} <span className="text-[10px] text-muted-foreground">n={c.n}</span></span>
            <span className="font-mono" style={{ color: "#34d399" }}>{pp(c.ate)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(c.ate) / maxAbs) * 100}%`, backgroundColor: "#34d399" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EffectsPanel({ effects }: { effects: EffectsReport }) {
  const naive = effects.estimates[0];
  const adjusted = effects.estimates.slice(1);
  const rows = [
    { ...naive, tone: "#f87171" },
    ...adjusted.map((e) => ({ ...e, tone: "#34d399" })),
  ];
  const naiveBias = naive.ate - effects.trueATE;

  return (
    <div className="space-y-5">
      <Forest rows={rows} truth={effects.trueATE} />

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Effect of raising immunity coverage from {IMMUNITY_CONTROL}% to {IMMUNITY_TREATED}% on P(Rt&gt;1), across {effects.n} sites
        ({(effects.treatedShare * 100).toFixed(0)}% in the high-immunity regime). Treatment
        assignment is confounded by region and climate, so the <span className="text-red-300">naive</span> estimate is
        off by {pp(naiveBias)} from the model truth, while g-computation, IPW, and the doubly-robust AIPW
        recover it after backdoor adjustment for {"{region, climate}"}.
      </p>

      {/* bad control warning */}
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-300" />
          <span className="text-[12px] font-semibold text-amber-200">Bad-control demonstration</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/80">
          Adding ICU headroom (a descendant of the outcome) to the adjustment set moves the g-computation
          estimate to <span className="font-mono">{pp(effects.badControl.ate)}</span> [{pp(effects.badControl.ciLow)}, {pp(effects.badControl.ciHigh)}],
          away from the truth of {pp(effects.trueATE)}. Conditioning on a consequence of transmission is
          not a harmless extra control: it induces bias.
        </p>
      </div>

      {/* CATE */}
      <div>
        <p className="mb-2 text-[12px] font-semibold text-foreground">Effect modification (CATE) by climate pressure</p>
        <CateBars cate={effects.cate} />
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          The same intervention buys more where baseline transmission pressure is high: the conditional
          effect grows across the climate tertiles, so the lever is worth most exactly where growth risk is greatest.
        </p>
      </div>
    </div>
  );
}
