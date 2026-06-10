/**
 * MOSAIC Alerts API — Multi-Stream Fusion
 *
 * Aggregates the three surveillance streams (text, wastewater, genomic) and
 * computes a fused outbreak probability for each active pathogen-location pair.
 *
 * Fusion logic (lightweight JS substitute for full NumPyro renewal-equation model):
 *   p_fused = 1 - Π_i (1 - w_i * p_i)
 *
 * where the weights w_i are split equally across the streams that actually have
 * data for a given pathogen (so a text-only signal such as an Ebola WHO DON is
 * not divided down by absent wastewater/genomic streams).
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies to
 * the full NumPyro NUTS inference endpoint for calibrated MCMC posteriors.
 *
 * Ref: MOSAIC paper §6 (Layer 3 — Multi-Modal Bayesian Hierarchical Fusion)
 */

import { NextResponse } from "next/server";
import { runBOCPD, recentChangeAlarm } from "@/lib/bocpd";
import { resolveCountry } from "@/lib/countries";
import type { ActiveAlert, AlertLevel } from "@/lib/types";

// Dynamic: this route fans out to the sibling stream routes at request time, so
// it must not be statically prerendered at build (when the server isn't serving
// yet, which would bake an empty alert list into the deployment).
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Soft stream fusion over the streams that have data, with equal split weights. */
function fuseStreamProbs(streams: Array<{ p: number; present: boolean }>): number {
  const present = streams.filter((s) => s.present);
  if (present.length === 0) return 0;
  const w = 1 / present.length;
  return 1 - present.reduce((acc, s) => acc * (1 - w * s.p), 1);
}

function alertLevel(p: number): AlertLevel {
  if (p >= 0.85) return "CRITICAL";
  if (p >= 0.70) return "HIGH";
  if (p >= 0.40) return "MODERATE";
  return "LOW";
}

const MAX_SERIES_DAYS = 400;

/**
 * Build a dense daily count series (zero-filled) ending at `now`, so the most
 * recent observations are always trailing days. A pathogen last reported long
 * ago therefore ends in a run of zeros and its change-point alarm decays —
 * rather than freezing at the spike of its final (possibly stale) report.
 */
function denseDailyCounts(dailyCounts: Record<string, number>, now: number): number[] {
  const dates = Object.keys(dailyCounts).sort();
  if (dates.length === 0) return [];
  const firstMs = new Date(`${dates[0]}T00:00:00Z`).getTime();
  const endDay = Math.floor(now / 86_400_000);
  const startDay = Math.max(
    Math.floor(firstMs / 86_400_000),
    endDay - (MAX_SERIES_DAYS - 1)
  );
  const series = new Array<number>(endDay - startDay + 1).fill(0);
  for (const [d, c] of Object.entries(dailyCounts)) {
    const idx = Math.floor(new Date(`${d}T00:00:00Z`).getTime() / 86_400_000) - startDay;
    if (idx >= 0 && idx < series.length) series[idx] += c;
  }
  return series;
}

/**
 * Per-pathogen text-stream alarm in [0, 1].
 *
 * Combines a BOCPD change-point signal on the dense daily report series with a
 * recency factor (how long since the last report) and an intensity factor (how
 * many reports in the recent window). This differentiates an actively-reported
 * outbreak (e.g. Ebola, several recent WHO DONs) from a single stale mention,
 * rather than saturating every pathogen at the same value.
 */
function textAlarm(dailyCounts: Record<string, number>, now: number): number {
  const dates = Object.keys(dailyCounts).sort();
  if (dates.length === 0) return 0;

  const counts = denseDailyCounts(dailyCounts, now);
  const bocpd = counts.length >= 3 ? recentChangeAlarm(runBOCPD(counts, { meanRunLength: 30 }).changePointProb, 21) : 0;

  const lastMs = new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime();
  const daysSinceLast = Math.max(0, (now - lastMs) / 86_400_000);
  const recency = Math.exp(-daysSinceLast / 45); // ~0.37 at 45 days, ~0.14 at 90

  const windowMs = 120 * 86_400_000;
  let recentCount = 0;
  for (const [d, c] of Object.entries(dailyCounts)) {
    if (now - new Date(`${d}T00:00:00Z`).getTime() <= windowMs) recentCount += c;
  }
  const intensity = 1 - Math.exp(-recentCount / 3); // saturating in report volume

  return Math.min(1, 0.45 * bocpd + 0.55 * recency * intensity);
}

