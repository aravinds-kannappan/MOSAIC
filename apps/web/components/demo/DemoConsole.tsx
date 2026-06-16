"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  LayoutDashboard, Bell, LineChart, Dna, FileText, Database, Activity, GitMerge,
  ChevronDown, ChevronsLeft, ChevronsRight, Github, ArrowLeft, Radio, MapPin, Sparkles,
} from "lucide-react";
import { getSites, datasetMeta, type SiteState } from "@/lib/demo/sites";
import { levelHex } from "./SiteLocatorMap";
import { PathogenGrid } from "./PathogenGrid";
import { PipelineSchematic } from "./PipelineSchematic";
import { NewsFeed } from "./NewsFeed";
import {
  SiteHeader, EarlyWarningBanner, EventLog, LineagePanel, StreamHealthPanel, BriefingCard, ForecastPanel,
} from "./panels";
import { Assistant } from "./Assistant";

const GlobalSiteMap = dynamic(() => import("./GlobalSiteMap").then((m) => m.GlobalSiteMap), {
  ssr: false,
  loading: () => <div className="h-[280px] animate-pulse rounded-lg bg-muted/20" />,
});

type Section = "overview" | "alerts" | "forecasting" | "lineages" | "fusion" | "briefings" | "streams" | "dataroom";

const REGION_ORDER = ["United States", "Americas", "Europe", "Asia-Pacific", "Middle East", "Africa"];

