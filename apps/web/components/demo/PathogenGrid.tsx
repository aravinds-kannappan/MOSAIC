"use client";

import { useState } from "react";
import { ArrowUp, ArrowDown, LayoutGrid, Table2 } from "lucide-react";
import { Sparkline } from "./Sparkline";
import { levelHex } from "./SiteLocatorMap";
import type { PathogenPanel } from "@/lib/demo/sites";

function DeltaTag({ delta }: { delta: number }) {
  if (Math.abs(delta) < 1) return <span className="text-muted-foreground">~0%</span>;
  const up = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${up ? "text-red-400" : "text-emerald-400"}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {up ? "+" : ""}{delta.toFixed(0)}%
    </span>
  );
}

function Card({ p }: { p: PathogenPanel }) {
  const c = levelHex(p.level);
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-4 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{p.name}</span>
            {!p.real && (
              <span className="rounded bg-muted px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">sim</span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-semibold" style={{ color: c }}>{p.value.toFixed(1)}</span>
            <span className="text-[10px] text-muted-foreground">WVAL /100</span>
          </div>
        </div>
        <span className="whitespace-nowrap text-[10px] text-muted-foreground">vs thr {p.threshold}</span>
      </div>

      <div className="my-2 -mx-1" style={{ color: c }}>
        <Sparkline data={p.series} color={c} threshold={p.threshold} fill height={40} />
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <DeltaTag delta={p.deltaPct} />
        <span className="text-muted-foreground">{p.pctOfThreshold.toFixed(0)}% of threshold</span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{p.trendLabel}</p>
    </div>
  );
}

function Row({ p }: { p: PathogenPanel }) {
  const c = levelHex(p.level);
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2 pr-3">
        <span className="text-foreground">{p.name}</span>
        {!p.real && <span className="ml-1.5 text-[8px] uppercase text-muted-foreground">sim</span>}
      </td>
      <td className="py-2 pr-3 text-right font-mono font-medium" style={{ color: c }}>{p.value.toFixed(1)}</td>
      <td className="py-2 pr-3 text-right text-muted-foreground">{p.threshold}</td>
      <td className="py-2 pr-3 text-right"><DeltaTag delta={p.deltaPct} /></td>
      <td className="py-2 pr-3 text-right text-muted-foreground">{p.pctOfThreshold.toFixed(0)}%</td>
      <td className="py-2 pr-3 text-right text-muted-foreground">{p.detectProp}%</td>
      <td className="py-2 w-32"><div style={{ color: c }}><Sparkline data={p.series} color={c} height={24} width={120} /></div></td>
    </tr>
  );
}

export function PathogenGrid({ panels }: { panels: PathogenPanel[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pathogen surveillance
        </h3>
        <div className="flex overflow-hidden rounded-md border border-border/60 text-[11px]">
          <button
            onClick={() => setView("cards")}
            className={`flex items-center gap-1 px-2.5 py-1 ${view === "cards" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid className="h-3 w-3" /> Cards
          </button>
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-1 px-2.5 py-1 ${view === "table" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Table2 className="h-3 w-3" /> Table
          </button>
        </div>
      </div>

      {view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {panels.map((p) => <Card key={p.key} p={p} />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/50 p-3">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Target</th>
                <th className="py-2 pr-3 text-right font-medium">WVAL</th>
                <th className="py-2 pr-3 text-right font-medium">Thr</th>
                <th className="py-2 pr-3 text-right font-medium">Δ 15d</th>
                <th className="py-2 pr-3 text-right font-medium">% thr</th>
                <th className="py-2 pr-3 text-right font-medium">Detect</th>
                <th className="py-2 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>{panels.map((p) => <Row key={p.key} p={p} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
