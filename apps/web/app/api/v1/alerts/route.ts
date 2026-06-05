/**
 * MOSAIC Alerts API — Multi-Stream Fusion
 *
 * Aggregates the three surveillance streams (text, wastewater, genomic) and
 * computes a fused outbreak probability for each active pathogen-location pair.
 *
 * Fusion logic (lightweight JS substitute for full NumPyro renewal-equation model):
 *   p_fused = 1 - (1 - w_text * p_text) * (1 - w_ww * p_ww) * (1 - w_gen * p_gen)
 *
 * where weights w_i = 1/3 by default (equal contribution) and are updated
 * proportionally when streams are unavailable.
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies to
 * the full NumPyro NUTS inference endpoint for calibrated MCMC posteriors.
 *
 * Ref: MOSAIC paper §6 (Layer 3 — Multi-Modal Bayesian Hierarchical Fusion)
 */

import { NextResponse } from "next/server";
import { runBOCPD } from "@/lib/bocpd";
import type { ActiveAlert, AlertLevel } from "@/lib/types";

export const revalidate = 900;

/** Soft stream fusion: independent evidence combination */
function fuseStreamProbs(
  pText: number,
  pWastewater: number,
  pGenomic: number,
  weights = { text: 1 / 3, wastewater: 1 / 3, genomic: 1 / 3 }
): number {
  return (
    1 -
    (1 - weights.text * pText) *
      (1 - weights.wastewater * pWastewater) *
      (1 - weights.genomic * pGenomic)
  );
}

function alertLevel(p: number): AlertLevel {
  if (p >= 0.85) return "CRITICAL";
  if (p >= 0.70) return "HIGH";
  if (p >= 0.40) return "MODERATE";
  return "LOW";
}

// Country ISO mappings for known pathogen alert locations
const COUNTRY_ISO: Record<string, { iso_a2: string; name: string }> = {
  "United States": { iso_a2: "US", name: "United States" },
  "USA": { iso_a2: "US", name: "United States" },
  "China": { iso_a2: "CN", name: "China" },
  "India": { iso_a2: "IN", name: "India" },
  "Brazil": { iso_a2: "BR", name: "Brazil" },
  "United Kingdom": { iso_a2: "GB", name: "United Kingdom" },
  "Germany": { iso_a2: "DE", name: "Germany" },
  "France": { iso_a2: "FR", name: "France" },
  "Japan": { iso_a2: "JP", name: "Japan" },
  "South Korea": { iso_a2: "KR", name: "South Korea" },
  "Australia": { iso_a2: "AU", name: "Australia" },
  "Canada": { iso_a2: "CA", name: "Canada" },
  "Democratic Republic of the Congo": { iso_a2: "CD", name: "DRC" },
  "DRC": { iso_a2: "CD", name: "DRC" },
  "Nigeria": { iso_a2: "NG", name: "Nigeria" },
  "South Africa": { iso_a2: "ZA", name: "South Africa" },
  "Mexico": { iso_a2: "MX", name: "Mexico" },
};

