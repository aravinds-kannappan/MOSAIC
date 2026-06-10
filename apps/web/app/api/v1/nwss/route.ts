/**
 * CDC NWSS Wastewater API Route
 *
 * Fetches real wastewater concentration data from the CDC National Wastewater
 * Surveillance System via the Socrata open API (no authentication required),
 * then runs Poisson-Gamma BOCPD to produce change-point alarm probabilities.
 *
 * The `2ew6-ywp6` dataset is the SARS-CoV-2 wastewater activity-level series.
 * Every row is already SARS-CoV-2, keyed by `key_plot_id` (a composite site id
 * such as `CDC_VERILY_md_2952_..._raw wastewater`) — there is NO standalone
 * pathogen column to filter on. We therefore build a national time series by
 * aggregating `percentile` (the site's current level vs. its own history)
 * across all reporting sites per `date_end`, server-side via SoQL, which keeps
 * the payload tiny and yields a dense daily series for change-point detection.
 *
 * Data source: https://data.cdc.gov/resource/2ew6-ywp6.json
 * Ref: MOSAIC paper §5.2 (Layer 2b)
 */

import { NextRequest, NextResponse } from "next/server";
import { runBOCPD, recentChangeAlarm } from "@/lib/bocpd";

const NWSS_BASE = "https://data.cdc.gov/resource/2ew6-ywp6.json";
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN ?? "";

export const revalidate = 3600; // Cache for 1 hour (NWSS updates regularly)

/** The 2ew6-ywp6 dataset only carries SARS-CoV-2. */
function isCovid(pathogen: string): boolean {
  const p = pathogen.toLowerCase().replace(/[^a-z0-9]/g, "");
  return p.includes("sarscov2") || p.includes("covid") || p === "coronavirus";
}

interface AggregateRow {
  date_end: string;
  mean_pct: string;
  mean_detect: string;
  n: string;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const state = searchParams.get("state") ?? searchParams.get("jurisdiction") ?? null;

  if (!isCovid(pathogen)) {
    return NextResponse.json({
      sites: [],
      meta: {
        pathogen,
        state,
        count: 0,
        note: "CDC NWSS dataset 2ew6-ywp6 only provides SARS-CoV-2 wastewater activity; other pathogens are covered by the genomic and text streams.",
        source: "CDC NWSS via Socrata API",
      },
    });
  }

  // Aggregate the national (or per-jurisdiction) daily series server-side.
  // `percentile` / `detect_prop_15d` are stored as text, so cast with ::number.
  const params = new URLSearchParams({
    $select:
      "date_end,avg(percentile::number) as mean_pct,avg(detect_prop_15d::number) as mean_detect,count(*) as n",
    $group: "date_end",
    $order: "date_end DESC",
    $limit: "200", // ~6 months of daily windows
  });
  if (state) params.set("$where", `wwtp_jurisdiction='${state.replace(/'/g, "''")}'`);

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (SOCRATA_APP_TOKEN) headers["X-App-Token"] = SOCRATA_APP_TOKEN;

  let raw: AggregateRow[];
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

  // Sort chronologically (oldest → newest) for time-series detection
  const series = raw
    .map((r) => ({
      date: r.date_end,
      percentile: parseFloat(r.mean_pct),
      detectProp: parseFloat(r.mean_detect),
      n: parseInt(r.n ?? "0", 10),
    }))
    .filter((r) => r.date && !isNaN(r.percentile))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (series.length < 3) {
    return NextResponse.json({
      sites: [],
      meta: { pathogen, state, count: 0, source: "CDC NWSS via Socrata API" },
    });
  }

  // Run BOCPD on the national mean percentile (0-100 → integer pseudo-counts).
  // Percentile tracks each site's level vs. its own history, so a rising
  // national mean is the wave-onset signal; detect_prop_15d saturates near 100
  // and is a poorer change-point input.
  const pseudoCounts = series.map((r) => Math.round(Math.max(0, r.percentile)));
  const bocpd = runBOCPD(pseudoCounts, { meanRunLength: 30 });

  // Each point's wastewater alarm blends two signals: an abrupt change-point
  // (BOCPD) and sustained elevation. `percentile` is each site's current level
  // vs. its own history, so a national mean above the 50th percentile already
  // indicates above-typical circulation even without an abrupt jump.
  const levelAlarm = (pct: number) => Math.min(1, Math.max(0, (pct - 50) / 40));
  const blended = series.map((r, i) =>
    1 - (1 - (bocpd.changePointProb[i] ?? 0)) * (1 - levelAlarm(r.percentile))
  );

  const latest = series[series.length - 1];
  const siteName = state ?? "United States (national average)";

  const site = {
    siteId: state ? `NWSS-${state}` : "NWSS-US-NATIONAL",
    siteName,
    state: state ?? "US",
    populationServed: 0,
    pathogen: "SARS-CoV-2",
    sitesReporting: latest.n,
    latestDate: latest.date,
    latestPercentile: latest.percentile,
    latestDetectProp: latest.detectProp,
    latestPtc15d: 0,
    /** Wastewater soft alarm: blend of recent change-point and elevation */
    changePointProb: recentChangeAlarm(blended, 14),
    timeSeries: series.map((r, i) => ({
      date: r.date,
      percentile: r.percentile,
      detectProp: r.detectProp,
      ptc15d: 0,
      changePointProb: blended[i],
    })),
  };

  return NextResponse.json({
    sites: [site],
    meta: {
      pathogen: "SARS-CoV-2",
      state,
      count: 1,
      pointCount: series.length,
      latestDate: latest.date,
      source: "CDC NWSS via Socrata API (national daily aggregate of site percentiles)",
      sourceUrl: NWSS_BASE,
      fetchedAt: new Date().toISOString(),
    },
  });
}
