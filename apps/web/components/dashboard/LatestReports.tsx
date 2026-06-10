"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Newspaper, AlertTriangle } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface EventItem {
 id: string;
 title: string;
 link: string;
 pubDate: string;
 source: "ProMED" | "WHO";
 extracted: {
  pathogen: string | null;
  location: string | null;
  caseCount: number | null;
  deathCount: number | null;
  noveltyFlag: boolean;
 };
}

/**
 * "Latest surveillance reports", the most recent WHO DON / ProMED items the
 * text stream ingested, with the extracted pathogen and location. Gives the map
 * tab a live, source-linked feed instead of a row of duplicate probability cards.
 */
export function LatestReports() {
 const [events, setEvents] = useState<EventItem[]>([]);
 const [loading, setLoading] = useState(true);

 useEffect(() => {
  fetch("/api/v1/promed")
   .then((r) => r.json())
   .then((d) => {
    const evs = (d.events ?? []) as EventItem[];
    setEvents(evs.filter((e) => e.extracted.pathogen).slice(0, 8));
    setLoading(false);
   })
   .catch(() => setLoading(false));
 }, []);

 return (
  <div className="rounded-xl border border-border/50 bg-card/60 p-4">
   <div className="flex items-center gap-2 mb-3">
    <Newspaper className="h-4 w-4 text-primary" />
    <h3 className="text-sm font-medium text-foreground">Latest surveillance reports</h3>
    <span className="text-[10px] text-muted-foreground">WHO DON · ProMED</span>
   </div>

   {loading ? (
    <div className="py-6 text-center text-xs text-muted-foreground animate-pulse">
     Loading latest reports…
    </div>
   ) : events.length === 0 ? (
    <div className="py-6 text-center text-xs text-muted-foreground">No recent reports.</div>
   ) : (
    <ul className="divide-y divide-border/30">
     {events.map((e) => (
      <li key={e.id} className="py-2.5 first:pt-0 last:pb-0">
       <a
        href={e.link}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-start gap-3"
       >
        <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium border border-border/60 text-muted-foreground">
         {e.source}
        </span>
        <div className="min-w-0 flex-1">
         <p className="text-xs text-foreground group-hover:text-primary transition-colors line-clamp-2">
          {e.extracted.noveltyFlag && (
           <AlertTriangle className="inline h-3 w-3 text-amber-400 mr-1 align-[-1px]" />
          )}
          {e.title}
         </p>
         <p className="text-[10px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
          <span className="text-foreground/80">{e.extracted.pathogen}</span>
          {e.extracted.location && <span>· {e.extracted.location}</span>}
          {e.extracted.caseCount != null && <span>· {e.extracted.caseCount.toLocaleString()} cases</span>}
          <span>· {formatDate(e.pubDate)}</span>
         </p>
        </div>
        <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
       </a>
      </li>
     ))}
    </ul>
   )}
  </div>
 );
}
