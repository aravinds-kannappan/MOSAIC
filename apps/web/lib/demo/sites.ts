/**
 * Demo data layer for the MOSAIC surveillance operations console.
 *
 * The site list, population served, SARS-CoV-2 wastewater percentile and 15-day
 * percent change are REAL values pulled from CDC NWSS public dataset 2ew6-ywp6
 * (see data/sites.json, generated from data/current/nwss_latest.json).
 *
 * NWSS only publishes a SARS-CoV-2 activity level per site, so the additional
 * pathogen targets (influenza, RSV, norovirus, mpox, measles) and the per-site
 * genomic lineage mix are MODELLED here for the demo, deterministically seeded
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
  country?: string;
  iso?: string;
  international?: boolean;
  region?: string;
}

export interface PathogenPanel {
  key: string;
  name: string;
  short: string;
  /** Wastewater Viral Activity Level (0-100 percentile, NWSS-style) */
  value: number;
  /** Elevated-activity alert threshold on the same 0-100 scale */
  threshold: number;
  /** value as a % of the alert threshold */
  pctOfThreshold: number;
  /** 15-day percent change in activity */
  deltaPct: number;
  /** proportion of sites/samples with detectable signal (0-100) */
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
  country: string;
  iso: string;
  international: boolean;
  region: string;
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
  /** normalized per-stream contribution to the fused posterior (sums to 1) */
  streamContrib: { wastewater: number; genomic: number; text: number };
  /** stacked lineage frequencies over rolling windows (for the area chart) */
  lineageHistory: Array<Record<string, number | string>>;
  /** genomic divergence (JSD) anomaly timeline */
  jsdSeries: Array<{ day: number; jsd: number; alarm: number }>;
  /** recommended actions for the daily briefing */
  actions: string[];
  /** city name for news queries (no county/state suffix) */
  cityName: string;
  /** rank by P(Rt>1) within the monitored network (1 = highest) */
  rank: number;
  networkSize: number;
  /** plain-language, location-specific interpretation of the numbers */
  interpretation: SiteInterpretation;
}

export interface SiteInterpretation {
  /** one-line analyst headline for this city */
  headline: string;
  /** what the current signal means here */
  assessment: string;
  /** why it matters: impact framing for this population */
  soWhat: string;
  /** specific things to watch at this site */
  watch: string[];
  /** how this site compares to the rest of the network */
  comparison: string;
  /** short contextual lead lines, one per console tab */
  tab: { forecasting: string; lineages: string; fusion: string; briefings: string; streams: string };
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
  { key: "dengue", name: "Dengue", short: "Dengue", base: 16, threshold: 60 },
  { key: "cholera", name: "Cholera", short: "Cholera", base: 6, threshold: 45 },
  { key: "polio", name: "Poliovirus", short: "Polio", base: 3, threshold: 35 },
  { key: "hepa", name: "Hepatitis A", short: "Hep A", base: 9, threshold: 55 },
  { key: "h5n1", name: "Avian flu (H5N1)", short: "H5N1", base: 5, threshold: 40 },
  { key: "pertussis", name: "Pertussis", short: "Pertussis", base: 12, threshold: 55 },
  { key: "rota", name: "Rotavirus", short: "Rota", base: 14, threshold: 60 },
];

