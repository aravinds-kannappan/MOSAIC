/**
 * Multi-stream fusion (MOSAIC Layer 3, lightweight JS substitute).
 *
 * Computes the fused outbreak probability for each active pathogen-location pair
 * by combining the three streams in-process (no HTTP self-fetch). Used by both
 * `/api/v1/alerts` and `/api/v1/outbreak-probability`.
 */

import { runBOCPD, recentChangeAlarm } from "@/lib/bocpd";
import {
  fetchWastewater,
  fetchGenomic,
  fetchText,
  type ExtractedEvent,
} from "@/lib/streams";
import { resolveCountries } from "@/lib/countries";
import { estimateRt, SERIAL_INTERVALS } from "@/lib/rt-estimation";
import learnedFusion from "@/data/learned_fusion.json";
import type { ActiveAlert, AlertLevel } from "@/lib/types";

const MAX_SERIES_DAYS = 400;

export function alertLevel(p: number): AlertLevel {
  if (p >= 0.85) return "CRITICAL";
  if (p >= 0.7) return "HIGH";
  if (p >= 0.4) return "MODERATE";
  return "LOW";
}

/** Soft stream fusion over the streams that have data, with equal split weights. */
function fuseStreamProbs(streams: Array<{ p: number; present: boolean }>): number {
  const present = streams.filter((s) => s.present);
  if (present.length === 0) return 0;
  const w = 1 / present.length;
  return 1 - present.reduce((acc, s) => acc * (1 - w * s.p), 1);
}

/**
 * Learned logistic fusion of the three stream signals, with weights fit by
 * cross-validation on realised growth (see paper/make_learned_fusion.py). Used
 * for the multi-stream SARS-CoV-2 cell where the wastewater feature is the
 * EpiEstim P(R_t>1); other cells fall back to the noisy-or above.
 */
const LW = learnedFusion.fusion;
function learnedFuse(aText: number, wwPRt1: number, aGen: number): number {
  const z = LW.bias + LW.w_text * aText + LW.w_wastewater * wwPRt1 + LW.w_genomic * aGen;
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** Dense daily count series (zero-filled) ending at `now`. */
function denseDailyCounts(dailyCounts: Record<string, number>, now: number): number[] {
  const dates = Object.keys(dailyCounts).sort();
  if (dates.length === 0) return [];
  const firstMs = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const endDay = Math.floor(now / 86_400_000);
  const startDay = Math.max(Math.floor(firstMs / 86_400_000), endDay - (MAX_SERIES_DAYS - 1));
  const series = new Array<number>(endDay - startDay + 1).fill(0);
  for (const [d, c] of Object.entries(dailyCounts)) {
    const idx = Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 86_400_000) - startDay;
    if (idx >= 0 && idx < series.length) series[idx] += c;
  }
  return series;
}

/**
 * Per-pathogen text-stream alarm in [0, 1]: a BOCPD change-point signal weighted
 * by recency (days since last report) and intensity (recent report volume), so
 * an actively-reported outbreak ranks above a single stale mention.
 */
export function textAlarm(dailyCounts: Record<string, number>, now: number): number {
  const dates = Object.keys(dailyCounts).sort();
  if (dates.length === 0) return 0;

  const counts = denseDailyCounts(dailyCounts, now);
  const bocpd =
    counts.length >= 3 ? recentChangeAlarm(runBOCPD(counts, { meanRunLength: 30 }).changePointProb, 21) : 0;

  const lastMs = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  const daysSinceLast = Math.max(0, (now - lastMs) / 86_400_000);
  const recency = Math.exp(-daysSinceLast / 45);

  const windowMs = 120 * 86_400_000;
  let recentCount = 0;
  for (const [d, c] of Object.entries(dailyCounts)) {
    if (now - new Date(`${d}T00:00:00Z`).getTime() <= windowMs) recentCount += c;
  }
  const intensity = 1 - Math.exp(-recentCount / 3);

  return Math.min(1, 0.45 * bocpd + 0.55 * recency * intensity);
}

export interface AlertsPayload {
  alerts: ActiveAlert[];
  meta: Record<string, unknown>;
}

