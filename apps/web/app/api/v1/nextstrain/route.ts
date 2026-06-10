/**
 * Nextstrain Genomic Anomaly API Route
 *
 * Computes JSD-based genomic anomaly scores (MOSAIC Layer 2c) from Nextstrain
 * lineage frequency snapshots.
 *
 * Primary source: a bundled, pre-computed snapshot of biweekly lineage
 * frequency distributions (`data/nextstrain_lineage_snapshots.json`, refreshed
 * by `scripts/fetch_current_data.py`). This is real Nextstrain-derived data and
 * is used directly because the live `charon/getDataset` trees are ~9 MB each —
 * too large to download and walk per request on a serverless function (and
 * over Next.js's 2 MB fetch-cache limit). For pathogens not present in the
 * bundle we fall back to the live charon tree.
 *
 * Live fallback sources:
 *   - mpox: https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib
 *
 * Ref: MOSAIC paper §5.3; Hadfield et al. (2018) Bioinformatics 34(23), 4121–4123.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  computeGenomicAnomalyScores,
  type LineageSnapshot,
} from "@/lib/kl-divergence";
import bundled from "@/data/nextstrain_lineage_snapshots.json";

export const revalidate = 7200; // Nextstrain updates as sequences are deposited

/** Live charon datasets for pathogens not in the bundled snapshot. */
const NEXTSTRAIN_URLS: Record<string, string> = {
  mpox: "https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib",
};

/** Normalise an incoming pathogen param to a bundle/dataset slug. */
function toSlug(pathogen: string): string {
  return pathogen.toLowerCase().trim().replace(/\s+/g, "-");
}

interface BundledSnapshot {
  date: string;
  frequencies: Record<string, number>;
  n_sequences?: number;
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

function decimalYearToDate(dy: number): string {
  const year = Math.floor(dy);
  const dayOfYear = Math.round((dy - year) * 365.25);
  const date = new Date(year, 0, 1);
  date.setDate(date.getDate() + dayOfYear);
  return date.toISOString().split("T")[0];
}

/** Build biweekly lineage snapshots by walking a live charon tree. */
function snapshotsFromTree(tree: NextstrainTreeNode): LineageSnapshot[] | null {
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
  visit(tree);
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
      const total = Array.from(counts.values()).reduce((s, c) => s + c, 0) || 1;
      const frequencies: Record<string, number> = {};
      for (const [lineage, count] of counts) frequencies[lineage] = count / total;
      return { date, frequencies };
    });
}

async function liveSnapshots(slug: string): Promise<LineageSnapshot[] | null> {
  const url = NEXTSTRAIN_URLS[slug];
  if (!url) return null;
  // `cache: no-store` — these payloads exceed the 2 MB fetch-cache limit.
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Nextstrain API returned ${res.status} for ${slug}`);
  const data = (await res.json()) as { tree?: NextstrainTreeNode };
  if (!data.tree) return null;
  return snapshotsFromTree(data.tree);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const slug = toSlug(searchParams.get("pathogen") ?? "sars-cov-2");

  const datasets = (
    bundled as unknown as { datasets: Record<string, { snapshots: BundledSnapshot[] }> }
  ).datasets;

  let snapshots: LineageSnapshot[] | null = null;
  let source = "Nextstrain bundled lineage snapshots";
  let sourceUrl = "data/nextstrain_lineage_snapshots.json";

  const bundledEntry = datasets[slug];
  if (bundledEntry?.snapshots?.length) {
    snapshots = bundledEntry.snapshots.map((s) => ({
      date: s.date,
      frequencies: s.frequencies,
    }));
  } else if (NEXTSTRAIN_URLS[slug]) {
    try {
      snapshots = await liveSnapshots(slug);
      source = "Nextstrain open data (live charon)";
      sourceUrl = NEXTSTRAIN_URLS[slug];
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to reach Nextstrain: ${String(err)}` },
        { status: 502 }
      );
    }
  } else {
    return NextResponse.json(
      {
        error: `Unknown pathogen '${slug}'. Available: ${[
          ...Object.keys(datasets),
          ...Object.keys(NEXTSTRAIN_URLS),
        ].join(", ")}`,
      },
      { status: 400 }
    );
  }

  if (!snapshots?.length) {
    return NextResponse.json(
      { error: "No Nextstrain lineage snapshots available" },
      { status: 502 }
    );
  }

  // Compute JSD anomaly scores over the biweekly snapshot series.
  const anomalyScores = computeGenomicAnomalyScores(snapshots, 90);
  const latest = anomalyScores[anomalyScores.length - 1];
  const latestSnapshot = snapshots[snapshots.length - 1];

  const topLineages = Object.entries(latestSnapshot.frequencies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, freq]) => ({ name, frequency: freq }));

  return NextResponse.json({
    pathogen: slug,
    latestDate: latest?.date ?? latestSnapshot.date,
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
      pathogen: slug,
      numPivots: snapshots.length,
      numLineages: Object.keys(latestSnapshot.frequencies).length,
      source,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
    },
  });
}
