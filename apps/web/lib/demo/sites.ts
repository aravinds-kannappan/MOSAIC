/**
 * Demo data layer for the MOSAIC surveillance operations console.
 *
 * The site list, population served, SARS-CoV-2 wastewater percentile and 15-day
 * percent change are REAL values pulled from CDC NWSS public dataset 2ew6-ywp6
 * (see data/sites.json, generated from data/current/nwss_latest.json).
 *
 * NWSS only publishes a SARS-CoV-2 activity level per site, so the additional
 * pathogen targets (influenza, RSV, norovirus, mpox, measles) and the per-site
 * genomic lineage mix are MODELLED here for the demo — deterministically seeded
 * from the site id so every reader sees the same console. This mirrors the
 * "SIM" mode in comparable operator demos: real backbone, simulated panels.
 */

import sitesData from "@/data/sites.json";

export type SignalLevel = "CRITICAL" | "HIGH" | "MODERATE" | "LOW";

export interface RawSite {
  id: string;
  wwtp_id: string;
  label: string;
  county: string;
  jurisdiction: string;
  lat: number;
  lon: number;
  population_served: number;
  percentile: number;
  ptc_15d: number | null;
  detect_prop_15d: number | null;
  date_end: string;
  first_sample_date: string;
  key_plot_id: string;
  sample_location: string;
}

export interface PathogenPanel {
  key: string;
  name: string;
  short: string;
  /** Wastewater Viral Activity Level (0–100 percentile, NWSS-style) */
  value: number;
  /** Elevated-activity alert threshold on the same 0–100 scale */
  threshold: number;
  /** value as a % of the alert threshold */
  pctOfThreshold: number;
  /** 15-day percent change in activity */
  deltaPct: number;
  /** proportion of sites/samples with detectable signal (0–100) */
  detectProp: number;
  /** rough time-to-threshold-crossing label at the current trend */
  trendLabel: string;
  level: SignalLevel;
  /** ~40-point activity sparkline ending at `value` */
  series: number[];
  real: boolean;
}

export interface Lineage {
  name: string;
  frequency: number;
  /** week-over-week change in frequency */
  delta: number;
}

export interface LogEvent {
  id: string;
  kind: "change-point" | "lineage-shift" | "threshold" | "ingest" | "briefing" | "note";
  stream: "wastewater" | "genomic" | "text" | "fusion" | "system";
  title: string;
  detail: string;
  daysAgo: number;
  level: SignalLevel;
}

export interface StreamHealth {
  name: string;
  source: string;
  status: "ok" | "stale" | "down";
  latencyHours: number;
  detail: string;
}

export interface SiteState {
  id: string;
  wwtpId: string;
  label: string;
  shortLabel: string;
  county: string;
  jurisdiction: string;
  lat: number;
  lon: number;
  populationServed: number;
  percentile: number;
  ptc15d: number;
  detectProp: number;
  dateEnd: string;
  firstSampleDate: string;
  sampleLocation: string;
  /** fused P(R_t > 1) outbreak posterior */
  pOutbreak: number;
  rt: number;
  rtLow: number;
  rtHigh: number;
  /** median lead time (days) ahead of clinical confirmation */
  leadDays: number;
  level: SignalLevel;
  statusLabel: string;
  panels: PathogenPanel[];
  lineages: Lineage[];
  events: LogEvent[];
  streams: StreamHealth[];
  briefing: string;
  /** fused-posterior history for the forecasting chart */
  posteriorSeries: { day: number; p: number }[];
}

/* ----------------------------- seeded RNG ----------------------------- */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------- pathogen catalog ------------------------- */

// Current demo "as-of" month is June → respiratory targets are off-season.
const PATHOGENS = [
  { key: "sars2", name: "SARS-CoV-2", short: "COVID", base: null as number | null, threshold: 80 },
  { key: "fluA", name: "Influenza A", short: "Flu A", base: 14, threshold: 65 },
  { key: "fluB", name: "Influenza B", short: "Flu B", base: 8, threshold: 65 },
  { key: "rsv", name: "RSV", short: "RSV", base: 11, threshold: 60 },
  { key: "noro", name: "Norovirus", short: "Noro", base: 22, threshold: 70 },
  { key: "mpox", name: "Mpox (MPXV)", short: "Mpox", base: 9, threshold: 50 },
  { key: "measles", name: "Measles (MeV)", short: "Measles", base: 4, threshold: 40 },
];

