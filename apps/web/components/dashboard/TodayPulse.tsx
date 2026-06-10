"use client";

import { AlertTriangle, Radio } from "lucide-react";
import type { ActiveAlert } from "@/lib/types";
import { alertLevelColor, alertLevelDotColor, probabilityToColor, formatDate } from "@/lib/utils";

const STREAM_LABEL: Record<string, string> = {
 text_stream: "text",
 wastewater_stream: "wastewater",
 genomic_stream: "genomic",
};

/** Dominant stream for an alert, for the "via …" caption. */
function dominantStream(a: ActiveAlert): string {
 const c = a.stream_contributions;
 const entries: Array<[string, number]> = [
  ["text_stream", c.text_stream],
  ["wastewater_stream", c.wastewater_stream],
  ["genomic_stream", c.genomic_stream],
 ];
 entries.sort((x, y) => y[1] - x[1]);
 return STREAM_LABEL[entries[0][0]] ?? "multi-stream";
}

interface TodayPulseProps {
 alerts: ActiveAlert[];
 lastUpdated?: string;
 onSelect?: (alert: ActiveAlert) => void;
}

/**
 * "Today's Outbreak Pulse", the landing summary. Surfaces the highest-signal
 * active pathogens (already ranked by fused P(R_t > 1)) as live cards so a user
 * immediately sees what is happening right now, e.g. Ebola in DR Congo.
 */
export function TodayPulse({ alerts, lastUpdated, onSelect }: TodayPulseProps) {
 const top = alerts.slice(0, 5);

 return (
  <div className="mb-6 rounded-xl border border-border/50 bg-card/60 p-4 sm:p-5">
   <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
     <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
     </span>
     <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
      <Radio className="h-4 w-4 text-emerald-400" />
      Today&apos;s Outbreak Pulse
     </h3>
     <span className="text-xs text-muted-foreground">
      · {alerts.length} active {alerts.length === 1 ? "signal" : "signals"}
     </span>
    </div>
    {lastUpdated && (
     <span className="text-[10px] text-muted-foreground hidden sm:block">
      Updated {formatDate(lastUpdated)}
     </span>
    )}
   </div>

   {top.length === 0 ? (
    <div className="flex items-center gap-2 py-6 justify-center text-xs text-muted-foreground">
     <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-transparent animate-spin" />
     Fetching live surveillance streams…
    </div>
   ) : (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
     {top.map((a, i) => (
      <button
       key={a.id}
       onClick={() => onSelect?.(a)}
       className="group relative rounded-lg border border-border/50 bg-background/40 p-3 text-left hover:border-primary/40 transition-colors"
      >
       {i === 0 && (
        <span className="absolute right-2 top-2 text-[9px] uppercase tracking-wider text-emerald-400/80">
         top
        </span>
       )}
       <div className="flex items-center gap-1.5">
        {a.novelty_flag && (
         <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" aria-hidden="true" />
        )}
        <span className="text-xs font-medium text-foreground truncate">{a.pathogen}</span>
       </div>
       <p className="text-[10px] text-muted-foreground truncate mt-0.5">{a.location}</p>
       <p
        className="text-2xl font-semibold font-mono mt-1.5"
        style={{ color: probabilityToColor(a.p_outbreak) }}
       >
        {(a.p_outbreak * 100).toFixed(0)}
        <span className="text-sm">%</span>
       </p>
       <p className="text-[9px] text-muted-foreground -mt-0.5">P(R₍t₎ &gt; 1)</p>
       <div className="mt-2 flex items-center justify-between">
        <span
         className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium border ${alertLevelColor(
          a.alert_level
         )}`}
        >
         <span className={`h-1 w-1 rounded-full ${alertLevelDotColor(a.alert_level)}`} />
         {a.alert_level}
        </span>
        <span className="text-[9px] text-muted-foreground">via {dominantStream(a)}</span>
       </div>
      </button>
     ))}
    </div>
   )}
  </div>
 );
}
