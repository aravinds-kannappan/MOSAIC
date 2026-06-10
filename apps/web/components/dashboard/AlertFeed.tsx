"use client";

import { useState, useEffect } from "react";
import { ExternalLink, AlertTriangle, TrendingUp, Loader2, RefreshCw } from "lucide-react";
import { formatProbability, alertLevelColor, alertLevelDotColor, formatDate } from "@/lib/utils";
import type { ActiveAlert } from "@/lib/types";

interface AlertsResponse {
 alerts: ActiveAlert[];
 meta?: {
  streamStatus?: Record<string, string>;
  fusionMethod?: string;
  fetchedAt?: string;
 };
}

const STREAM_COLORS = {
 text_stream: { label: "Text", color: "bg-sky-500" },
 wastewater_stream: { label: "WW", color: "bg-emerald-500" },
 genomic_stream: { label: "Gen", color: "bg-violet-500" },
};

function StreamBar({ contributions }: { contributions: ActiveAlert["stream_contributions"] }) {
 const total =
  (contributions.text_stream + contributions.wastewater_stream + contributions.genomic_stream) || 1;
 const pcts = {
  text_stream: (contributions.text_stream / total) * 100,
  wastewater_stream: (contributions.wastewater_stream / total) * 100,
  genomic_stream: (contributions.genomic_stream / total) * 100,
 };
 return (
  <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px" title="Stream contributions">
   {Object.entries(pcts).map(([key, pct]) => (
    <div
     key={key}
     className={`${STREAM_COLORS[key as keyof typeof STREAM_COLORS].color} transition-all`}
     style={{ width: `${pct}%` }}
     title={`${STREAM_COLORS[key as keyof typeof STREAM_COLORS].label}: ${pct.toFixed(0)}%`}
    />
   ))}
  </div>
 );
}

export function AlertFeed() {
 const [data, setData] = useState<AlertsResponse | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [sortBy, setSortBy] = useState<"p_outbreak" | "pathogen">("p_outbreak");

 const fetchAlerts = () => {
  setLoading(true);
  setError(null);
  fetch("/api/v1/alerts")
   .then((r) => r.json())
   .then((d) => { setData(d); setLoading(false); })
   .catch((e) => { setError(String(e)); setLoading(false); });
 };

 useEffect(() => { fetchAlerts(); }, []);

 const sorted = [...(data?.alerts ?? [])].sort((a, b) =>
  sortBy === "p_outbreak" ? b.p_outbreak - a.p_outbreak : a.pathogen.localeCompare(b.pathogen)
 );

 return (
  <div className="flex flex-col gap-3">
   {/* Controls */}
   <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
     <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sort by</label>
     <select
      value={sortBy}
      onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
      className="h-7 rounded border border-border bg-muted px-2 text-xs text-foreground focus:outline-none"
     >
      <option value="p_outbreak">P(Rt &gt; 1)</option>
      <option value="pathogen">Pathogen</option>
     </select>
    </div>

    <div className="flex items-center gap-3">
     {data?.meta?.fetchedAt && (
      <span className="text-[10px] text-muted-foreground">
       Updated {formatDate(data.meta.fetchedAt)}
      </span>
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

   {/* Stream status */}
   {data?.meta?.streamStatus && (
    <div className="flex gap-3 text-[10px] text-muted-foreground">
     {Object.entries(data.meta.streamStatus).map(([stream, status]) => (
      <span key={stream} className="flex items-center gap-1">
       <span className={`h-1.5 w-1.5 rounded-full ${status === "ok" ? "bg-emerald-400" : "bg-red-400"}`} />
       {stream}
      </span>
     ))}
    </div>
   )}

   {/* Table */}
   {loading && (
    <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
     <Loader2 className="h-4 w-4 animate-spin" />
     Fetching surveillance streams…
    </div>
   )}

   {error && (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-400">
     {error}
    </div>
   )}

   {!loading && !error && sorted.length === 0 && (
    <div className="flex flex-col items-center justify-center py-12 text-xs text-muted-foreground gap-2">
     <AlertTriangle className="h-8 w-8 opacity-30" />
     <p>No active alerts above threshold (P &gt; 0.05)</p>
     <p className="text-[10px]">All streams operating normally</p>
    </div>
   )}

   {!loading && !error && sorted.length > 0 && (
    <div className="overflow-x-auto">
     <table className="w-full text-xs">
      <thead>
       <tr className="border-b border-border text-[10px] text-muted-foreground uppercase tracking-wider">
        <th className="py-2 text-left pr-4">Pathogen</th>
        <th className="py-2 text-left pr-4">Location</th>
        <th className="py-2 text-right pr-4">P(Rt&gt;1)</th>
        <th className="py-2 text-left pr-4 hidden sm:table-cell">Rt [95% CI]</th>
        <th className="py-2 text-left pr-4 hidden md:table-cell">Stream contributions</th>
        <th className="py-2 text-left">Status</th>
       </tr>
      </thead>
      <tbody>
       {sorted.map((alert) => (
        <tr
         key={alert.id}
         className="border-b border-border/30 hover:bg-muted/20 transition-colors"
        >
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

         <td className="py-3 pr-4 text-muted-foreground">{alert.location}</td>

         <td className="py-3 pr-4 text-right">
          <span className="font-mono font-semibold text-foreground">
           {formatProbability(alert.p_outbreak)}
          </span>
         </td>

         <td className="py-3 pr-4 hidden sm:table-cell">
          <div className="flex items-center gap-1 text-muted-foreground">
           <TrendingUp className="h-3 w-3" />
           <span className="font-mono">
            {alert.r_t_median.toFixed(2)}{" "}
            <span className="text-[10px]">
             [{alert.r_t_ci_lower.toFixed(2)}, {alert.r_t_ci_upper.toFixed(2)}]
            </span>
           </span>
          </div>
         </td>

         <td className="py-3 pr-4 hidden md:table-cell w-32">
          <StreamBar contributions={alert.stream_contributions} />
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
           <span title="Text">{(alert.stream_contributions.text_stream * 100).toFixed(0)}% T</span>
           <span title="Wastewater">{(alert.stream_contributions.wastewater_stream * 100).toFixed(0)}% W</span>
           <span title="Genomic">{(alert.stream_contributions.genomic_stream * 100).toFixed(0)}% G</span>
          </div>
         </td>

         <td className="py-3">
          <div className="flex items-center gap-2">
           <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${alertLevelColor(alert.alert_level)}`}
           >
            <span className={`h-1.5 w-1.5 rounded-full ${alertLevelDotColor(alert.alert_level)}`} />
            {alert.alert_level}
           </span>

           {alert.source_links.promed_post && (
            <a
             href={alert.source_links.promed_post}
             target="_blank"
             rel="noopener noreferrer"
             className="text-muted-foreground hover:text-primary transition-colors"
             title="ProMED source"
            >
             <ExternalLink className="h-3 w-3" />
            </a>
           )}
          </div>
         </td>
        </tr>
       ))}
      </tbody>
     </table>
    </div>
   )}
  </div>
 );
}
