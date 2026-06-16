"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Newspaper, Globe, RefreshCw } from "lucide-react";

interface NewsItem {
  id: string;
  title: string;
  snippet: string;
  source: "WHO" | "ProMED";
  url: string;
  date: string;
  pathogen: string | null;
  country: string | null;
  cases: number | null;
  deaths: number | null;
  novelty: boolean;
}

function timeAgo(iso: string): string {
  const d = Date.parse(iso);
  if (!d) return "";
  const days = Math.floor((Date.now() - d) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NewsFeed({ iso, place }: { iso: string; place: string }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [scope, setScope] = useState<"country" | "global">("country");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/v1/news?iso=${encodeURIComponent(iso)}&limit=15`)
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        setItems(d.items ?? []);
        setScope(d.meta?.scope ?? "global");
      })
      .catch(() => active && setItems([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [iso]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Globe className="h-3.5 w-3.5 text-emerald-400" />
          {loading
            ? "Loading live reports…"
            : scope === "country"
              ? `Current outbreak reports for ${place}`
              : `No active country-specific reports, showing global outbreak news`}
        </span>
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">live · WHO · ProMED</span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/20" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/40 p-4 text-[12px] text-muted-foreground">
          <RefreshCw className="h-4 w-4" /> The WHO/ProMED text stream is temporarily unavailable. Try again shortly.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 rounded-lg border border-border/50 bg-card/40 p-3 transition-colors hover:border-border"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 text-muted-foreground">
                <Newspaper className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-medium leading-snug text-foreground">{n.title}</p>
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                </div>
                {n.snippet && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{n.snippet}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="rounded bg-secondary px-1.5 py-px font-medium text-muted-foreground">{n.source}</span>
                  {n.pathogen && <span className="rounded bg-sky-400/10 px-1.5 py-px text-sky-300">{n.pathogen}</span>}
                  {n.country && <span className="text-muted-foreground">{n.country}</span>}
                  {n.cases != null && <span className="text-amber-300">{n.cases.toLocaleString()} cases</span>}
                  {n.novelty && <span className="rounded bg-purple-500/15 px-1.5 py-px text-purple-300">novel</span>}
                  <span className="ml-auto text-muted-foreground">{timeAgo(n.date)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
