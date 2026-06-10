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
  if (wwRes.status === "fulfilled" && wwRes.value.sites.length > 0) {
    wastewaterAlarms["SARS-CoV-2"] = wwRes.value.sites[0].changePointProb ?? 0;
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

  for (const pathogen of allPathogens) {
    const hasText = pathogen in textAlarms;
    const hasWw = pathogen in wastewaterAlarms;
    const hasGen = pathogen in genomicAlarms;

    const pText = textAlarms[pathogen] ?? 0;
    const pWw = wastewaterAlarms[pathogen] ?? 0;
    const pGen = genomicAlarms[pathogen] ?? 0;

    const pFused = fuseStreamProbs([
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

    let location = "Global";
    let locationIso = "";
    const forPathogen = events.filter(
      (e) => e.extracted.pathogen?.toLowerCase() === pathogen.toLowerCase()
    );
    const locCounts: Record<string, { count: number; iso: string }> = {};
    for (const ev of forPathogen) {
      if (ev.extracted.location && ev.extracted.locationIso) {
        const key = ev.extracted.location;
        locCounts[key] = {
          count: (locCounts[key]?.count ?? 0) + 1,
          iso: ev.extracted.locationIso,
        };
      }
    }
    const topLoc = Object.entries(locCounts).sort((a, b) => b[1].count - a[1].count)[0];
    const wastewaterDominant = hasWw && pWw >= pText;
    if (wastewaterDominant) {
      location = "United States";
      locationIso = "US";
    } else if (topLoc) {
      location = topLoc[0];
      locationIso = topLoc[1].iso;
    } else if (hasWw) {
      location = "United States";
      locationIso = "US";
    }

    const promedPost = forPathogen.find((e) => e.link)?.link;
    const noveltyFlag = forPathogen.some((e) => e.extracted.noveltyFlag);

    alerts.push({
      id: `${pathogen}-${locationIso || "global"}-${now}`,
      pathogen,
      location,
      location_country: locationIso,
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
      fusionMethod: "lightweight-js",
      note: "Deploy Python backend (MOSAIC_API_URL) for full NumPyro NUTS hierarchical fusion",
      fetchedAt: new Date().toISOString(),
    },
  };
}
