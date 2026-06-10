"use client";

import { useState, useEffect } from "react";
import { ExternalLink, AlertTriangle, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { formatProbability, alertLevelColor, alertLevelDotColor, formatDate } from "@/lib/utils";
import type { ActiveAlert, AlertLevel } from "@/lib/types";

interface AlertsResponse {
  alerts: ActiveAlert[];
  meta?: {
    streamStatus?: Record<string, string>;
    fusionMethod?: string;
    fetchedAt?: string;
  };
}

type StreamKey = "text_stream" | "wastewater_stream" | "genomic_stream";

const STREAM_META: Record<StreamKey, { label: string; short: string; bar: string; dot: string; text: string }> = {
  text_stream: { label: "Text (WHO/ProMED)", short: "Text", bar: "bg-sky-500", dot: "bg-sky-400", text: "text-sky-400" },
  wastewater_stream: { label: "Wastewater (NWSS)", short: "Wastewater", bar: "bg-emerald-500", dot: "bg-emerald-400", text: "text-emerald-400" },
  genomic_stream: { label: "Genomic (Nextstrain)", short: "Genomic", bar: "bg-violet-500", dot: "bg-violet-400", text: "text-violet-400" },
};
const STREAM_KEYS = Object.keys(STREAM_META) as StreamKey[];

function dominantStream(a: ActiveAlert): StreamKey {
  return STREAM_KEYS.reduce((best, k) =>
    a.stream_contributions[k] > a.stream_contributions[best] ? k : best
  , "text_stream");
}

function StreamBar({ contributions }: { contributions: ActiveAlert["stream_contributions"] }) {
  const total = STREAM_KEYS.reduce((s, k) => s + contributions[k], 0) || 1;
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden gap-px ring-1 ring-border/40">
      {STREAM_KEYS.map((k) => (
        <div
          key={k}
          className={`${STREAM_META[k].bar} transition-all`}
          style={{ width: `${(contributions[k] / total) * 100}%` }}
          title={`${STREAM_META[k].short}: ${((contributions[k] / total) * 100).toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

const LEVELS: Array<"ALL" | AlertLevel> = ["ALL", "CRITICAL", "HIGH", "MODERATE", "LOW"];

export function AlertFeed() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"p_outbreak" | "pathogen">("p_outbreak");
  const [levelFilter, setLevelFilter] = useState<"ALL" | AlertLevel>("ALL");

  const fetchAlerts = () => {
    setLoading(true);
    setError(null);
    fetch("/api/v1/alerts")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  };

  useEffect(() => { fetchAlerts(); }, []);

  const all = data?.alerts ?? [];
  const counts = all.reduce((m, a) => { m[a.alert_level] = (m[a.alert_level] ?? 0) + 1; return m; }, {} as Record<string, number>);

  const sorted = [...all]
    .filter((a) => levelFilter === "ALL" || a.alert_level === levelFilter)
    .sort((a, b) =>
      sortBy === "p_outbreak" ? b.p_outbreak - a.p_outbreak : a.pathogen.localeCompare(b.pathogen)
    );

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="h-7 rounded border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
            >
              <option value="p_outbreak">P(Rt &gt; 1)</option>
              <option value="pathogen">Pathogen</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Level</label>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as "ALL" | AlertLevel)}
              className="h-7 rounded border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l === "ALL" ? "All levels" : l}{l !== "ALL" && counts[l] ? ` (${counts[l]})` : ""}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {data?.meta?.fetchedAt && (
            <span className="text-[10px] text-muted-foreground">Updated {formatDate(data.meta.fetchedAt)}</span>
          )}
          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stream legend + status */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Streams:</span>
        {STREAM_KEYS.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[11px]">
            <span className={`h-2.5 w-2.5 rounded-sm ${STREAM_META[k].bar}`} />
            <span className={STREAM_META[k].text}>{STREAM_META[k].label}</span>
          </span>
        ))}
        {data?.meta?.streamStatus && (
          <span className="ml-auto flex items-center gap-3 text-[10px] text-muted-foreground">
            {Object.entries(data.meta.streamStatus).map(([s, st]) => (
              <span key={s} className="flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${st === "ok" ? "bg-emerald-400" : "bg-red-400"}`} />
                {s}
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Summary chips */}
      {!loading && all.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as AlertLevel[]).filter((l) => counts[l]).map((l) => (
            <span key={l} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${alertLevelColor(l)}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${alertLevelDotColor(l)}`} />
              {counts[l]} {l.toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Fetching surveillance streams…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400">{error}</div>
      )}
      {!loading && !error && sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-xs text-muted-foreground gap-2">
          <AlertTriangle className="h-8 w-8 opacity-30" />
          <p>No active alerts {levelFilter !== "ALL" ? `at ${levelFilter} level` : "above threshold (P > 0.05)"}</p>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] text-muted-foreground uppercase tracking-wider">
                <th className="py-2 text-left pr-4">Pathogen</th>
                <th className="py-2 text-left pr-4">Countries</th>
                <th className="py-2 text-right pr-4">P(Rt&gt;1)</th>
                <th className="py-2 text-left pr-4 hidden sm:table-cell">Rt [95% CI]</th>
                <th className="py-2 text-left pr-4 hidden md:table-cell w-40">Stream contributions</th>
                <th className="py-2 text-left pr-4 hidden lg:table-cell">Driven by</th>
                <th className="py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((alert) => {
                const dom = dominantStream(alert);
                const c = alert.stream_contributions;
                const total = STREAM_KEYS.reduce((s, k) => s + c[k], 0) || 1;
                return (
                  <tr key={alert.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1.5">
                        {alert.novelty_flag && (
                          <span title="Novel etiology flag">
                            <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" aria-hidden="true" />
                          </span>
                        )}
                        <span className="font-medium text-foreground">{alert.pathogen}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground max-w-[180px] truncate" title={alert.location}>
                      {alert.location}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="font-mono font-semibold text-foreground">{formatProbability(alert.p_outbreak)}</span>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <TrendingUp className="h-3 w-3" />
                        <span className="font-mono">
                          {alert.r_t_median.toFixed(2)}{" "}
                          <span className="text-[10px]">[{alert.r_t_ci_lower.toFixed(2)}, {alert.r_t_ci_upper.toFixed(2)}]</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell w-40">
                      <StreamBar contributions={c} />
                      <div className="flex justify-between mt-1 text-[9px] font-medium">
                        {STREAM_KEYS.map((k) => (
                          <span key={k} className={STREAM_META[k].text}>
                            {((c[k] / total) * 100).toFixed(0)}% {STREAM_META[k].short[0]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 pr-4 hidden lg:table-cell">
                      <span className={`inline-flex items-center gap-1 text-[10px] ${STREAM_META[dom].text}`}>
                        <span className={`h-2 w-2 rounded-sm ${STREAM_META[dom].bar}`} />
                        {STREAM_META[dom].short}
                      </span>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${alertLevelColor(alert.alert_level)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${alertLevelDotColor(alert.alert_level)}`} />
                          {alert.alert_level}
                        </span>
                        {alert.source_links.promed_post && (
                          <a
                            href={alert.source_links.promed_post}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors"
                            title="Source report"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data?.meta?.fusionMethod && (
            <p className="mt-3 text-[10px] text-muted-foreground">
              Fusion: {data.meta.fusionMethod === "learned-logistic"
                ? "learned logistic regression (trained on realised growth)"
                : data.meta.fusionMethod === "lightweight-js"
                  ? "weighted noisy-or over available streams"
                  : data.meta.fusionMethod}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
