/**
 * Nextstrain Genomic Anomaly API Route
 *
 * Fetches lineage distributions from Nextstrain's open API, then computes
 * JSD-based genomic anomaly scores per MOSAIC Layer 2c.
 *
 * Data sources:
 *   - SARS-CoV-2: https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m
 *   - H5N1 (A/H5): https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha
 *   - Influenza: https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/...
 *
 * Ref: MOSAIC paper §5.3; Hadfield et al. (2018) Bioinformatics 34(23), 4121–4123.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  computeGenomicAnomalyScores,
  type LineageSnapshot,
} from "@/lib/kl-divergence";

export const revalidate = 7200; // Nextstrain updates as sequences are deposited

/** Nextstrain dataset URLs by pathogen slug */
const NEXTSTRAIN_URLS: Record<string, string> = {
  "sars-cov-2":
    "https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m",
  "h5n1":
    "https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha",
  "mpox":
    "https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib",
  "influenza-h3n2":
    "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h3n2/ha/2y",
  "influenza-h1n1":
    "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h1n1pdm/ha/2y",
};

interface NextstrainFreqData {
  pivots?: number[]; // decimal year timepoints
  frequencies?: Record<string, number[]>; // clade -> freq at each pivot
  generated_by?: { version: string };
  tree?: NextstrainTreeNode;
  meta?: Record<string, unknown>;
}

interface NextstrainTreeNode {
  children?: NextstrainTreeNode[];
  node_attrs?: {
    num_date?: { value?: number };
    clade_membership?: { value?: string };
    pango_lineage?: { value?: string };
    Nextclade_pango?: { value?: string };
  };
}

/** Convert decimal year to ISO date string */
function decimalYearToDate(dy: number): string {
  const year = Math.floor(dy);
  const dayOfYear = Math.round((dy - year) * 365.25);
  const date = new Date(year, 0, 1);
  date.setDate(date.getDate() + dayOfYear);
  return date.toISOString().split("T")[0];
}

function snapshotsFromTipFrequencies(data: NextstrainFreqData): LineageSnapshot[] | null {
  const { pivots, frequencies } = data;
  if (!pivots?.length || !frequencies) return null;

  return pivots.map((pivot, i) => {
    const freqAtPivot: Record<string, number> = {};
    for (const [clade, freqs] of Object.entries(frequencies)) {
      freqAtPivot[clade] = freqs[i] ?? 0;
    }
    return {
      date: decimalYearToDate(pivot),
      frequencies: freqAtPivot,
    };
  });
}

function snapshotsFromTree(data: NextstrainFreqData): LineageSnapshot[] | null {
  if (!data.tree) return null;

  const tips: Array<{ date: string; lineage: string }> = [];
  const visit = (node: NextstrainTreeNode) => {
    if (node.children?.length) {
      for (const child of node.children) visit(child);
      return;
    }

    const attrs = node.node_attrs ?? {};
    const numDate = attrs.num_date?.value;
    const lineage =
      attrs.pango_lineage?.value ??
      attrs.Nextclade_pango?.value ??
      attrs.clade_membership?.value ??
      "unknown";

    if (typeof numDate === "number") {
      tips.push({ date: decimalYearToDate(numDate), lineage });
    }
  };

  visit(data.tree);
  if (tips.length === 0) return null;

  const byWindow = new Map<string, Map<string, number>>();
  for (const tip of tips) {
    const d = new Date(`${tip.date}T00:00:00Z`);
    const day = Math.floor(d.getTime() / 86_400_000);
    const windowStartDay = day - (day % 14);
    const windowDate = new Date(windowStartDay * 86_400_000).toISOString().split("T")[0];
    const counts = byWindow.get(windowDate) ?? new Map<string, number>();
    counts.set(tip.lineage, (counts.get(tip.lineage) ?? 0) + 1);
    byWindow.set(windowDate, counts);
  }

  return Array.from(byWindow.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => {
      const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0) || 1;
      const frequencies: Record<string, number> = {};
      for (const [lineage, count] of counts) {
        frequencies[lineage] = count / total;
      }
      return { date, frequencies };
    });
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

  const snapshots = snapshotsFromTipFrequencies(data) ?? snapshotsFromTree(data);
  if (!snapshots?.length) {
    return NextResponse.json(
      { error: "Unexpected Nextstrain response format" },
      { status: 502 }
    );
  }

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
      numPivots: snapshots.length,
      numLineages: Object.keys(latestSnapshot.frequencies).length,
      source: "Nextstrain open data",
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
    },
  });
}
