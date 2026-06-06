/**
 * MOSAIC outbreak posterior endpoint.
 *
 * Implements the paper's public API shape:
 *   GET /api/v1/outbreak-probability?pathogen=SARS-CoV-2&location=US&date=2026-04-22
 *
 * When MOSAIC_API_URL is configured, this proxies to the Python NumPyro backend.
 * Otherwise it derives a lightweight posterior from the live alert stream.
 */

import { NextRequest, NextResponse } from "next/server";
import type { ActiveAlert, AlertLevel } from "@/lib/types";

export const revalidate = 900;

function alertLevel(p: number): AlertLevel {
  if (p >= 0.85) return "CRITICAL";
  if (p >= 0.70) return "HIGH";
  if (p >= 0.40) return "MODERATE";
  return "LOW";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const location = searchParams.get("location") ?? "US";
  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/outbreak-probability?${searchParams.toString()}`, {
        next: { revalidate: 900 },
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to the Vercel-safe live-data route.
    }
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : new URL(req.url).origin;

  const alertsRes = await fetch(`${baseUrl}/api/v1/alerts`, {
    next: { revalidate: 900 },
  });
  const alertsData = await alertsRes.json();
  const alerts = (alertsData.alerts ?? []) as ActiveAlert[];

  const matched =
    alerts.find(
      (alert) =>
        alert.pathogen.toLowerCase() === pathogen.toLowerCase() &&
        [alert.location, alert.location_country].some(
          (value) => value.toLowerCase() === location.toLowerCase()
        )
    ) ??
    alerts.find((alert) => alert.pathogen.toLowerCase() === pathogen.toLowerCase());

  if (matched) {
    return NextResponse.json({
      pathogen: matched.pathogen,
      location: matched.location_country || matched.location,
      date,
      r_t_median: matched.r_t_median,
      r_t_ci_lower: matched.r_t_ci_lower,
      r_t_ci_upper: matched.r_t_ci_upper,
      p_outbreak: matched.p_outbreak,
      alert_level: matched.alert_level,
      stream_contributions: matched.stream_contributions,
      last_updated: matched.last_updated,
      source_links: matched.source_links,
      inference_method: alertsData.meta?.fusionMethod ?? "lightweight-js",
    });
  }

  return NextResponse.json({
    pathogen,
    location,
    date,
    r_t_median: 1.0,
    r_t_ci_lower: 0.8,
    r_t_ci_upper: 1.2,
    p_outbreak: 0,
    alert_level: alertLevel(0),
    stream_contributions: {
      text_stream: 0,
      wastewater_stream: 0,
      genomic_stream: 0,
    },
    last_updated: new Date().toISOString(),
    source_links: {},
    inference_method: "lightweight-js",
    note: "No active live-data alert matched this pathogen/location.",
  });
}
