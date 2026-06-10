"use client";

import { X, ExternalLink, AlertTriangle, TrendingUp } from "lucide-react";
import type { ActiveAlert } from "@/lib/types";
import { alertLevelColor, alertLevelDotColor, formatProbability } from "@/lib/utils";

interface CountryDetailProps {
  iso: string;
  alerts: ActiveAlert[];
  onClose: () => void;
}

const STREAMS = [
  { key: "text_stream" as const, label: "Text", color: "bg-sky-500" },
  { key: "wastewater_stream" as const, label: "Wastewater", color: "bg-emerald-500" },
  { key: "genomic_stream" as const, label: "Genomic", color: "bg-violet-500" },
];

/** Detail panel for a clicked country: every pathogen active there, with its
 *  fused probability, R_t interval, per-stream attribution, novelty flag and
 *  source links. */
export function CountryDetail({ iso, alerts, onClose }: CountryDetailProps) {
  const here = alerts
    .filter((a) => (a.countries ?? []).some((c) => c.iso_a2 === iso) || a.location_country === iso)
    .sort((a, b) => b.p_outbreak - a.p_outbreak);

  const name =
    here[0]?.countries?.find((c) => c.iso_a2 === iso)?.name ?? here[0]?.location ?? iso;

  return (
    <div className="rounded-xl border border-primary/30 bg-card/80 p-4 sm:p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-primary">Country detail</p>
          <h3 className="text-base font-semibold text-foreground">{name}</h3>
          <p className="text-[11px] text-muted-foreground">
            {here.length} active {here.length === 1 ? "signal" : "signals"} · ISO {iso}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          aria-label="Close country detail"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {here.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No active outbreak signal for this country.
        </p>
      ) : (
        <div className="space-y-3">
          {here.map((a) => {
            const c = a.stream_contributions;
            const total = c.text_stream + c.wastewater_stream + c.genomic_stream || 1;
            return (
              <div key={a.id} className="rounded-lg border border-border/50 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    {a.novelty_flag && <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                    <span className="text-sm font-medium text-foreground">{a.pathogen}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium border ${alertLevelColor(a.alert_level)}`}
                    >
                      <span className={`h-1 w-1 rounded-full ${alertLevelDotColor(a.alert_level)}`} />
                      {a.alert_level}
                    </span>
                  </div>
                  <span
                    className="text-lg font-semibold font-mono"
                    style={{ color: a.p_outbreak >= 0.7 ? "#ef4444" : a.p_outbreak >= 0.4 ? "#f59e0b" : "#22c55e" }}
                  >
                    {formatProbability(a.p_outbreak)}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    R<sub>t</sub> {a.r_t_median.toFixed(2)}{" "}
                    <span className="text-[10px]">[{a.r_t_ci_lower.toFixed(2)}, {a.r_t_ci_upper.toFixed(2)}]</span>
                  </span>
                  {a.countries && a.countries.length > 1 && (
                    <span className="truncate">also: {a.countries.filter((x) => x.iso_a2 !== iso).map((x) => x.name).join(", ")}</span>
                  )}
                </div>

                {/* Stream attribution */}
                <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px mb-1">
                  {STREAMS.map((s) => (
                    <div key={s.key} className={s.color} style={{ width: `${(c[s.key] / total) * 100}%` }} />
                  ))}
                </div>
                <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                  {STREAMS.map((s) => (
                    <span key={s.key}>{s.label} {((c[s.key] / total) * 100).toFixed(0)}%</span>
                  ))}
                </div>

                {/* Sources */}
                <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px]">
                  {a.source_links.promed_post && (
                    <a href={a.source_links.promed_post} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sky-400 hover:underline">
                      <ExternalLink className="h-3 w-3" /> WHO / ProMED report
                    </a>
                  )}
                  {a.source_links.nextstrain && (
                    <a href={a.source_links.nextstrain} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-violet-400 hover:underline">
                      <ExternalLink className="h-3 w-3" /> Nextstrain
                    </a>
                  )}
                  {a.source_links.nwss_site && c.wastewater_stream > 0 && (
                    <a href={a.source_links.nwss_site} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
                      <ExternalLink className="h-3 w-3" /> CDC NWSS
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