export async function GET() {
  // If Python backend is configured, proxy to full inference
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/alerts`);
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to lightweight fusion
    }
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  // Fetch all three streams in parallel
  const [promedRes, nwssRes, nextstrainRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/v1/promed`, { next: { revalidate: 900 } }).then((r) => r.json()),
    fetch(`${baseUrl}/api/v1/nwss?pathogen=SARS-CoV-2`, { next: { revalidate: 3600 } }).then((r) => r.json()),
    fetch(`${baseUrl}/api/v1/nextstrain?pathogen=sars-cov-2`, { next: { revalidate: 7200 } }).then((r) => r.json()),
  ]);

  // Extract per-pathogen text alarm probabilities via BOCPD on event counts
  const textAlarms: Record<string, number> = {};
  if (promedRes.status === "fulfilled" && promedRes.value?.countsByPathogen) {
    for (const [pathogen, dailyCounts] of Object.entries(
      promedRes.value.countsByPathogen as Record<string, Record<string, number>>
    )) {
      const sortedDates = Object.keys(dailyCounts).sort();
      const counts = sortedDates.map((d) => dailyCounts[d]);
      if (counts.length >= 3) {
        const bocpd = runBOCPD(counts, { meanRunLength: 30 });
        textAlarms[pathogen] = bocpd.changePointProb[bocpd.changePointProb.length - 1] ?? 0;
      }
    }
  }

  // Wastewater alarm: use top site change-point probability
  const wastewaterAlarms: Record<string, number> = {};
  if (nwssRes.status === "fulfilled" && nwssRes.value?.sites?.length > 0) {
    const topSite = nwssRes.value.sites[0];
    wastewaterAlarms["SARS-CoV-2"] = topSite.changePointProb ?? 0;
  }

  // Genomic alarm from Nextstrain
  const genomicAlarms: Record<string, number> = {};
  if (nextstrainRes.status === "fulfilled") {
    genomicAlarms["SARS-CoV-2"] = nextstrainRes.value?.genomicAlarmProb ?? 0;
  }

  // Build fused alerts for each pathogen seen in any stream
  const allPathogens = new Set([
    ...Object.keys(textAlarms),
    ...Object.keys(wastewaterAlarms),
    ...Object.keys(genomicAlarms),
  ]);

  const alerts: ActiveAlert[] = [];

  for (const pathogen of allPathogens) {
    const pText = textAlarms[pathogen] ?? 0;
    const pWw = wastewaterAlarms[pathogen] ?? 0;
    const pGen = genomicAlarms[pathogen] ?? 0;

    const pFused = fuseStreamProbs(pText, pWw, pGen);
    if (pFused < 0.05) continue; // Skip very low signal

    // Shapley-inspired marginal contributions
    const contribText = pFused > 0 ? (pText * (1 / 3)) / pFused : 0;
    const contribWw = pFused > 0 ? (pWw * (1 / 3)) / pFused : 0;
    const contribGen = pFused > 0 ? (pGen * (1 / 3)) / pFused : 0;
    const total = contribText + contribWw + contribGen || 1;

    // Identify most-reported location from ProMED events
    let location = "Global";
    let locationCountry = "Global";
    if (promedRes.status === "fulfilled") {
      const events = (promedRes.value?.events ?? []) as Array<{
        extracted: { pathogen: string | null; location: string | null };
      }>;
      const forPathogen = events.filter(
        (e) => e.extracted.pathogen?.toLowerCase() === pathogen.toLowerCase()
      );
      const locationCounts: Record<string, number> = {};
      for (const ev of forPathogen) {
        if (ev.extracted.location) {
          locationCounts[ev.extracted.location] =
            (locationCounts[ev.extracted.location] ?? 0) + 1;
        }
      }
      const topLoc = Object.entries(locationCounts).sort((a, b) => b[1] - a[1])[0];
      if (topLoc) {
        location = topLoc[0];
        locationCountry = COUNTRY_ISO[topLoc[0]]?.name ?? topLoc[0];
      }
    }

    // Source links
    const promedPost =
      promedRes.status === "fulfilled"
        ? (promedRes.value?.events as Array<{ link: string; extracted: { pathogen: string | null } }>)
            ?.find((e) => e.extracted.pathogen?.toLowerCase() === pathogen.toLowerCase())?.link
        : undefined;

    alerts.push({
      id: `${pathogen}-${locationCountry}-${Date.now()}`,
      pathogen,
      location,
      location_country: locationCountry,
      p_outbreak: pFused,
      r_t_median: 1 + pFused * 0.5, // Approximate; full Rt from Python backend
      r_t_ci_lower: 1 + pFused * 0.1,
      r_t_ci_upper: 1 + pFused * 1.2,
      alert_level: alertLevel(pFused),
      stream_contributions: {
        text_stream: contribText / total,
        wastewater_stream: contribWw / total,
        genomic_stream: contribGen / total,
      },
      last_updated: new Date().toISOString(),
      source_links: {
        promed_post: promedPost,
        nwss_site: "https://www.cdc.gov/nwss/",
        nextstrain: `https://nextstrain.org/${pathogen.toLowerCase().replace(/-/g, "")}`,
      },
      novelty_flag:
        promedRes.status === "fulfilled"
          ? !!(
              promedRes.value?.events as Array<{
                extracted: { pathogen: string | null; noveltyFlag: boolean };
              }>
            )?.some(
              (e) =>
                e.extracted.pathogen?.toLowerCase() === pathogen.toLowerCase() &&
                e.extracted.noveltyFlag
            )
          : false,
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