const NAV: { group: string; items: { id: Section; label: string; icon: React.ElementType; badge?: boolean }[] }[] = [
  { group: "Monitor", items: [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "alerts", label: "Alerts", icon: Bell, badge: true },
    { id: "forecasting", label: "Forecasting", icon: LineChart },
  ]},
  { group: "Genomics", items: [
    { id: "lineages", label: "Lineages", icon: Dna },
    { id: "fusion", label: "Fusion model", icon: GitMerge },
  ]},
  { group: "Report", items: [
    { id: "briefings", label: "Briefings", icon: FileText },
    { id: "dataroom", label: "Data room", icon: Database },
  ]},
  { group: "Data quality", items: [
    { id: "streams", label: "Stream health", icon: Activity },
  ]},
];

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function DemoConsole({ initialSiteId }: { initialSiteId?: string }) {
  const sites = useMemo(() => getSites(), []);
  const [selectedId, setSelectedId] = useState(initialSiteId ?? sites[0].id);
  const [section, setSection] = useState<Section>("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [refreshAt, setRefreshAt] = useState<string>("");

  const site = sites.find((s) => s.id === selectedId) ?? sites[0];
  const alertCount = site.events.filter((e) => e.level === "HIGH" || e.level === "CRITICAL").length
    + site.panels.filter((p) => p.level === "HIGH" || p.level === "CRITICAL").length;

  useEffect(() => {
    const tick = () => setRefreshAt(new Date().toLocaleTimeString("en-US", { hour12: false }));
    tick();
    const iv = setInterval(tick, 30_000);
    return () => clearInterval(iv);
  }, []);

  // ⌘K / Ctrl-K opens the assistant
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAssistantOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickSite = useCallback((id: string) => { setSelectedId(id); setSection("overview"); }, []);

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ---------- Top bar ---------- */}
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/40 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 pr-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[11px] font-bold text-primary-foreground">M</div>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">MOSAIC</span>
          </Link>
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs hover:border-border"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: levelHex(site.level) }} />
              <span className="max-w-[200px] truncate font-medium">{site.label}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-border/60 bg-popover p-1 shadow-2xl">
                  <p className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {sites.length} sites · {new Set(sites.map((s) => s.country)).size} countries · by P(Rt&gt;1)
                  </p>
                  {REGION_ORDER.filter((r) => sites.some((s) => s.region === r)).map((region) => (
                    <div key={region}>
                      <p className="px-2 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60">{region}</p>
                      {sites.filter((s) => s.region === region).map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { pickSite(s.id); setPickerOpen(false); }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${s.id === selectedId ? "bg-muted" : ""}`}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: levelHex(s.level) }} />
                            <span className="truncate">{s.label}</span>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{(s.pOutbreak * 100).toFixed(0)}%</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[11px] md:flex">
            <Radio className="h-3 w-3 text-emerald-400" />
            <span className="font-mono">{site.leadDays}d</span>
            <span className="text-muted-foreground">lead</span>
          </span>
          <span className="flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[11px]">
            <Bell className="h-3 w-3" style={{ color: alertCount ? "#f87171" : undefined }} />
            <span className="font-mono">{alertCount}</span>
            <span className="hidden text-muted-foreground sm:inline">alerts</span>
          </span>
          <span
            title="Live: CDC NWSS wastewater (US sites) + WHO/ProMED outbreak news. Modeled for the demo: international sites, non-COVID pathogen panels, and lineage mixes (flagged 'sim')."
            className="hidden items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-300 lg:flex"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> DEMO
          </span>
          <a href="https://github.com/aravinds-kannappan/MOSAIC" target="_blank" rel="noopener noreferrer" className="rounded-md border border-border/60 bg-background p-1.5 text-muted-foreground hover:text-foreground">
            <Github className="h-3.5 w-3.5" />
          </a>
          <Link href="/" className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> <span className="hidden sm:inline">Exit</span>
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---------- Sidebar ---------- */}
        <aside className={`hidden shrink-0 flex-col justify-between border-r border-border/60 bg-card/30 transition-all sm:flex ${collapsed ? "w-14" : "w-56"}`}>
          <nav className="flex-1 overflow-y-auto px-2 py-3">
            <button onClick={() => setAssistantOpen(true)} className={`mb-3 flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs text-primary hover:bg-primary/15 ${collapsed ? "justify-center" : ""}`}>
              <Sparkles className="h-3.5 w-3.5" />
              {!collapsed && <><span>Assistant</span><span className="ml-auto font-mono text-[10px]">⌘K</span></>}
            </button>
            {NAV.map((g) => (
              <div key={g.group} className="mb-3">
                {!collapsed && <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g.group}</p>}
                {g.items.map((it) => {
                  const active = section === it.id;
                  return (
                    <button
                      key={it.id}
                      onClick={() => setSection(it.id)}
                      title={it.label}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors ${collapsed ? "justify-center" : ""} ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                    >
                      <it.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="flex-1 text-left">{it.label}</span>}
                      {!collapsed && it.badge && alertCount > 0 && (
                        <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] font-medium text-red-300">{alertCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <button onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground hover:text-foreground">
            {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <><ChevronsLeft className="h-3.5 w-3.5" /> Collapse</>}
          </button>
        </aside>

        {/* ---------- Main ---------- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1500px] animate-fade-in p-4 sm:p-6">
            {section === "overview" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <EarlyWarningBanner site={site} />
                <PathogenGrid panels={site.panels} />
                <Card title="MOSAIC inference pipeline"><PipelineSchematic site={site} /></Card>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="Circulating lineages" action={<span className="text-[10px] text-muted-foreground">Nextstrain</span>}>
                    <LineagePanel lineages={site.lineages} />
                  </Card>
                  <BriefingCard site={site} />
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="Recent activity" action={<button onClick={() => setSection("alerts")} className="text-[10px] text-primary hover:underline">View all</button>}>
                    <EventLog events={site.events.slice(0, 4)} compact />
                  </Card>
                  <Card title="Global sewershed network" action={<span className="flex items-center gap-1 text-[10px] text-muted-foreground"><MapPin className="h-3 w-3" /> {sites.length} sites · {new Set(sites.map((s) => s.country)).size} countries</span>}>
                    <GlobalSiteMap sites={sites} selectedId={selectedId} onSelect={setSelectedId} height={240} />
                  </Card>
                </div>
              </div>
            )}

            {section === "alerts" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title={`Outbreak news — ${site.country}`}>
                  <NewsFeed iso={site.iso} place={site.country} />
                </Card>
                <Card title={`Detector & event log — ${site.events.length} entries`}><EventLog events={site.events} /></Card>
              </div>
            )}

            {section === "forecasting" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title="Fused outbreak posterior — P(Rt > 1)"><ForecastPanel site={site} /></Card>
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  {[
                    { v: `${(site.pOutbreak * 100).toFixed(0)}%`, l: "P(Rt>1) now" },
                    { v: site.rt.toFixed(2), l: "Rt median" },
                    { v: `${site.rtLow.toFixed(2)}–${site.rtHigh.toFixed(2)}`, l: "Rt 90% CI" },
                    { v: `${site.leadDays} d`, l: "lead time" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-xl border border-border/60 bg-card/50 p-4 text-center">
                      <p className="font-mono text-xl font-semibold text-foreground">{s.v}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{s.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {section === "lineages" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title="Genomic lineage surveillance" action={<span className="text-[10px] text-muted-foreground">KL-divergence anomaly detection</span>}>
                  <LineagePanel lineages={site.lineages} />
                  <p className="mt-4 border-t border-border/50 pt-3 text-[12px] leading-relaxed text-muted-foreground">
                    Lineage frequencies are tracked over rolling windows; a Jensen–Shannon / KL-divergence
                    jump between consecutive windows raises a genomic anomaly score, feeding the fusion model
                    alongside the wastewater and text streams. A rising minor lineage often precedes a wave.
                  </p>
                </Card>
              </div>
            )}

            {section === "fusion" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title="Multi-modal Bayesian fusion"><PipelineSchematic site={site} /></Card>
                <Card title="How the posterior is built">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Each stream produces a soft alarm probability — BOCPD change-points on the wastewater
                    activity series, KL-divergence anomalies on lineage frequencies, and NLP-extracted
                    outbreak signals from WHO DON and ProMED. A learned logistic / hierarchical Bayesian
                    model fuses them with cross-validated weights, and the output is isotonically calibrated
                    so a stated 70% really means 70% (ECE 0.086, AUROC 0.917 across four historical outbreaks).
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                    {[{ v: "0.086", l: "ECE" }, { v: "0.917", l: "AUROC" }, { v: `${site.leadDays} d`, l: "lead time" }].map((s) => (
                      <div key={s.l} className="rounded-lg border border-border/50 bg-background p-3">
                        <p className="font-mono text-lg font-semibold text-foreground">{s.v}</p>
                        <p className="text-[10px] text-muted-foreground">{s.l}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {section === "briefings" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <BriefingCard site={site} />
                <Card title="Pathogen target detail"><PathogenGrid panels={site.panels} /></Card>
              </div>
            )}

            {section === "streams" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title="Surveillance stream health"><StreamHealthPanel streams={site.streams} /></Card>
                <Card title="Source & provenance">
                  <dl className="grid grid-cols-1 gap-y-2 text-[12px] sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">Wastewater dataset</dt><dd className="font-mono text-foreground">CDC NWSS 2ew6-ywp6</dd></div>
                    <div><dt className="text-muted-foreground">Site record</dt><dd className="font-mono text-foreground">WWTP-{site.wwtpId} · {site.sampleLocation}</dd></div>
                    <div><dt className="text-muted-foreground">First sample</dt><dd className="font-mono text-foreground">{site.firstSampleDate}</dd></div>
                    <div><dt className="text-muted-foreground">Latest window</dt><dd className="font-mono text-foreground">{site.dateEnd}</dd></div>
                    <div><dt className="text-muted-foreground">Population served</dt><dd className="font-mono text-foreground">{site.populationServed.toLocaleString()}</dd></div>
                    <div><dt className="text-muted-foreground">Detection (15d)</dt><dd className="font-mono text-foreground">{site.detectProp}%</dd></div>
                  </dl>
                </Card>
              </div>
            )}

            {section === "dataroom" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <Card title="Data room">
                  <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
                    MOSAIC is open source (MIT). The wastewater backbone of this console — site list,
                    population served, SARS-CoV-2 activity and 15-day change — is real CDC NWSS data
                    ({datasetMeta.source}). Additional pathogen panels and lineage mixes are modelled for
                    the demo and flagged <span className="font-mono">sim</span>.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      { n: "CDC NWSS", d: "National Wastewater Surveillance System", u: "https://www.cdc.gov/nwss" },
                      { n: "Nextstrain", d: "Open genomic lineage data", u: "https://nextstrain.org" },
                      { n: "WHO DON", d: "Disease Outbreak News", u: "https://www.who.int/emergencies/disease-outbreak-news" },
                      { n: "ProMED", d: "Program for Monitoring Emerging Diseases", u: "https://promedmail.org" },
                    ].map((s) => (
                      <a key={s.n} href={s.u} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border/50 bg-background p-3 hover:border-border">
                        <p className="text-sm font-medium text-foreground">{s.n}</p>
                        <p className="text-[11px] text-muted-foreground">{s.d}</p>
                      </a>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-3">
                    <Link href="/research" className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground hover:border-border">Research & findings →</Link>
                    <a href="/mosaic.pdf" target="_blank" rel="noopener noreferrer" className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground hover:border-border">Read the paper (PDF)</a>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ---------- Bottom status bar ---------- */}
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border/60 bg-card/40 px-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Live: CDC NWSS · WHO · ProMED</span>
          <span className="hidden sm:inline">Last refresh {refreshAt || "—"}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setAssistantOpen(true)} className="hidden font-mono hover:text-foreground md:inline">⌘K assistant</button>
          <span className="hidden font-mono md:inline">{sites.length} sites · {new Set(sites.map((s) => s.country)).size} countries</span>
          <button onClick={() => setAssistantOpen(true)} className="flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-primary hover:bg-primary/25">
            <Sparkles className="h-3 w-3" /> Ask MOSAIC
          </button>
        </div>
      </footer>

      <Assistant
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        sites={sites}
        site={site}
        section={section}
        onNavigate={(sec, siteId) => { if (siteId) setSelectedId(siteId); setSection(sec); }}
        onSelectSite={(siteId) => setSelectedId(siteId)}
      />
    </div>
  );
}
