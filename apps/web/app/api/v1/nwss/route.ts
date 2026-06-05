/**
 * CDC NWSS Wastewater API Route
 *
 * Fetches real wastewater concentration data from the CDC National Wastewater
 * Surveillance System via the Socrata open API (no authentication required),
 * then runs Poisson-Gamma BOCPD to produce per-site change-point alarm probabilities.
 *
 * Data source: https://data.cdc.gov/resource/2ew6-ywp6.json
 * Ref: MOSAIC paper §5.2 (Layer 2b)
 */

import { NextRequest, NextResponse } from "next/server";
import { runBOCPD } from "@/lib/bocpd";

const NWSS_BASE = "https://data.cdc.gov/resource/2ew6-ywp6.json";
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN ?? "";

export const revalidate = 3600; // Cache for 1 hour (NWSS updates weekly)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const state = searchParams.get("state") ?? null;
  const limit = parseInt(searchParams.get("limit") ?? "2000", 10);

  // Build Socrata SoQL query
  const params = new URLSearchParams({
    $limit: String(Math.min(limit, 5000)),
    $order: "date_end DESC",
    key_plot_id: pathogen,
  });

  if (state) params.set("wwtp_jurisdiction", state);

  // Fetch last ~1 year of data
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  params.set("$where", `date_end >= '${cutoff.toISOString().split("T")[0]}'`);

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (SOCRATA_APP_TOKEN) headers["X-App-Token"] = SOCRATA_APP_TOKEN;

  let raw: Record<string, string>[];
  try {
    const res = await fetch(`${NWSS_BASE}?${params}`, {
      headers,
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `CDC NWSS API returned ${res.status}: ${res.statusText}` },
        { status: res.status }
      );
    }
    raw = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach CDC NWSS: ${String(err)}` },
      { status: 502 }
    );
  }

  if (!raw.length) {
    return NextResponse.json({ sites: [], meta: { pathogen, state, count: 0 } });
  }

  // Group by site (wwtp_id)
  const bySite = new Map<string, typeof raw>();
  for (const row of raw) {
    const id = row.wwtp_id ?? row.key_plot_id ?? "unknown";
    if (!bySite.has(id)) bySite.set(id, []);
    bySite.get(id)!.push(row);
  }

  const sites = [];

  for (const [siteId, rows] of bySite) {
    // Sort chronologically
    rows.sort((a, b) =>
      new Date(a.date_end ?? "").getTime() - new Date(b.date_end ?? "").getTime()
    );

    // Extract concentration time series.
    // The NWSS dataset uses 'detect_prop_15d' (detection proportion) and
    // 'percentile' (national percentile) as the primary signal metrics.
    // We use percentile/100 as a normalised 0-1 concentration proxy for BOCPD.
    const timeSeries = rows
      .map((r) => ({
        date: r.date_end ?? r.date_start ?? "",
        percentile: parseFloat(r.percentile ?? "0"),
        detectProp: parseFloat(r.detect_prop_15d ?? "0"),
        ptc15d: parseFloat(r.ptc_15d ?? "0"),
      }))
      .filter((r) => r.date && !isNaN(r.percentile));

    if (timeSeries.length < 3) continue;

    // Run BOCPD on detection proportion counts (scaled to integer-like counts)
    // We discretise detect_prop_15d * 100 to pseudo-counts for the Poisson model
    const pseudoCounts = timeSeries.map((r) =>
      Math.round(Math.max(0, r.detectProp * 100))
    );
    const bocpdResult = runBOCPD(pseudoCounts, { meanRunLength: 12 }); // 12-week mean

    const firstRow = rows[0];
    sites.push({
      siteId,
      siteName: firstRow.wwtp_jurisdiction ?? siteId,
      state: firstRow.wwtp_jurisdiction ?? firstRow.reporting_jurisdiction ?? "",
      populationServed: parseInt(firstRow.population_served ?? "0", 10),
      pathogen,
      latestDate: timeSeries[timeSeries.length - 1].date,
      latestPercentile: timeSeries[timeSeries.length - 1].percentile,
      latestDetectProp: timeSeries[timeSeries.length - 1].detectProp,
      latestPtc15d: timeSeries[timeSeries.length - 1].ptc15d,
      /** P(change-point ≤ t) — wastewater soft alarm probability */
      changePointProb: bocpdResult.changePointProb[bocpdResult.changePointProb.length - 1] ?? 0,
      timeSeries: timeSeries.map((r, i) => ({
        date: r.date,
        percentile: r.percentile,
        detectProp: r.detectProp,
        ptc15d: r.ptc15d,
        changePointProb: bocpdResult.changePointProb[i] ?? 0,
      })),
    });
  }

  // Sort by change-point probability descending
  sites.sort((a, b) => b.changePointProb - a.changePointProb);

  return NextResponse.json({
    sites,
    meta: {
      pathogen,
      state,
      count: sites.length,
      source: "CDC NWSS via Socrata API",
      sourceUrl: "https://data.cdc.gov/resource/2ew6-ywp6.json",
      fetchedAt: new Date().toISOString(),
    },
  });
}
