/**
 * KL-Divergence Genomic Anomaly Scoring (MOSAIC Layer 2c)
 *
 * Computes the Jensen-Shannon Divergence between the current 14-day
 * lineage frequency distribution and a 90-day rolling baseline, then
 * calibrates the score against a null distribution to produce a
 * soft alarm probability p_t^gen = P(A >= A_t | null).
 *
 * Ref: MOSAIC paper §5.3; JSD is bounded in [0, log 2] and defined
 * even when frequencies are zero, avoiding numerical instability of
 * asymmetric KL on sparse distributions.
 */

/**
 * KL divergence KL(P || Q) with add-epsilon smoothing for zeros.
 * Returns nats (natural log base).
 */
export function klDivergence(p: number[], q: number[], eps = 1e-10): number {
  if (p.length !== q.length) throw new Error("Distributions must have equal length");
  return p.reduce((sum, pi, i) => {
    if (pi <= 0) return sum;
    const qi = Math.max(q[i], eps);
    return sum + pi * Math.log(pi / qi);
  }, 0);
}

/**
 * Jensen-Shannon Divergence JSD(P || Q), symmetric, bounded [0, log 2].
 */
export function jsDivergence(p: number[], q: number[]): number {
  if (p.length !== q.length) throw new Error("Distributions must have equal length");
  const m = p.map((pi, i) => (pi + q[i]) / 2);
  return 0.5 * klDivergence(p, m) + 0.5 * klDivergence(q, m);
}

/**
 * Normalise a frequency vector so it sums to 1.
 * Handles zero-vectors by returning uniform distribution.
 */
export function normalise(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 1 / counts.length);
  return counts.map((c) => c / total);
}

export interface LineageSnapshot {
  date: string;
  /** Map from lineage name to relative frequency (should sum to ~1) */
  frequencies: Record<string, number>;
}

export interface GenomicAnomalyResult {
  date: string;
  jsd: number;
  /** P(A >= jsd | null) — soft alarm probability */
  alarmProb: number;
  /** Top lineages driving the shift (top 3 by |Δfreq|) */
  topShiftingLineages: Array<{ lineage: string; delta: number }>;
}

/**
 * Compute genomic anomaly scores for a time series of lineage snapshots.
 *
 * @param snapshots  Ordered list of 14-day windowed lineage frequency snapshots
 * @param baselineDays  Number of days to use as rolling baseline (default 90)
 */
export function computeGenomicAnomalyScores(
  snapshots: LineageSnapshot[],
  baselineDays = 90
): GenomicAnomalyResult[] {
  if (snapshots.length < 2) return [];

  // Collect all lineage names seen across the full series
  const allLineages = Array.from(
    new Set(snapshots.flatMap((s) => Object.keys(s.frequencies)))
  ).sort();
  const L = allLineages.length;

  // A genomic anomaly is a *shift in the lineage distribution*. With a single
  // lineage (or none) the distribution is degenerate, JSD is identically 0, and
  // no shift is detectable — report a flat zero alarm rather than a spurious one.
  if (L <= 1) {
    return snapshots.slice(1).map((s) => ({
      date: s.date,
      jsd: 0,
      alarmProb: 0,
      topShiftingLineages: [],
    }));
  }

  // Pre-compute the ordered, normalised frequency vector for every snapshot
  // ONCE. (Doing this inside the baseline loop turns the cost quadratic in
  // both the number of snapshots and lineages — billions of ops for a series
  // with hundreds of lineages.)
  const vectors: number[][] = snapshots.map((snap) =>
    normalise(allLineages.map((l) => snap.frequencies[l] ?? 0))
  );

  // Estimate baseline null distribution of JSD from inter-outbreak windows.
  // We use the empirical distribution of JSD scores from sequential snapshots
  // during the first baselineDays period as the null model.
  const results: GenomicAnomalyResult[] = [];
  const nullJsdValues: number[] = [];

  for (let t = 1; t < snapshots.length; t++) {
    const current = snapshots[t];
    const currentVec = vectors[t];

    // Rolling baseline: average of all snapshots in [t-baselineDays, t-1]
    const start = Math.max(0, t - baselineDays);
    const span = t - start;
    const baselineAvg = new Array<number>(L).fill(0);
    for (let k = start; k < t; k++) {
      const vec = vectors[k];
      for (let i = 0; i < L; i++) baselineAvg[i] += vec[i];
    }
    for (let i = 0; i < L; i++) baselineAvg[i] /= span;
    const baselineVec = normalise(baselineAvg);

    const jsd = jsDivergence(currentVec, baselineVec);

    // Accumulate null JSD values from early period (first quarter of series)
    if (t < Math.max(10, Math.floor(snapshots.length / 4))) {
      nullJsdValues.push(jsd);
    }

    // P(A >= jsd | null) = 1 - F_null(jsd)
    // Estimate F_null empirically; fall back to exponential approximation
    let alarmProb: number;
    if (nullJsdValues.length >= 5) {
      const exceeding = nullJsdValues.filter((v) => v >= jsd).length;
      alarmProb = exceeding / nullJsdValues.length;
    } else {
      // Exponential null approximation: rate = 1/mean_null
      const meanNull = Math.max(nullJsdValues.reduce((a, b) => a + b, 0.01) / Math.max(nullJsdValues.length, 1), 0.01);
      alarmProb = Math.exp(-jsd / meanNull);
      alarmProb = 1 - alarmProb; // P(exceed)
    }

    // Top shifting lineages
    const prevVec = vectors[t - 1];
    const deltas = allLineages.map((l, i) => ({
      lineage: l,
      delta: currentVec[i] - prevVec[i],
    }));
    deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    results.push({
      date: current.date,
      jsd,
      alarmProb: Math.min(Math.max(alarmProb, 0), 1),
      topShiftingLineages: deltas.slice(0, 3),
    });
  }

  return results;
}