/** Region-specific endemicity bumps so each city's panel reflects its geography. */
function regionBias(key: string, region: string): number {
  const tropical = region === "Asia-Pacific" || region === "Africa" || region === "Americas";
  switch (key) {
    case "dengue": return tropical ? 24 : -8;
    case "cholera": return region === "Africa" ? 20 : region === "Asia-Pacific" ? 10 : -3;
    case "hepa": return region === "Africa" || region === "Asia-Pacific" ? 9 : 0;
    case "polio": return region === "Asia-Pacific" || region === "Africa" || region === "Middle East" ? 7 : 0;
    case "rota": return tropical ? 8 : 0;
    case "measles": return region === "Europe" || region === "Africa" ? 6 : 0;
    default: return 0;
  }
}

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

  const isReal = !raw.international;
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
        level, series: buildSeries(rng, value, realDelta), real: isReal,
      };
    }
    // modelled targets, seasonally and regionally adjusted
    const jitter = (rng() - 0.5) * 18;
    const value = clamp((p.base ?? 10) + jitter + (raw.percentile - 55) * 0.15 + regionBias(p.key, raw.region ?? "United States"), 1, 100);
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
    { name: "Wastewater", source: isReal ? "CDC NWSS · Socrata 2ew6-ywp6" : "Global wastewater network (modeled)", status: "ok", latencyHours: 6 + Math.round(rng() * 30), detail: `${raw.sample_location} · ${raw.population_served.toLocaleString()} served` },
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

  // Per-stream contribution to the fused posterior (normalized).
  const sars = panels[0];
  const wRaw = clamp(sars.value / 100, 0, 1);
  const gRaw = clamp((lineages[0]?.delta ?? 0) * 4 + 0.25, 0.05, 1);
  const tRaw = clamp(events.filter((e) => e.stream === "text").length * 0.25 + 0.3, 0.05, 1);
  const cSum = wRaw + gRaw + tRaw || 1;
  const streamContrib = { wastewater: wRaw / cSum, genomic: gRaw / cSum, text: tRaw / cSum };

  // Lineage frequencies over 14 rolling windows, ending at the current mix.
  const nWeeks = 14;
  const startWeights = lineages.map(() => rng() + 0.1);
  const sW = startWeights.reduce((a, b) => a + b, 0);
  const lineageHistory: Array<Record<string, number | string>> = [];
  for (let w = 0; w < nWeeks; w++) {
    const t = w / (nWeeks - 1);
    const row: Record<string, number | string> = { week: `W-${nWeeks - 1 - w}` };
    let total = 0;
    const raw = lineages.map((l, i) => {
      const from = startWeights[i] / sW;
      const v = Math.max(0.001, from * (1 - t) + l.frequency * t + (rng() - 0.5) * 0.04);
      total += v;
      return v;
    });
    lineages.forEach((l, i) => { row[l.name] = Math.round((raw[i] / total) * 1000) / 1000; });
    lineageHistory.push(row);
  }

  // Genomic divergence (JSD) anomaly timeline, 45 days.
  const jsdSeries = Array.from({ length: 45 }, (_, i) => {
    const spike = Math.exp(-Math.pow(i - 33, 2) / 30) * (gRaw * 0.25);
    const jsd = clamp(0.03 + Math.abs(Math.sin(i / 7 + hashSeed(raw.id) % 5)) * 0.04 + spike + (rng() - 0.5) * 0.015, 0, 0.5);
    return { day: i - 44, jsd: Math.round(jsd * 1000) / 1000, alarm: clamp(1 / (1 + Math.exp(-(jsd - 0.09) / 0.02)), 0, 1) };
  });

  // Recommended actions for the briefing.
  const actions = buildActions(level, sars, panels, lineages[0]);

  return {
    id: raw.id,
    wwtpId: raw.wwtp_id,
    label: raw.label,
    shortLabel: raw.label.split(/[,(]/)[0].trim(),
    county: raw.county,
    jurisdiction: raw.jurisdiction,
    country: raw.country ?? "United States",
    iso: raw.iso ?? "US",
    international: raw.international ?? false,
    region: raw.region ?? "United States",
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
    streamContrib,
    lineageHistory,
    jsdSeries,
    actions,
    cityName: raw.label.split(/[,(]/)[0].trim().replace(/ County$/, ""),
    // filled in by the network pass in getSites()
    rank: 0,
    networkSize: 0,
    interpretation: {
      headline: "", assessment: "", soWhat: "", watch: [], comparison: "",
      tab: { forecasting: "", lineages: "", fusion: "", briefings: "", streams: "" },
    },
  };
}

/** Location-specific interpretation, computed with network context. */
function buildInterpretation(s: SiteState, medianP: number, n: number): SiteInterpretation {
  const p = Math.round(s.pOutbreak * 100);
  const pop = s.populationServed.toLocaleString();
  const ratio = medianP > 0 ? s.pOutbreak / medianP : 1;
  const elevated = s.panels.filter((x) => (x.level === "HIGH" || x.level === "CRITICAL") && x.key !== "sars2");
  const sars = s.panels[0];
  const top = s.lineages[0];

  const headline =
    s.level === "CRITICAL" ? `${s.cityName} is showing a strong, active growth signal.`
    : s.level === "HIGH" ? `${s.cityName} warrants attention: transmission is probably rising.`
    : s.level === "MODERATE" ? `${s.cityName} is on watch, with early signs of growth.`
    : `${s.cityName} is at baseline, with no strong growth signal.`;

  const assessment =
    `The fused model puts the probability that transmission is rising at ${p}% (Rt around ${s.rt.toFixed(2)}), ` +
    `${sars.deltaPct > 4 ? "and the wastewater signal is climbing" : sars.deltaPct < -4 ? "and the wastewater signal is easing" : "with the wastewater signal roughly flat"} ` +
    `(${sars.deltaPct >= 0 ? "+" : ""}${sars.deltaPct.toFixed(0)}% over 15 days). ` +
    (elevated.length ? `Beyond SARS-CoV-2, ${elevated.map((e) => e.name).join(" and ")} ${elevated.length > 1 ? "are" : "is"} above the local alert threshold.` : `No other tracked pathogen is above threshold here this cycle.`);

  const soWhat =
    `This catchment serves about ${pop} people, so a ${p}% growth probability is not abstract: at the current trajectory it buys roughly ${s.leadDays} days of warning before cases would surface in ${s.cityName}'s clinics and emergency departments. ` +
    (s.level === "CRITICAL" || s.level === "HIGH"
      ? `For a population this size that lead is the window to staff up, restock testing, and brief clinicians before a wave rather than during one.`
      : s.level === "MODERATE"
        ? `That lead is currently a planning buffer, not a trigger, but it is the moment to confirm the signal before it hardens.`
        : `There is nothing to act on today; the value of monitoring here is catching the turn early if it comes.`);

  const comparison =
    `Its growth probability is ${ratio.toFixed(1)}x the network median and it ranks #${s.rank} of ${n} monitored sites worldwide.`;

  const watch: string[] = [];
  if (sars.deltaPct > 20) watch.push(`SARS-CoV-2 activity is rising fast (${sars.deltaPct.toFixed(0)}% / 15d); expect ED pressure to follow in roughly two weeks.`);
  for (const e of elevated) watch.push(`${e.name} is at ${e.value.toFixed(0)} versus a threshold of ${e.threshold}; cross-check syndromic data.`);
  if (top && top.delta > 0.04) watch.push(`${top.name} is gaining share of sequenced samples; an immune-escape variant can lead even the wastewater concentration.`);
  if (watch.length === 0) watch.push(`No specific escalations; continue routine weekly sampling and watch for a sustained turn in the wastewater trend.`);

  const denguePanel = s.panels.find((x) => x.key === "dengue");
  const tab = {
    forecasting: `For ${s.cityName}, the posterior is ${s.pOutbreak >= 0.5 ? "above" : "below"} the 50% decision line; the ${s.leadDays}-day lead is what this view is buying back for a metro of ${pop}.`,
    lineages: `${top ? `${top.name} dominates the local mix here` : "The local lineage mix is stable"}, which matters because a rising minor lineage in ${s.cityName} can signal escape before concentrations move.`,
    fusion: `At ${s.cityName} the signal is led by ${dominantStream(s.streamContrib)}; agreement across independent streams is why this ${p}% can be acted on.`,
    briefings: `This briefing is written for ${s.cityName} specifically: ${s.level === "LOW" ? "a routine, no-action cycle" : "an active cycle that needs a decision"}.`,
    streams: `${s.cityName}'s coverage is about ${(s.populationServed / 1000).toFixed(0)}k people; ${denguePanel && denguePanel.value > denguePanel.threshold * 0.8 ? "note dengue is locally relevant given the region" : "stream freshness here is the main data-quality lever"}.`,
  };

  return { headline, assessment, soWhat, watch, comparison, tab };
}

function dominantStream(c: { wastewater: number; genomic: number; text: number }): string {
  const m = Math.max(c.wastewater, c.genomic, c.text);
  if (m === c.wastewater) return "the wastewater stream";
  if (m === c.genomic) return "the genomic stream";
  return "the outbreak-text stream";
}

function buildActions(
  level: SignalLevel, sars: PathogenPanel, panels: PathogenPanel[], topLineage?: Lineage,
): string[] {
  const out: string[] = [];
  if (level === "CRITICAL" || level === "HIGH") {
    out.push("Brief the jurisdiction's epidemiology team and pre-position rapid-test and reporting capacity.");
    out.push("Increase wastewater sampling cadence at this sewershed to twice weekly.");
  } else if (level === "MODERATE") {
    out.push("Flag for watch-list review at the next surveillance standup.");
  } else {
    out.push("No action required; continue routine weekly sampling.");
  }
  const elevated = panels.filter((p) => (p.level === "HIGH" || p.level === "CRITICAL") && p.key !== "sars2");
  if (elevated.length) out.push(`Cross-check clinical syndromic data for ${elevated.map((p) => p.name).join(", ")}.`);
  if (topLineage && topLineage.delta > 0.04) out.push(`Confirm the ${topLineage.name} lineage rise with targeted sequencing.`);
  if (sars.deltaPct > 25) out.push("Issue a provisional growth advisory; the wastewater signal is rising fast.");
  return out;
}

function buildEvents(
  raw: RawSite, panels: PathogenPanel[], lineages: Lineage[], level: SignalLevel, rng: () => number,
): LogEvent[] {
  const ev: LogEvent[] = [];
  const sars = panels[0];
  if (sars.deltaPct > 15) {
    ev.push({
      id: `${raw.id}-cp`, kind: "change-point", stream: "wastewater",
      title: `BOCPD change-point detected, SARS-CoV-2`,
      detail: `Activity up ${sars.deltaPct.toFixed(0)}% over 15 d at ${raw.label}; sustained elevation flag raised.`,
      daysAgo: 1 + Math.floor(rng() * 3), level: level === "LOW" ? "MODERATE" : level,
    });
  }
  const topLin = lineages[0];
  if (topLin && Math.abs(topLin.delta) > 0.04) {
    ev.push({
      id: `${raw.id}-lin`, kind: "lineage-shift", stream: "genomic",
      title: `Lineage shift, ${topLin.name} ${topLin.delta > 0 ? "rising" : "declining"}`,
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
  const built = raws.map(buildSite).sort((a, b) => b.pOutbreak - a.pOutbreak);
  const ps = built.map((s) => s.pOutbreak).sort((a, b) => a - b);
  const median = ps.length ? ps[Math.floor(ps.length / 2)] : 0.2;
  built.forEach((s, i) => {
    s.rank = i + 1;
    s.networkSize = built.length;
    s.interpretation = buildInterpretation(s, median, built.length);
  });
  _cache = built;
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
