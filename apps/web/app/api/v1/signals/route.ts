/**
 * Signal Explorer API Route
 *
 * Returns the full per-stream time series for a given pathogen-location pair.
 * Streams are computed in-process (lib/streams) rather than self-fetched over
 * HTTP, so it works identically locally and on Vercel.
 *
 * The plotted window is anchored to the most recent data actually available
 * across the streams (which can lag wall-clock time — e.g. the CDC NWSS series
 * currently ends in late 2025), so the chart always shows real signal instead
 * of an empty "last 90 days from today" window.
 */

import { NextRequest, NextResponse } from "next/server";
import { runBOCPD } from "@/lib/bocpd";
import { type SerialInterval, estimateRt, SERIAL_INTERVALS } from "@/lib/rt-estimation";
import { fetchWastewater, fetchGenomic, fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface StreamEntry {
  pText: number;
  pWastewater: number;
  pGenomic: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const location = searchParams.get("location") ?? "US";

  // Proxy to Python backend for full inference
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/signals?${searchParams.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return NextResponse.json(await res.json());
    } catch {
      // Fall through
    }
  }

  const [wwRes, genRes, textRes] = await Promise.allSettled([
    fetchWastewater({ pathogen }),
    fetchGenomic(pathogen),
    fetchText(),
  ]);

  const dateMap = new Map<string, StreamEntry>();
  const touch = (d: string): StreamEntry => {
    let e = dateMap.get(d);
    if (!e) {
      e = { pText: 0, pWastewater: 0, pGenomic: 0 };
      dateMap.set(d, e);
    }
    return e;
  };

  // Wastewater alarm series (national)
  const wwTimeSeries =
    wwRes.status === "fulfilled" ? wwRes.value.sites?.[0]?.timeSeries ?? [] : [];
  for (const point of wwTimeSeries) {
    const d = point.date?.split("T")[0];
    if (d) touch(d).pWastewater = point.changePointProb ?? 0;
  }

  // Genomic anomaly series
  if (genRes.status === "fulfilled") {
    for (const point of genRes.value.anomalyTimeSeries ?? []) {
      const d = point.date?.split("T")[0];
      if (d) touch(d).pGenomic = point.alarmProb ?? 0;
    }
  }

  // Text alarm series: instantaneous BOCPD change-point probability on the dense
  // daily ProMED/WHO event-count series for this pathogen.
  if (textRes.status === "fulfilled") {
    const countsByPathogen = textRes.value.countsByPathogen;
    const key =
      pathogen in countsByPathogen
        ? pathogen
        : Object.keys(countsByPathogen).find((k) => k.toLowerCase() === pathogen.toLowerCase());
    const counts = key ? countsByPathogen[key] : {};
    const dates = Object.keys(counts).sort();
    if (dates.length) {
      const startDay = Math.floor(new Date(`${dates[0]}T00:00:00Z`).getTime() / DAY_MS);
      const endDay = Math.floor(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime() / DAY_MS);
      const series = new Array<number>(endDay - startDay + 1).fill(0);
      for (const [d, c] of Object.entries(counts)) {
        const idx = Math.floor(new Date(`${d}T00:00:00Z`).getTime() / DAY_MS) - startDay;
        if (idx >= 0 && idx < series.length) series[idx] += c;
      }
      if (series.length >= 3) {
        const cp = runBOCPD(series, { meanRunLength: 30 }).changePointProb;
        for (let i = 0; i < series.length; i++) {
          const d = new Date((startDay + i) * DAY_MS).toISOString().split("T")[0];
          touch(d).pText = cp[i] ?? 0;
        }
      }
    }
  }

  // Anchor the window to the latest available data (not wall-clock now).
  const sortedDates = Array.from(dateMap.keys()).sort();
  if (sortedDates.length === 0) {
    return NextResponse.json({
      pathogen,
      location,
      date_range: [null, null],
      signals: [],
      meta: { pointCount: 0, fusionMethod: "lightweight-js", fetchedAt: new Date().toISOString() },
    });
  }

  const latestData = new Date(`${sortedDates[sortedDates.length - 1]}T00:00:00Z`);
  const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : latestData;
  const dateFrom = searchParams.get("dateFrom")
    ? new Date(searchParams.get("dateFrom")!)
    : new Date(dateTo.getTime() - 365 * DAY_MS);

  const filtered = sortedDates.filter((d) => {
    const dt = new Date(`${d}T00:00:00Z`);
    return dt >= dateFrom && dt <= dateTo;
  });

  // Rt estimation from the wastewater incidence proxy
  const rtDates = wwTimeSeries.map((r) => r.date?.split("T")[0] ?? "");
  const rtCounts = wwTimeSeries.map((r) => Math.round(Math.max(0, (r.detectProp ?? 0) * 10)));
  const si: SerialInterval =
    SERIAL_INTERVALS[pathogen] ?? SERIAL_INTERVALS[pathogen.toLowerCase()] ?? SERIAL_INTERVALS["SARS-CoV-2"];
  const rtEstimates = estimateRt(rtDates, rtCounts, si);
  const rtByDate = new Map(rtEstimates.map((r) => [r.date, r]));

  const signals = filtered.map((date) => {
    const s = dateMap.get(date)!;
    const rt = rtByDate.get(date);
    const present = [s.pText > 0, s.pWastewater > 0, s.pGenomic > 0].filter(Boolean).length || 3;
    const w = 1 / present;
    const pFused = 1 - (1 - w * s.pText) * (1 - w * s.pWastewater) * (1 - w * s.pGenomic);
    const denom = s.pText + s.pWastewater + s.pGenomic + 1e-3;

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
      contrib_text: s.pText / denom,
      contrib_wastewater: s.pWastewater / denom,
      contrib_genomic: s.pGenomic / denom,
    };
  });

  return NextResponse.json({
    pathogen,
    location,
    date_range: [dateFrom.toISOString().split("T")[0], dateTo.toISOString().split("T")[0]],
    signals,
    meta: {
      pointCount: signals.length,
      latestDataDate: sortedDates[sortedDates.length - 1],
      fusionMethod: "lightweight-js",
      rtMethod: "EpiEstim-sliding-window",
      fetchedAt: new Date().toISOString(),
    },
  });
}
