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
import { Sparkline } from "./Sparkline";
import { PathogenGrid } from "./PathogenGrid";
import { PipelineSchematic } from "./PipelineSchematic";
import { NewsFeed } from "./NewsFeed";
import {
  SiteHeader, EarlyWarningBanner, EventLog, LineagePanel, StreamHealthPanel, BriefingCard, ForecastPanel,
  StreamContribution, LineageTrendChart, GenomicAnomalyChart, RecommendedActions, AssessmentCard, TabContext,
} from "./panels";
import { Assistant } from "./Assistant";
import { CalibrationPanel } from "@/components/dashboard/CalibrationPanel";

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
                <AssessmentCard site={site} />
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
                <Card title={`Outbreak news for ${site.cityName}`}>
                  <NewsFeed city={site.cityName} iso={site.iso} place={site.country} />
                </Card>
                <Card title={`Detector & event log, ${site.events.length} entries`}><EventLog events={site.events} /></Card>
              </div>
            )}

            {section === "forecasting" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <TabContext text={site.interpretation.tab.forecasting} />
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                  {[
                    { v: `${(site.pOutbreak * 100).toFixed(0)}%`, l: "P(Rt>1) now" },
                    { v: site.rt.toFixed(2), l: "Rt median" },
                    { v: `${site.rtLow.toFixed(2)} to ${site.rtHigh.toFixed(2)}`, l: "Rt 90% CI" },
                    { v: `${site.leadDays} d`, l: "lead time" },
                  ].map((s) => (
                    <div key={s.l} className="rounded-xl border border-border/60 bg-card/50 p-4 text-center">
                      <p className="font-mono text-xl font-semibold text-foreground">{s.v}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{s.l}</p>
                    </div>
                  ))}
                </div>
                <Card title="Fused outbreak posterior, P(Rt > 1)"><ForecastPanel site={site} /></Card>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="What is driving the signal"><StreamContribution site={site} /></Card>
                  <Card title="Per-target trajectory">
                    <div className="space-y-3">
                      {site.panels.slice(0, 5).map((p) => {
                        const c = levelHex(p.level);
                        return (
                          <div key={p.key} className="flex items-center gap-3">
                            <span className="w-24 shrink-0 truncate text-[12px] text-foreground">{p.name}</span>
                            <div className="flex-1" style={{ color: c }}>
                              <Sparkline data={p.series} color={c} height={28} threshold={p.threshold} />
                            </div>
                            <span className="w-16 shrink-0 text-right font-mono text-[11px]" style={{ color: c }}>
                              {p.value.toFixed(0)}
                              <span className="ml-1 text-[9px] text-muted-foreground">{p.deltaPct >= 0 ? "+" : ""}{p.deltaPct.toFixed(0)}%</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>
                <Card title="Why wastewater leads">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    People shed virus before they feel sick and long before they seek care, so the wastewater
                    signal turns up earlier than test positivity or hospital admissions. Across four historical
                    outbreaks the fused posterior crossed 50% a median of {site.leadDays} days before the
                    clinical wave peak, which is the window MOSAIC is built to buy back for public health teams.
                  </p>
                </Card>
              </div>
            )}

            {section === "lineages" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <TabContext text={site.interpretation.tab.lineages} />
                <Card title="Lineage composition over time" action={<span className="text-[10px] text-muted-foreground">Nextstrain, rolling 14-window</span>}>
                  <LineageTrendChart site={site} />
                </Card>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="Current mix & week-over-week shift"><LineagePanel lineages={site.lineages} /></Card>
                  <Card title="Genomic anomaly score (JSD)" action={<span className="text-[10px] text-muted-foreground">alarm above 0.09</span>}>
                    <GenomicAnomalyChart site={site} />
                  </Card>
                </div>
                <Card title="How genomic surveillance feeds the model">
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Lineage frequencies are tracked over rolling windows. A Jensen-Shannon or KL divergence
                    jump between consecutive windows raises a genomic anomaly score, which feeds the fusion model
                    alongside the wastewater and text streams. A rising minor lineage often precedes a wave, so the
                    divergence signal can lead even the wastewater concentration signal for an immune-escape variant.
                  </p>
                </Card>
              </div>
            )}

            {section === "fusion" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <TabContext text={site.interpretation.tab.fusion} />
                <Card title="Multi-modal Bayesian fusion"><PipelineSchematic site={site} /></Card>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="Stream contribution at this site"><StreamContribution site={site} /></Card>
                  <Card title="How the posterior is built">
                    <p className="text-[12px] leading-relaxed text-muted-foreground">
                      Each stream produces a soft alarm probability: BOCPD change-points on the wastewater
                      activity series, KL divergence anomalies on lineage frequencies, and NLP-extracted
                      outbreak signals from WHO DON and ProMED. A learned logistic and hierarchical Bayesian
                      model fuses them with cross-validated weights, then EpiEstim provides the Rt posterior,
                      and the output is isotonically calibrated so a stated 70% really means 70%.
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
                <Card title="Calibration, reliability diagram" action={<span className="text-[10px] text-muted-foreground">retrospective, 4 outbreaks</span>}>
                  <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                    A model is well-calibrated when its stated probabilities match observed frequencies. Points on
                    the diagonal mean a forecast of X% came true X% of the time. MOSAIC reaches an expected
                    calibration error below 0.10, which is what lets a public-health user act on the number directly.
                  </p>
                  <CalibrationPanel />
                </Card>
              </div>
            )}

            {section === "briefings" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <TabContext text={site.interpretation.tab.briefings} />
                <BriefingCard site={site} />
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <Card title="Recommended actions"><RecommendedActions actions={site.actions} /></Card>
                  <Card title="Briefing archive">
                    <div className="space-y-2">
                      {[0, 7, 14, 21].map((d) => (
                        <div key={d} className="flex items-center justify-between rounded-lg border border-border/50 bg-background px-3 py-2 text-[12px]">
                          <span className="text-foreground">{d === 0 ? "Today" : `${d} days ago`}</span>
                          <span className="font-mono text-muted-foreground">{site.shortLabel} surveillance briefing</span>
                          <span className="text-[10px] text-primary">PDF</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Briefings are generated automatically each cycle and retained for the jurisdiction record.
                    </p>
                  </Card>
                </div>
                <Card title="Pathogen target detail"><PathogenGrid panels={site.panels} /></Card>
              </div>
            )}

            {section === "streams" && (
              <div className="space-y-5">
                <SiteHeader site={site} />
                <TabContext text={site.interpretation.tab.streams} />
                <Card title="Surveillance stream health"><StreamHealthPanel streams={site.streams} /></Card>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                  {[
                    { label: "Wastewater coverage", v: `${(site.populationServed / 1000).toFixed(0)}k`, sub: "population sampled by this sewershed", color: "#34d399" },
                    { label: "Detection rate (15d)", v: `${site.detectProp}%`, sub: "samples with detectable signal", color: "#38bdf8" },
                    { label: "Sequences tracked", v: `${site.lineages.length}`, sub: "circulating lineages this window", color: "#a78bfa" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border border-border/60 bg-card/50 p-4">
                      <p className="text-[11px] text-muted-foreground">{s.label}</p>
                      <p className="mt-1 font-mono text-2xl font-semibold" style={{ color: s.color }}>{s.v}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{s.sub}</p>
                    </div>
                  ))}
                </div>
                <Card title="Data freshness">
                  <div className="space-y-2">
                    {site.streams.map((s) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-[12px] text-foreground">{s.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                          <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max(6, 100 - s.latencyHours)}%` }} />
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-[11px] text-muted-foreground">~{s.latencyHours}h ago</span>
                      </div>
                    ))}
                  </div>
                </Card>
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
                    MOSAIC is open source (MIT). The wastewater backbone of this console, site list,
                    population served, SARS-CoV-2 activity and 15-day change, is real CDC NWSS data
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
                    <Link href="/research" className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground hover:border-border">Research &amp; findings</Link>
                    <a href="/mosaic.pdf" target="_blank" rel="noopener noreferrer" className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs text-foreground hover:border-border">Read the paper (PDF)</a>
                  </div>
                </Card>
                <Card title="Metrics glossary">
                  <dl className="space-y-2.5 text-[12px]">
                    {[
                      ["P(Rt>1)", "Fused posterior probability that the effective reproduction number exceeds 1, i.e. the outbreak is growing. The headline number."],
                      ["Rt", "Effective reproduction number: average secondary infections per case. Above 1 means growth, below 1 means decline."],
                      ["WVAL (0 to 100)", "Wastewater Viral Activity Level, a percentile of current activity against the site's own history. 80 is the elevated-alert threshold."],
                      ["%Δ 15d", "Percent change in activity over the trailing 15 days."],
                      ["JSD", "Jensen-Shannon divergence between consecutive lineage-frequency windows; a spike flags a genomic shift."],
                      ["ECE", "Expected Calibration Error: average gap between stated and observed probabilities. Below 0.10 is well-calibrated."],
                      ["Lead time", "Days the fused signal precedes clinical confirmation of a wave."],
                    ].map(([t, d]) => (
                      <div key={t} className="grid grid-cols-[120px_1fr] gap-3">
                        <dt className="font-mono text-foreground">{t}</dt>
                        <dd className="text-muted-foreground">{d}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
                <Card title="Datasets in this demo">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Dataset</th>
                          <th className="py-2 pr-3 font-medium">Stream</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {[
                          ["CDC NWSS 2ew6-ywp6", "Wastewater", "live", "Real SARS-CoV-2 activity for 21 US sewersheds"],
                          ["Global wastewater network", "Wastewater", "modeled", "18 international cities, demo signals"],
                          ["Nextstrain open data", "Genomic", "live + modeled", "Lineage frequencies; per-site mix modeled"],
                          ["WHO Disease Outbreak News", "Text", "live", "Country-filtered outbreak reports"],
                          ["ProMED-mail", "Text", "live", "NLP-extracted epi events"],
                        ].map((r) => (
                          <tr key={r[0]} className="border-b border-border/40 last:border-0">
                            <td className="py-2 pr-3 font-mono text-foreground">{r[0]}</td>
                            <td className="py-2 pr-3">{r[1]}</td>
                            <td className="py-2 pr-3">
                              <span className={`rounded px-1.5 py-px text-[10px] ${r[2].includes("live") ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{r[2]}</span>
                            </td>
                            <td className="py-2">{r[3]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
          <span className="hidden sm:inline">Last refresh {refreshAt || "-"}</span>
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
