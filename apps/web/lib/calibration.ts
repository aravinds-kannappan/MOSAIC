/**
 * Retrospective calibration of MOSAIC's P(R_t > 1) outbreak probability.
 *
 * P(R_t > 1) is, by definition, the probability that transmission is currently
 * growing. We validate it as a probabilistic forecast on the REAL multi-year
 * CDC NWSS national wastewater series (2021-12 → present, multiple SARS-CoV-2
 * waves): at each day we compute the EpiEstim Poisson-Gamma posterior
 * P(R_t > 1) from data up to that day, and the realised outcome is whether
 * activity actually rose over the following `HORIZON_DAYS`. Binning predicted
 * vs. observed frequency yields a reliability diagram, the Expected Calibration
 * Error (ECE), the Brier score and the AUROC.
 *
 * All numbers are computed from real public data, nothing is synthetic.
 *
 * NOTE: this calibrates the lightweight EpiEstim renewal estimator used by the
 * Vercel deployment. The full multi-stream NumPyro renewal-equation posterior
 * is calibrated separately by the Python backend (mosaic_core.fusion.calibration).
 */

import { estimateRt, SERIAL_INTERVALS } from "@/lib/rt-estimation";
import type { CalibrationBin, CalibrationData } from "@/lib/types";

const NWSS_BASE = "https://data.cdc.gov/resource/2ew6-ywp6.json";
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN ?? "";
const HORIZON_DAYS = 14;
const N_BINS = 10;

async function fetchNationalHistory(): Promise<{ dates: string[]; percentile: number[] }> {
  const params = new URLSearchParams({
    $select: "date_end,avg(percentile::number) as mean_pct",
    $group: "date_end",
    $where: "percentile IS NOT NULL",
    $order: "date_end ASC",
    $limit: "3000",
  });
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (SOCRATA_APP_TOKEN) headers["X-App-Token"] = SOCRATA_APP_TOKEN;

  const res = await fetch(`${NWSS_BASE}?${params}`, {
    headers,
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 86_400 },
  });
  if (!res.ok) throw new Error(`CDC NWSS returned ${res.status}`);
  const raw = (await res.json()) as Array<{ date_end: string; mean_pct?: string }>;

  const dates: string[] = [];
  const percentile: number[] = [];
  for (const r of raw) {
    if (r.mean_pct == null) continue;
    const p = parseFloat(r.mean_pct);
    if (!isNaN(p)) {
      dates.push(r.date_end);
      percentile.push(p);
    }
  }
  return { dates, percentile };
}

export interface CalibrationResult extends CalibrationData {
  brier: number;
  auc: number;
  base_rate: number;
  horizon_days: number;
  method: string;
}

export async function computeCalibration(): Promise<CalibrationResult> {
  const { dates, percentile } = await fetchNationalHistory();
  const counts = percentile.map((p) => Math.round(Math.max(0, p)));
  const si = SERIAL_INTERVALS["SARS-CoV-2"];
  const rt = estimateRt(dates, counts, si);

  const idxByDate = new Map(dates.map((d, i) => [d, i]));

  // (prediction, outcome) pairs: P(R_t>1) vs. did activity rise over next H days
  const pairs: Array<{ p: number; y: number }> = [];
  for (const est of rt) {
    const i = idxByDate.get(est.date);
    if (i == null || i + 1 + HORIZON_DAYS > percentile.length) continue;
    const future =
      percentile.slice(i + 1, i + 1 + HORIZON_DAYS).reduce((a, b) => a + b, 0) / HORIZON_DAYS;
    pairs.push({ p: est.pOutbreak, y: future > percentile[i] ? 1 : 0 });
  }

  const N = pairs.length || 1;

  const bins: CalibrationBin[] = [];
  let ece = 0;
  for (let b = 0; b < N_BINS; b++) {
    const lo = b / N_BINS;
    const hi = (b + 1) / N_BINS;
    const inBin = pairs.filter((d) =>
      b === N_BINS - 1 ? d.p >= lo && d.p <= hi : d.p >= lo && d.p < hi
    );
    if (inBin.length === 0) continue;
    const meanPred = inBin.reduce((a, d) => a + d.p, 0) / inBin.length;
    const obsFreq = inBin.reduce((a, d) => a + d.y, 0) / inBin.length;
    bins.push({
      bin_center: (lo + hi) / 2,
      predicted_prob: meanPred,
      observed_freq: obsFreq,
      count: inBin.length,
    });
    ece += (inBin.length / N) * Math.abs(meanPred - obsFreq);
  }

  const brier = pairs.reduce((a, d) => a + (d.p - d.y) ** 2, 0) / N;
  const sharpness = pairs.reduce((a, d) => a + d.p, 0) / N;
  const baseRate = pairs.reduce((a, d) => a + d.y, 0) / N;

  const pos = pairs.filter((d) => d.y === 1).map((d) => d.p);
  const neg = pairs.filter((d) => d.y === 0).map((d) => d.p);
  let auc = 0.5;
  if (pos.length && neg.length) {
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    auc = wins / (pos.length * neg.length);
  }

  return {
    bins,
    ece,
    sharpness,
    resolution: baseRate,
    base_rate: baseRate,
    brier,
    auc,
    horizon_days: HORIZON_DAYS,
    n_observations: pairs.length,
    last_updated: new Date().toISOString(),
    method:
      "EpiEstim P(R_t>1) on CDC NWSS national wastewater vs. realised 14-day growth",
  };
}
