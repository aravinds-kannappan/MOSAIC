"use client";

import { Droplets, Dna, Newspaper, GitMerge, Gauge, BellRing, ArrowRight } from "lucide-react";
import type { SiteState } from "@/lib/demo/sites";

interface Stage {
  icon: React.ElementType;
  label: string;
  sub: string;
  rows: { k: string; v: string }[];
  accent: string;
}

/**
 * The MOSAIC inference pipeline, rendered as a stage-by-stage schematic —
 * the surveillance analog of a treatment-plant process diagram. When a `site`
 * is supplied it shows that site's live values flowing through each stage.
 */
export function PipelineSchematic({ site }: { site?: SiteState }) {
  const sars = site?.panels.find((p) => p.key === "sars2");
  const pWw = sars ? sars.value / 100 : 0.71;
  const pGen = site ? Math.min(0.95, (site.lineages[0]?.delta ?? 0) * 4 + 0.3) : 0.42;
  const pText = site ? Math.min(0.9, site.events.filter((e) => e.stream === "text").length * 0.2 + 0.25) : 0.31;

  const stages: Stage[] = [
    {
      icon: Droplets, label: "Ingest", sub: "3 surveillance streams", accent: "text-emerald-400",
      rows: [
        { k: "Wastewater", v: "CDC NWSS" },
        { k: "Genomic", v: "Nextstrain" },
        { k: "Outbreak text", v: "WHO · ProMED" },
      ],
    },
    {
      icon: Gauge, label: "Per-stream detectors", sub: "anomaly scoring", accent: "text-sky-400",
      rows: [
        { k: "BOCPD", v: `${(pWw * 100).toFixed(0)}%` },
        { k: "KL-divergence", v: `${(pGen * 100).toFixed(0)}%` },
        { k: "NLP + change-pt", v: `${(pText * 100).toFixed(0)}%` },
      ],
    },
    {
      icon: GitMerge, label: "Bayesian fusion", sub: "hierarchical model", accent: "text-violet-400",
      rows: [
        { k: "EpiEstim Rt", v: site ? site.rt.toFixed(2) : "1.34" },
        { k: "Learned weights", v: "logistic" },
        { k: "Posterior", v: "NUTS / MCMC" },
      ],
    },
    {
      icon: BellRing, label: "Calibrate → alert", sub: "P(Rt > 1)", accent: "text-amber-400",
      rows: [
        { k: "Isotonic ECE", v: "0.086" },
        { k: "P(Rt>1)", v: site ? `${(site.pOutbreak * 100).toFixed(0)}%` : "—" },
        { k: "Lead time", v: site ? `${site.leadDays} d` : "68 d" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
      {stages.map((s, i) => (
        <div key={s.label} className="flex flex-1 items-stretch gap-3">
          <div className="flex-1 rounded-xl border border-border/60 bg-card/60 p-4">
            <div className="flex items-center gap-2">
              <s.icon className={`h-4 w-4 ${s.accent}`} />
              <span className="text-sm font-semibold text-foreground">{s.label}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</p>
            <div className="mt-3 space-y-1.5">
              {s.rows.map((r) => (
                <div key={r.k} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">{r.k}</span>
                  <span className="font-mono font-medium text-foreground">{r.v}</span>
                </div>
              ))}
            </div>
          </div>
          {i < stages.length - 1 && (
            <div className="hidden items-center lg:flex">
              <ArrowRight className="h-4 w-4 text-muted-foreground/50" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
