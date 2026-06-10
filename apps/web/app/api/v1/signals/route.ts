/**
 * Signal Explorer API Route
 *
 * Returns the full per-stream time series for a given pathogen-location pair.
 * Streams are computed in-process (lib/streams) rather than self-fetched over
 * HTTP, so it works identically locally and on Vercel.
 *
 * The plotted window is anchored to the most recent data actually available
 * across the streams (which can lag wall-clock time, e.g. the CDC NWSS series
 * currently ends in late 2025), so the chart always shows real signal instead
 * of an empty "last 90 days from today" window.
 */

import { NextRequest, NextResponse } from "next/server";
import { type SerialInterval, estimateRt, SERIAL_INTERVALS } from "@/lib/rt-estimation";
import { fetchWastewater, fetchGenomic, fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

interface StreamEntry {
  pText: number;
  pWastewater: number;
  pGenomic: number;
}

interface ForecastPoint {
  date: string;
  p_outbreak: number;
  p_outbreak_lower: number;
  p_outbreak_upper: number;
  forecast: true;
}

const median = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const logit = (p: number) => {
  const c = Math.min(Math.max(p, 0.01), 0.99);
  return Math.log(c / (1 - c));
};
const invLogit = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Damped-trend forecast of the fused P(R_t>1) in logit space.
 *
 * The recent drift is extrapolated with geometric damping (Gardner & McKenzie
 * 1985) so the projection mean-reverts rather than running away, and the 95%
 * band widens as √h with the residual volatility of recent first differences.
 */
function forecastSeries(
  points: Array<{ date: string; p: number }>,
  horizon: number,
  stepDays: number
): ForecastPoint[] {
  if (points.length < 4) return [];
  const k = Math.min(8, points.length);
  const recent = points.slice(-k).map((d) => logit(d.p));
  const diffs: number[] = [];
  for (let i = 1; i < recent.length; i++) diffs.push(recent[i] - recent[i - 1]);
  const drift = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const resid = diffs.map((d) => d - drift);
  const sd = Math.sqrt(
    Math.max(resid.reduce((a, b) => a + b * b, 0) / Math.max(1, resid.length - 1), 0.02)
  );

  const last = recent[recent.length - 1];
  const lastDay = Math.floor(new Date(`${points[points.length - 1].date}T00:00:00Z`).getTime() / DAY_MS);
  const damp = 0.8;
  const out: ForecastPoint[] = [];
  let driftSum = 0;
  for (let h = 1; h <= horizon; h++) {
    driftSum += Math.pow(damp, h - 1);
    const mean = last + drift * driftSum;
    const se = sd * Math.sqrt(h);
    const date = new Date((lastDay + h * stepDays) * DAY_MS).toISOString().split("T")[0];
    out.push({
      date,
      p_outbreak: invLogit(mean),
      p_outbreak_lower: invLogit(mean - 1.96 * se),
      p_outbreak_upper: invLogit(mean + 1.96 * se),
      forecast: true,
    });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const location = searchParams.get("location") ?? "US";
  const range = searchParams.get("range") ?? "recent"; // "recent" (1y) | "all"
  const withForecast = searchParams.get("forecast") !== "0";

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

  // Text alarm series: a continuous report-intensity curve. Each WHO/ProMED
  // report deposits weight that decays exponentially (half-life ~21 d), and the
  // accumulated intensity is mapped to a probability by a saturating link. This
  // is visible and interpretable for sparsely-reported pathogens (mpox, H5N1),
  // unlike the raw instantaneous change-point probability which sits at the
  // hazard floor between reports.
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
      // Run the decay to the latest data across all streams, so the curve reaches
      // "now" and gently declines rather than cutting to zero after the last report.
      const dayOf = (s: string) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / DAY_MS);
      const otherDates = Array.from(dateMap.keys());
      const maxOther = otherDates.length ? Math.max(...otherDates.map(dayOf)) : 0;
      const endDay = Math.max(dayOf(dates[dates.length - 1]), maxOther);
      const series = new Array<number>(endDay - startDay + 1).fill(0);
      for (const [d, c] of Object.entries(counts)) {
        const idx = Math.floor(new Date(`${d}T00:00:00Z`).getTime() / DAY_MS) - startDay;
        if (idx >= 0 && idx < series.length) series[idx] += c;
      }
      const decay = Math.exp(-1 / 21); // 21-day half-life-ish kernel
      const scale = 1.5;
      let intensity = 0;
      for (let i = 0; i < series.length; i++) {
        intensity = intensity * decay + series[i];
        const pText = 1 - Math.exp(-intensity / scale);
        const d = new Date((startDay + i) * DAY_MS).toISOString().split("T")[0];
        touch(d).pText = pText;
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
  const earliestData = new Date(`${sortedDates[0]}T00:00:00Z`);
  const dateTo = searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : latestData;
  const dateFrom = searchParams.get("dateFrom")
    ? new Date(searchParams.get("dateFrom")!)
    : range === "all"
      ? earliestData
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

  // Forward forecast of the fused P(R_t>1), in the cadence of the recent points.
  let forecast: ForecastPoint[] = [];
  if (withForecast && signals.length >= 4) {
    const recentPts = signals.slice(-12).map((s) => ({ date: s.date, p: s.p_outbreak }));
    const days = recentPts.map((p) => Math.floor(new Date(`${p.date}T00:00:00Z`).getTime() / DAY_MS));
    const gaps: number[] = [];
    for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
    const stepDays = Math.max(1, Math.round(median(gaps) || 14));
    forecast = forecastSeries(recentPts, 6, stepDays);
  }

  return NextResponse.json({
    pathogen,
    location,
    date_range: [dateFrom.toISOString().split("T")[0], dateTo.toISOString().split("T")[0]],
    signals,
    forecast,
    meta: {
      pointCount: signals.length,
      latestDataDate: sortedDates[sortedDates.length - 1],
      range,
      forecastHorizon: forecast.length,
      fusionMethod: "lightweight-js",
      rtMethod: "EpiEstim-sliding-window",
      fetchedAt: new Date().toISOString(),
    },
  });
}
