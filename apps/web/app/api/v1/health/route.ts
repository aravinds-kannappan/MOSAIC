/**
 * Health / data-freshness endpoint.
 *
 * Reports the reachability and latest available data date for each surveillance
 * stream, so deployment monitoring can tell at a glance whether the dashboard is
 * showing live data. Computed in-process via lib/streams (no self-fetch).
 */

import { NextResponse } from "next/server";
import { fetchWastewater, fetchGenomic, fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET() {
  const [ww, gen, text] = await Promise.allSettled([
    fetchWastewater({ pathogen: "SARS-CoV-2" }),
    fetchGenomic("sars-cov-2"),
    fetchText(),
  ]);

  const wastewater = {
    status: ww.status === "fulfilled" ? "ok" : "error",
    latestDate: ww.status === "fulfilled" ? ww.value.sites[0]?.latestDate ?? null : null,
    points: ww.status === "fulfilled" ? (ww.value.meta.pointCount as number) ?? 0 : 0,
    error: ww.status === "rejected" ? String(ww.reason) : undefined,
  };
  const genomic = {
    status: gen.status === "fulfilled" ? "ok" : "error",
    latestDate: gen.status === "fulfilled" ? gen.value.latestDate : null,
    lineages: gen.status === "fulfilled" ? (gen.value.meta.numLineages as number) ?? 0 : 0,
    error: gen.status === "rejected" ? String(gen.reason) : undefined,
  };
  const textStream = {
    status: text.status === "fulfilled" ? "ok" : "error",
    events: text.status === "fulfilled" ? text.value.events.length : 0,
    latestDate:
      text.status === "fulfilled"
        ? text.value.events[0]?.pubDate?.split("T")[0] ?? null
        : null,
    error: text.status === "rejected" ? String(text.reason) : undefined,
  };

  const allOk = [wastewater, genomic, textStream].every((s) => s.status === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      streams: { text: textStream, wastewater, genomic },
      checkedAt: new Date().toISOString(),
    },
    { status: allOk ? 200 : 207 }
  );
}