interface PromedEvent {
  link: string;
  extracted: {
    pathogen: string | null;
    location: string | null;
    locationIso: string | null;
    noveltyFlag: boolean;
  };
}

export async function GET() {
  // If Python backend is configured, proxy to full inference
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/alerts`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to lightweight fusion
    }
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const getJson = (path: string, revalidateSec: number) =>
    fetch(`${baseUrl}${path}`, {
      next: { revalidate: revalidateSec },
      signal: AbortSignal.timeout(20_000),
    }).then((r) => r.json());

  // Fetch all three streams in parallel
  const [promedRes, nwssRes, nextstrainRes] = await Promise.allSettled([
    getJson("/api/v1/promed", 900),
    getJson("/api/v1/nwss?pathogen=SARS-CoV-2", 3600),
    getJson("/api/v1/nextstrain?pathogen=sars-cov-2", 7200),
  ]);

  // Per-pathogen text alarm: BOCPD change-point + recency/intensity weighting
  const now = Date.now();
  const textAlarms: Record<string, number> = {};
  if (promedRes.status === "fulfilled" && promedRes.value?.countsByPathogen) {
    for (const [pathogen, dailyCounts] of Object.entries(
      promedRes.value.countsByPathogen as Record<string, Record<string, number>>
    )) {
      textAlarms[pathogen] = textAlarm(dailyCounts, now);
    }
  }

  // Wastewater alarm (SARS-CoV-2 only): national change-point probability
  const wastewaterAlarms: Record<string, number> = {};
  if (nwssRes.status === "fulfilled" && nwssRes.value?.sites?.length > 0) {
    wastewaterAlarms["SARS-CoV-2"] = nwssRes.value.sites[0].changePointProb ?? 0;
  }

  // Genomic alarm from Nextstrain
  const genomicAlarms: Record<string, number> = {};
  if (nextstrainRes.status === "fulfilled" && typeof nextstrainRes.value?.genomicAlarmProb === "number") {
    genomicAlarms["SARS-CoV-2"] = nextstrainRes.value.genomicAlarmProb;
  }

  const allPathogens = new Set([
    ...Object.keys(textAlarms),
    ...Object.keys(wastewaterAlarms),
    ...Object.keys(genomicAlarms),
  ]);

  const events: PromedEvent[] =
    promedRes.status === "fulfilled" ? (promedRes.value?.events ?? []) : [];

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
    if (pFused < 0.05) continue; // Skip very low signal

    // Stream contributions (normalised marginal evidence)
    const rawContribs = {
      text: hasText ? pText : 0,
      ww: hasWw ? pWw : 0,
      gen: hasGen ? pGen : 0,
    };
    const contribTotal = rawContribs.text + rawContribs.ww + rawContribs.gen || 1;

    // Resolve location. When wastewater is the dominant stream (SARS-CoV-2), use
    // the US national signal; otherwise use the most-reported text location.
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
      id: `${pathogen}-${locationIso || "global"}-${Date.now()}`,
      pathogen,
      location,
      location_country: locationIso, // ISO-A2 (map key); empty string = no single country
      p_outbreak: pFused,
      r_t_median: 1 + pFused * 0.5, // Approximate; full Rt from Python backend
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

  // Sort by outbreak probability
  alerts.sort((a, b) => b.p_outbreak - a.p_outbreak);

  return NextResponse.json({
    alerts,
    meta: {
      count: alerts.length,
      streamStatus: {
        text: promedRes.status === "fulfilled" ? "ok" : "error",
        wastewater: nwssRes.status === "fulfilled" ? "ok" : "error",
        genomic: nextstrainRes.status === "fulfilled" ? "ok" : "error",
      },
      fusionMethod: "lightweight-js",
      note: "Deploy Python backend (MOSAIC_API_URL) for full NumPyro NUTS hierarchical fusion",
      fetchedAt: new Date().toISOString(),
    },
  });
}