export async function computeAlerts(): Promise<AlertsPayload> {
  const [wwRes, genRes, textRes] = await Promise.allSettled([
    fetchWastewater({ pathogen: "SARS-CoV-2" }),
    fetchGenomic("sars-cov-2"),
    fetchText(),
  ]);

  const now = Date.now();

  const textAlarms: Record<string, number> = {};
  if (textRes.status === "fulfilled") {
    for (const [pathogen, dailyCounts] of Object.entries(textRes.value.countsByPathogen)) {
      textAlarms[pathogen] = textAlarm(dailyCounts, now);
    }
  }

  const wastewaterAlarms: Record<string, number> = {};
  let wwPRt1 = 0; // wastewater EpiEstim P(R_t>1), the learned-fusion wastewater feature
  if (wwRes.status === "fulfilled" && wwRes.value.sites.length > 0) {
    const site = wwRes.value.sites[0];
    wastewaterAlarms["SARS-CoV-2"] = site.changePointProb ?? 0;
    const series = site.timeSeries ?? [];
    if (series.length > 30) {
      const dates = series.map((r) => r.date);
      const counts = series.map((r) => Math.round(Math.max(0, r.percentile)));
      const rt = estimateRt(dates, counts, SERIAL_INTERVALS["SARS-CoV-2"]);
      wwPRt1 = rt.length ? rt[rt.length - 1].pOutbreak : 0;
    }
  }

  const genomicAlarms: Record<string, number> = {};
  if (genRes.status === "fulfilled" && typeof genRes.value.genomicAlarmProb === "number") {
    genomicAlarms["SARS-CoV-2"] = genRes.value.genomicAlarmProb;
  }

  const allPathogens = new Set([
    ...Object.keys(textAlarms),
    ...Object.keys(wastewaterAlarms),
    ...Object.keys(genomicAlarms),
  ]);

  const events: ExtractedEvent[] = textRes.status === "fulfilled" ? textRes.value.events : [];
  const alerts: ActiveAlert[] = [];
  let usedLearned = false;

  for (const pathogen of allPathogens) {
    const hasText = pathogen in textAlarms;
    const hasWw = pathogen in wastewaterAlarms;
    const hasGen = pathogen in genomicAlarms;

    const pText = textAlarms[pathogen] ?? 0;
    const pWw = wastewaterAlarms[pathogen] ?? 0;
    const pGen = genomicAlarms[pathogen] ?? 0;

    // Multi-stream cells (≥2 streams with data) use the learned logistic fusion
    // with the wastewater P(R_t>1) feature; single-stream cells use noisy-or.
    const nStreams = (hasText ? 1 : 0) + (hasWw ? 1 : 0) + (hasGen ? 1 : 0);
    const useLearned = nStreams >= 2 && hasWw;
    if (useLearned) usedLearned = true;
    const pFused = useLearned
      ? learnedFuse(pText, wwPRt1, pGen)
      : fuseStreamProbs([
          { p: pText, present: hasText },
          { p: pWw, present: hasWw },
          { p: pGen, present: hasGen },
        ]);
    if (pFused < 0.05) continue;

    const rawContribs = {
      text: hasText ? pText : 0,
      ww: hasWw ? pWw : 0,
      gen: hasGen ? pGen : 0,
    };
    const contribTotal = rawContribs.text + rawContribs.ww + rawContribs.gen || 1;

    const forPathogen = events.filter(
      (e) => e.extracted.pathogen?.toLowerCase() === pathogen.toLowerCase()
    );

    // Aggregate ALL countries mentioned across this pathogen's reports, ranked
    // by how often each is mentioned, so we can list specific countries rather
    // than collapsing to a vague "Global".
    const countryStats = new Map<string, { name: string; iso: string; count: number }>();
    for (const ev of forPathogen) {
      for (const c of resolveCountries(`${ev.title} ${ev.description}`)) {
        const cur = countryStats.get(c.iso_a2);
        if (cur) cur.count += 1;
        else countryStats.set(c.iso_a2, { name: c.name, iso: c.iso_a2, count: 1 });
      }
    }
    const rankedCountries = Array.from(countryStats.values()).sort((a, b) => b.count - a.count);

    const wastewaterDominant = hasWw && pWw >= pText;
    let location: string;
    let locationIso: string;
    let countries: Array<{ name: string; iso_a2: string }>;

    if (wastewaterDominant) {
      location = "United States";
      locationIso = "US";
      countries = [{ name: "United States", iso_a2: "US" }];
    } else if (rankedCountries.length > 0) {
      countries = rankedCountries.map((c) => ({ name: c.name, iso_a2: c.iso }));
      locationIso = rankedCountries[0].iso;
      const names = rankedCountries.map((c) => c.name);
      location =
        names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
    } else if (hasWw) {
      location = "United States";
      locationIso = "US";
      countries = [{ name: "United States", iso_a2: "US" }];
    } else {
      location = "Multiple countries";
      locationIso = "";
      countries = [];
    }

    const promedPost = forPathogen.find((e) => e.link)?.link;
    const noveltyFlag = forPathogen.some((e) => e.extracted.noveltyFlag);

    alerts.push({
      id: `${pathogen}-${locationIso || "multi"}-${now}`,
      pathogen,
      location,
      location_country: locationIso,
      countries,
      p_outbreak: pFused,
      r_t_median: 1 + pFused * 0.5,
      r_t_ci_lower: 1 + pFused * 0.1,
      r_t_ci_upper: 1 + pFused * 1.2,
      alert_level: alertLevel(pFused),
      stream_contributions: {
        text_stream: rawContribs.text / contribTotal,
        wastewater_stream: rawContribs.ww / contribTotal,
        genomic_stream: rawContribs.gen / contribTotal,
      },
      last_updated: new Date().toISOString(),
      source_links: {
        promed_post: promedPost,
        nwss_site: "https://www.cdc.gov/nwss/",
        nextstrain: `https://nextstrain.org/${pathogen.toLowerCase().replace(/-/g, "")}`,
      },
      novelty_flag: noveltyFlag,
    });
  }

  alerts.sort((a, b) => b.p_outbreak - a.p_outbreak);

  return {
    alerts,
    meta: {
      count: alerts.length,
      streamStatus: {
        text: textRes.status === "fulfilled" ? "ok" : "error",
        wastewater: wwRes.status === "fulfilled" ? "ok" : "error",
        genomic: genRes.status === "fulfilled" ? "ok" : "error",
      },
      fusionMethod: usedLearned ? "learned-logistic" : "lightweight-js",
      note: "Multi-stream cells use a learned logistic fusion; single-stream cells use noisy-or. Deploy MOSAIC_API_URL for full NumPyro NUTS fusion.",
      fetchedAt: new Date().toISOString(),
    },
  };
}
