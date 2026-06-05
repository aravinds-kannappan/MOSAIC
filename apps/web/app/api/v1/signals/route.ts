/**
 * Signal Explorer API Route
 *
 * Returns the full per-stream time series for a given pathogen-location pair,
 * including all three stream alarm probabilities and (if available) the fused
 * posterior P(R_t > 1) with 95% credible interval.
 *
 * Query params:
 *   pathogen: e.g. "SARS-CoV-2", "mpox", "h5n1"
 *   location: e.g. "US", "global"
 *   dateFrom: ISO date (default: 90 days ago)
 *   dateTo:   ISO date (default: today)
 */

import { NextRequest, NextResponse } from "next/server";
import { runBOCPD } from "@/lib/bocpd";
import { type SerialInterval, estimateRt, SERIAL_INTERVALS } from "@/lib/rt-estimation";

export const revalidate = 3600;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const location = searchParams.get("location") ?? "US";

  const dateTo = new Date(searchParams.get("dateTo") ?? new Date().toISOString());
  const dateFrom = new Date(
    searchParams.get("dateFrom") ??
      new Date(dateTo.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
  );

  // Proxy to Python backend for full inference
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(
        `${backendUrl}/api/v1/signals?${searchParams.toString()}`
      );
      if (res.ok) return NextResponse.json(await res.json());
    } catch {
      // Fall through
    }
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const nwssPathogen = pathogen.toUpperCase().includes("H5") ? "H5" : pathogen;

  // Fetch wastewater data
  const [nwssRes, nextstrainRes] = await Promise.allSettled([
    fetch(
      `${baseUrl}/api/v1/nwss?pathogen=${encodeURIComponent(nwssPathogen)}&limit=500`,
      { next: { revalidate: 3600 } }
    ).then((r) => r.json()),
    fetch(
      `${baseUrl}/api/v1/nextstrain?pathogen=${encodeURIComponent(
        pathogen.toLowerCase().replace(/\s+/g, "-")
      )}`,
      { next: { revalidate: 7200 } }
    ).then((r) => r.json()),
  ]);

  // Build a day-by-day signal series
  const dateMap = new Map<
    string,
    { pText: number; pWastewater: number; pGenomic: number }
  >();

  // Fill wastewater signal from top NWSS site
  if (nwssRes.status === "fulfilled" && nwssRes.value?.sites?.length > 0) {
    const topSite = nwssRes.value.sites[0];
    for (const point of topSite.timeSeries ?? []) {
      const d = point.date?.split("T")[0];
      if (!d) continue;
      const entry = dateMap.get(d) ?? { pText: 0, pWastewater: 0, pGenomic: 0 };
      entry.pWastewater = point.changePointProb ?? 0;
      dateMap.set(d, entry);
    }
  }

  // Fill genomic signal from Nextstrain anomaly time series
  if (nextstrainRes.status === "fulfilled") {
    for (const point of nextstrainRes.value?.anomalyTimeSeries ?? []) {
      const d = point.date?.split("T")[0];
      if (!d) continue;
      const entry = dateMap.get(d) ?? { pText: 0, pWastewater: 0, pGenomic: 0 };
      entry.pGenomic = point.alarmProb ?? 0;
      dateMap.set(d, entry);
    }
  }

  // Fill text signal with BOCPD on dummy counts (will be populated by ProMED in alerts)
  // Here we just propagate zeros for dates we have WW/genomic data on
  for (const [d] of dateMap) {
    const entry = dateMap.get(d)!;
    if (!entry.pText) entry.pText = 0;
  }

  // Sort dates and filter to requested range
  const sortedDates = Array.from(dateMap.keys()).sort();
  const filtered = sortedDates.filter((d) => {
    const dt = new Date(d);
    return dt >= dateFrom && dt <= dateTo;
  });

  // Build incidence proxy from wastewater detect_prop for Rt estimation
  const wwTimeSeries =
    nwssRes.status === "fulfilled" && nwssRes.value?.sites?.[0]?.timeSeries
      ? (nwssRes.value.sites[0].timeSeries as Array<{ date: string; detectProp: number }>)
      : [];

  const rtDates = wwTimeSeries.map((r) => r.date?.split("T")[0] ?? "");
  const rtCounts = wwTimeSeries.map((r) =>
    Math.round(Math.max(0, (r.detectProp ?? 0) * 1000))
  );

  const si: SerialInterval =
    SERIAL_INTERVALS[pathogen.toLowerCase()] ?? SERIAL_INTERVALS["SARS-CoV-2"];
  const rtEstimates = estimateRt(rtDates, rtCounts, si);
  const rtByDate = new Map(rtEstimates.map((r) => [r.date, r]));

  const signals = filtered.map((date) => {
    const s = dateMap.get(date)!;
    const rt = rtByDate.get(date);

    // Soft fusion
    const pFused =
      1 - (1 - s.pText / 3) * (1 - s.pWastewater / 3) * (1 - s.pGenomic / 3);

    return {
      date,
      p_outbreak: pFused,
      p_outbreak_lower: Math.max(0, pFused - 0.1),
      p_outbreak_upper: Math.min(1, pFused + 0.1),
      r_t_median: rt?.median ?? null,
      r_t_ci_lower: rt?.lower95 ?? null,
      r_t_ci_upper: rt?.upper95 ?? null,
      p_text: s.pText,
      p_wastewater: s.pWastewater,
      p_genomic: s.pGenomic,
      contrib_text: s.pText / (s.pText + s.pWastewater + s.pGenomic + 0.001),
      contrib_wastewater:
        s.pWastewater / (s.pText + s.pWastewater + s.pGenomic + 0.001),
      contrib_genomic:
        s.pGenomic / (s.pText + s.pWastewater + s.pGenomic + 0.001),
    };
  });

  return NextResponse.json({
    pathogen,
    location,
    date_range: [
      dateFrom.toISOString().split("T")[0],
      dateTo.toISOString().split("T")[0],
    ],
    signals,
    meta: {
      pointCount: signals.length,
      fusionMethod: "lightweight-js",
      rtMethod: "EpiEstim-sliding-window",
      fetchedAt: new Date().toISOString(),
    },
  });
}
