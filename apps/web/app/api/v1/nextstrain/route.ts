/**
 * Nextstrain Genomic Anomaly API Route
 *
 * Fetches lineage frequency distributions from Nextstrain's open API,
 * then computes JSD-based genomic anomaly scores per MOSAIC Layer 2c.
 *
 * Data sources:
 *   - SARS-CoV-2: https://data.nextstrain.org/files/ncov/open/global/6m/tip-frequencies.json
 *   - H5N1 (A/H5): https://data.nextstrain.org/files/workflows/avian-flu/h5n1/ha/tip-frequencies.json
 *   - Mpox: https://data.nextstrain.org/files/workflows/mpox/clade-iib/tip-frequencies.json
 *
 * Ref: MOSAIC paper §5.3; Hadfield et al. (2018) Bioinformatics 34(23), 4121–4123.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  computeGenomicAnomalyScores,
  type LineageSnapshot,
} from "@/lib/kl-divergence";

export const revalidate = 7200; // Nextstrain updates as sequences are deposited

/** Nextstrain tip-frequencies dataset URLs by pathogen slug */
const NEXTSTRAIN_URLS: Record<string, string> = {
  "sars-cov-2":
    "https://data.nextstrain.org/files/ncov/open/global/6m/tip-frequencies.json",
  "h5n1":
    "https://data.nextstrain.org/files/workflows/avian-flu/h5n1/ha/tip-frequencies.json",
  "mpox":
    "https://data.nextstrain.org/files/workflows/mpox/clade-iib/tip-frequencies.json",
  "influenza-h3n2":
    "https://data.nextstrain.org/files/workflows/seasonal-flu/h3n2/ha/2y/tip-frequencies.json",
  "influenza-h1n1":
    "https://data.nextstrain.org/files/workflows/seasonal-flu/h1n1pdm/ha/2y/tip-frequencies.json",
};

interface NextstrainFreqData {
  pivots: number[]; // decimal year timepoints
  frequencies: Record<string, number[]>; // clade → freq at each pivot
  generated_by?: { version: string };
}

/** Convert decimal year to ISO date string */
function decimalYearToDate(dy: number): string {
  const year = Math.floor(dy);
  const dayOfYear = Math.round((dy - year) * 365.25);
  const date = new Date(year, 0, 1);
  date.setDate(date.getDate() + dayOfYear);
  return date.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogenParam = (searchParams.get("pathogen") ?? "sars-cov-2").toLowerCase();

  const url = NEXTSTRAIN_URLS[pathogenParam];
  if (!url) {
    return NextResponse.json(
      {
        error: `Unknown pathogen '${pathogenParam}'. Available: ${Object.keys(NEXTSTRAIN_URLS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  let data: NextstrainFreqData;
  try {
    const res = await fetch(url, { next: { revalidate: 7200 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Nextstrain API returned ${res.status} for ${pathogenParam}` },
        { status: res.status }
      );
    }
    data = await res.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach Nextstrain: ${String(err)}` },
      { status: 502 }
    );
  }

  const { pivots, frequencies } = data;
  if (!pivots?.length || !frequencies) {
    return NextResponse.json(
      { error: "Unexpected Nextstrain response format" },
      { status: 502 }
    );
  }

  // Build lineage snapshots: one per pivot point (14-day windows are implicit
  // in how Nextstrain smooths frequencies across the pivot series)
  const snapshots: LineageSnapshot[] = pivots.map((pivot, i) => {
    const freqAtPivot: Record<string, number> = {};
    for (const [clade, freqs] of Object.entries(frequencies)) {
      freqAtPivot[clade] = freqs[i] ?? 0;
    }
    return {
      date: decimalYearToDate(pivot),
      frequencies: freqAtPivot,
    };
  });

  // Compute JSD anomaly scores
  const anomalyScores = computeGenomicAnomalyScores(snapshots, 90);

  // Summary of current state
  const latest = anomalyScores[anomalyScores.length - 1];
  const latestSnapshot = snapshots[snapshots.length - 1];

  // Top circulating lineages at latest timepoint
  const topLineages = Object.entries(latestSnapshot.frequencies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, freq]) => ({ name, frequency: freq }));

  return NextResponse.json({
    pathogen: pathogenParam,
    latestDate: latest?.date ?? snapshots[snapshots.length - 1]?.date,
    latestJsd: latest?.jsd ?? 0,
    genomicAlarmProb: latest?.alarmProb ?? 0,
    topShiftingLineages: latest?.topShiftingLineages ?? [],
    topCirculatingLineages: topLineages,
    anomalyTimeSeries: anomalyScores.map((s) => ({
      date: s.date,
      jsd: s.jsd,
      alarmProb: s.alarmProb,
    })),
    meta: {
      pathogen: pathogenParam,
      numPivots: pivots.length,
      numLineages: Object.keys(frequencies).length,
      source: "Nextstrain open data",
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
    },
  });
}