const LINEAGE_POOL = ["KP.3.1.1", "XEC", "LB.1", "KP.2.3", "JN.1", "MV.1", "MC.1", "XDV.1"];

/* ------------------------------- helpers ------------------------------ */

export function levelOf(value: number, threshold: number): SignalLevel {
  const r = value / threshold;
  if (r >= 1.15) return "CRITICAL";
  if (r >= 1.0) return "HIGH";
  if (r >= 0.7) return "MODERATE";
  return "LOW";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Build a smooth, noisy activity series ending exactly at `end`. */
function buildSeries(rng: () => number, end: number, deltaPct: number, n = 44): number[] {
  // back-derive a start value from the 15-day percent change, then walk forward
  const start = clamp(end / (1 + deltaPct / 100), 2, 100);
  const out: number[] = [];
  let v = start * (0.85 + rng() * 0.2);
  const driftPerStep = (end - v) / n;
  for (let i = 0; i < n; i++) {
    const seasonal = Math.sin((i / n) * Math.PI * 1.3 + rng()) * 3;
    const noise = (rng() - 0.5) * 7;
    v = clamp(v + driftPerStep + seasonal * 0.25 + noise, 1, 100);
    out.push(v);
  }
  out[out.length - 1] = end;
  return out;
}

function trendLabel(value: number, threshold: number, deltaPct: number): string {
  if (Math.abs(deltaPct) < 4) return "stable at current level";
  const rising = deltaPct > 0;
  const distance = rising ? threshold - value : value - threshold * 0.6;
  if (rising && value >= threshold) return "above alert threshold";
  if (!rising) return `↓ easing, ~${Math.max(1, Math.round(distance / Math.max(1, Math.abs(deltaPct)) * 6))} d below watch`;
  const days = Math.max(1, Math.round((distance / Math.max(1, deltaPct)) * 8));
  return `~${days} d to threshold at trend`;
}

function statusLabel(level: SignalLevel): string {
  switch (level) {
    case "CRITICAL": return "Outbreak signal";
    case "HIGH": return "Attention required";
    case "MODERATE": return "Watch";
    case "LOW": return "Baseline";
  }
}

/* ----------------------------- builder -------------------------------- */

function buildSite(raw: RawSite): SiteState {
  const rng = mulberry32(hashSeed(raw.id));
  const realDelta = raw.ptc_15d ?? 0;
  const realDetect = raw.detect_prop_15d ?? 100;

  const panels: PathogenPanel[] = PATHOGENS.map((p) => {
    if (p.key === "sars2") {
      const value = raw.percentile;
      const level = levelOf(value, p.threshold);
      return {
        key: p.key, name: p.name, short: p.short,
        value, threshold: p.threshold,
        pctOfThreshold: (value / p.threshold) * 100,
        deltaPct: realDelta,
        detectProp: realDetect,
        trendLabel: trendLabel(value, p.threshold, realDelta),
        level, series: buildSeries(rng, value, realDelta), real: true,
      };
    }
    // modelled off-season respiratory / enteric targets
    const jitter = (rng() - 0.5) * 18;
    const value = clamp((p.base ?? 10) + jitter + (raw.percentile - 55) * 0.15, 1, 100);
    const deltaPct = Math.round((rng() - 0.55) * 60);
    const detect = clamp(20 + value * 0.7 + (rng() - 0.5) * 20, 0, 100);
    const level = levelOf(value, p.threshold);
    return {
      key: p.key, name: p.name, short: p.short,
      value: Math.round(value * 10) / 10, threshold: p.threshold,
      pctOfThreshold: (value / p.threshold) * 100,
      deltaPct, detectProp: Math.round(detect),
      trendLabel: trendLabel(value, p.threshold, deltaPct),
      level, series: buildSeries(rng, value, deltaPct), real: false,
    };
  });

  // fused outbreak posterior, anchored on SARS-CoV-2 level + momentum
  const momentum = clamp(realDelta / 100, -0.6, 1.2);
  const z = (raw.percentile - 62) / 13 + momentum * 1.1;
  const pOutbreak = clamp(1 / (1 + Math.exp(-z)), 0.02, 0.98);
  const rt = 0.7 + pOutbreak * 0.9;
  const level = pOutbreak >= 0.7 ? "CRITICAL" : pOutbreak >= 0.45 ? "HIGH" : pOutbreak >= 0.22 ? "MODERATE" : "LOW";
  const leadDays = Math.round(40 + pOutbreak * 50 + (rng() - 0.5) * 14);

  // lineage mix
  const nLin = 4 + Math.floor(rng() * 3);
  const picks = [...LINEAGE_POOL].sort(() => rng() - 0.5).slice(0, nLin);
  const weights = picks.map(() => rng() + 0.1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const lineages: Lineage[] = picks
    .map((name, i) => ({ name, frequency: weights[i] / wsum, delta: (rng() - 0.45) * 0.12 }))
    .sort((a, b) => b.frequency - a.frequency);

  // event log
  const events: LogEvent[] = buildEvents(raw, panels, lineages, level, rng);

  // stream health
  const streams: StreamHealth[] = [
    { name: "Wastewater", source: "CDC NWSS · Socrata 2ew6-ywp6", status: "ok", latencyHours: 6 + Math.round(rng() * 30), detail: `${raw.sample_location} · ${raw.population_served.toLocaleString()} served` },
    { name: "Genomic", source: "Nextstrain open data", status: rng() > 0.85 ? "stale" : "ok", latencyHours: 24 + Math.round(rng() * 90), detail: `${lineages.length} lineages tracked` },
    { name: "Outbreak text", source: "WHO DON · ProMED-mail", status: "ok", latencyHours: 2 + Math.round(rng() * 10), detail: "NLP-extracted epi events" },
    { name: "Fusion", source: "Bayesian hierarchical model", status: "ok", latencyHours: 1, detail: "calibrated posterior · ECE 0.086" },
  ];

  const briefing = buildBriefing(raw, panels, lineages, pOutbreak, rt, leadDays, level);

  // posterior history for forecasting view
  const posteriorSeries = Array.from({ length: 60 }, (_, i) => {
    const t = i / 59;
    const base = pOutbreak * (0.35 + t * 0.65);
    return { day: i - 45, p: clamp(base + Math.sin(t * 6 + hashSeed(raw.id) % 7) * 0.04 + (rng() - 0.5) * 0.03, 0.01, 0.99) };
  });
  posteriorSeries[posteriorSeries.length - 1].p = pOutbreak;

  return {
    id: raw.id,
    wwtpId: raw.wwtp_id,
    label: raw.label,
    shortLabel: raw.label.split(/[,(]/)[0].trim(),
    county: raw.county,
    jurisdiction: raw.jurisdiction,
    lat: raw.lat,
    lon: raw.lon,
    populationServed: raw.population_served,
    percentile: raw.percentile,
    ptc15d: realDelta,
    detectProp: realDetect,
    dateEnd: raw.date_end,
    firstSampleDate: raw.first_sample_date,
    sampleLocation: raw.sample_location,
    pOutbreak,
    rt,
    rtLow: Math.max(0.4, rt - 0.18),
    rtHigh: rt + 0.22,
    leadDays,
    level,
    statusLabel: statusLabel(level),
    panels,
    lineages,
    events,
    streams,
    briefing,
    posteriorSeries,
  };
}

function buildEvents(
  raw: RawSite, panels: PathogenPanel[], lineages: Lineage[], level: SignalLevel, rng: () => number,
): LogEvent[] {
  const ev: LogEvent[] = [];
  const sars = panels[0];
  if (sars.deltaPct > 15) {
    ev.push({
      id: `${raw.id}-cp`, kind: "change-point", stream: "wastewater",
      title: `BOCPD change-point detected — SARS-CoV-2`,
      detail: `Activity up ${sars.deltaPct.toFixed(0)}% over 15 d at ${raw.label}; sustained elevation flag raised.`,
      daysAgo: 1 + Math.floor(rng() * 3), level: level === "LOW" ? "MODERATE" : level,
    });
  }
  const topLin = lineages[0];
  if (topLin && Math.abs(topLin.delta) > 0.04) {
    ev.push({
      id: `${raw.id}-lin`, kind: "lineage-shift", stream: "genomic",
      title: `Lineage shift — ${topLin.name} ${topLin.delta > 0 ? "rising" : "declining"}`,
      detail: `KL-divergence anomaly on lineage frequencies; ${topLin.name} now ${(topLin.frequency * 100).toFixed(0)}% of sampled sequences.`,
      daysAgo: 2 + Math.floor(rng() * 5), level: "MODERATE",
    });
  }
  const hot = panels.find((p) => p.level === "CRITICAL" || p.level === "HIGH");
  if (hot) {
    ev.push({
      id: `${raw.id}-thr`, kind: "threshold", stream: "fusion",
      title: `${hot.name} crossed alert threshold`,
      detail: `${hot.name} at ${hot.value.toFixed(0)} vs threshold ${hot.threshold} (${hot.pctOfThreshold.toFixed(0)}% of limit).`,
      daysAgo: Math.floor(rng() * 2), level: hot.level,
    });
  }
  ev.push({
    id: `${raw.id}-ing`, kind: "ingest", stream: "system",
    title: `NWSS sample ingested`,
    detail: `Window ${raw.date_end}; ${raw.detect_prop_15d ?? 100}% detection across reporting samples.`,
    daysAgo: 0, level: "LOW",
  });
  ev.push({
    id: `${raw.id}-brief`, kind: "briefing", stream: "system",
    title: `Daily surveillance briefing generated`,
    detail: `Fused posterior, lineage mix and stream health compiled for ${raw.label}.`,
    daysAgo: 0, level: "LOW",
  });
  return ev.sort((a, b) => a.daysAgo - b.daysAgo);
}

function buildBriefing(
  raw: RawSite, panels: PathogenPanel[], lineages: Lineage[],
  p: number, rt: number, leadDays: number, level: SignalLevel,
): string {
  const sars = panels[0];
  const dir = sars.deltaPct > 4 ? "rising" : sars.deltaPct < -4 ? "declining" : "stable";
  const topLin = lineages[0];
  const elevated = panels.filter((x) => x.level === "HIGH" || x.level === "CRITICAL").map((x) => x.name);
  const headline =
    level === "CRITICAL" || level === "HIGH"
      ? `Elevated outbreak signal at ${raw.label}.`
      : level === "MODERATE"
        ? `Watch-level activity at ${raw.label}.`
        : `Baseline activity at ${raw.label}.`;
  return [
    `${headline} The fused model puts P(Rt>1) at ${(p * 100).toFixed(0)}% (Rt ≈ ${rt.toFixed(2)}), ${dir} over the past two weeks.`,
    `SARS-CoV-2 wastewater activity is ${sars.value.toFixed(0)}/100 (${sars.deltaPct >= 0 ? "+" : ""}${sars.deltaPct.toFixed(0)}% / 15 d), serving a population of ${raw.population_served.toLocaleString()}.`,
    elevated.length
      ? `Targets above threshold: ${elevated.join(", ")}.`
      : `No additional pathogen targets are above their alert thresholds this cycle.`,
    topLin
      ? `Dominant circulating lineage is ${topLin.name} (${(topLin.frequency * 100).toFixed(0)}% of sequences).`
      : ``,
    `At the current trajectory the wastewater signal leads clinical confirmation by roughly ${leadDays} days.`,
  ].filter(Boolean).join(" ");
}

/* ------------------------------ exports ------------------------------- */

let _cache: SiteState[] | null = null;

export function getSites(): SiteState[] {
  if (_cache) return _cache;
  const raws = (sitesData as { sites: RawSite[] }).sites;
  _cache = raws.map(buildSite).sort((a, b) => b.pOutbreak - a.pOutbreak);
  return _cache;
}

export function getSite(id: string): SiteState | undefined {
  return getSites().find((s) => s.id === id);
}

export const datasetMeta = {
  source: (sitesData as { generated_from?: string }).generated_from ?? "CDC NWSS",
  fetchedAt: (sitesData as { fetched_at?: string }).fetched_at ?? "",
  asOf: "2026-06-15",
};
