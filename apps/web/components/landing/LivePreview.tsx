"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getSites } from "@/lib/demo/sites";
import { levelHex } from "@/components/demo/SiteLocatorMap";
import { Sparkline } from "@/components/demo/Sparkline";

const GlobalSiteMap = dynamic(() => import("@/components/demo/GlobalSiteMap").then((m) => m.GlobalSiteMap), {
  ssr: false,
  loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-white/5" />,
});

export function LivePreview() {
  const sites = getSites();
  const [selectedId, setSelectedId] = useState(sites[0].id);
  const site = sites.find((s) => s.id === selectedId) ?? sites[0];
  const cards = site.panels.slice(0, 4);

  return (
    <div className="dark overflow-hidden rounded-2xl border border-slate-700/60 bg-[#0a0f1e] shadow-2xl">
      {/* fake window chrome */}
      <div className="flex items-center gap-2 border-b border-slate-700/60 bg-slate-900/60 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-3 font-mono text-[11px] text-slate-400">mosaic, surveillance console</span>
        <span className="ml-auto flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> LIVE
        </span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-5">
        {/* map */}
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Global sewershed network · P(Rt&gt;1)</span>
            <span className="text-[10px] text-slate-500">{sites.length} sites · {new Set(sites.map((s) => s.country)).size} countries</span>
          </div>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2">
            <GlobalSiteMap sites={sites} selectedId={selectedId} onSelect={setSelectedId} height={260} />
          </div>
        </div>

        {/* selected site summary + cards */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: levelHex(site.level) }} />
              <span className="truncate text-sm font-medium text-slate-100">{site.label}</span>
            </div>
            <div className="mt-2 flex items-end gap-4">
              <div>
                <p className="font-mono text-2xl font-semibold" style={{ color: levelHex(site.level) }}>{(site.pOutbreak * 100).toFixed(0)}%</p>
                <p className="text-[10px] text-slate-400">P(Rt&gt;1)</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-slate-200">{site.rt.toFixed(2)}</p>
                <p className="text-[10px] text-slate-400">Rt</p>
              </div>
              <div>
                <p className="font-mono text-2xl font-semibold text-sky-400">{site.leadDays}d</p>
                <p className="text-[10px] text-slate-400">lead</p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {cards.map((p) => {
              const c = levelHex(p.level);
              return (
                <div key={p.key} className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2.5">
                  <p className="truncate text-[11px] text-slate-300">{p.name}</p>
                  <p className="font-mono text-lg font-semibold" style={{ color: c }}>{p.value.toFixed(0)}</p>
                  <div style={{ color: c }}><Sparkline data={p.series} color={c} height={22} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Link href={`/demo/sites/${site.id}`} className="flex items-center justify-center gap-1.5 border-t border-slate-700/60 bg-slate-900/60 py-2.5 text-xs font-medium text-sky-400 hover:bg-slate-900">
        Open {site.shortLabel} in the live console <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
