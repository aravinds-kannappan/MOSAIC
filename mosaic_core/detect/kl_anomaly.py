"""
KL-Divergence Genomic Anomaly Scoring — MOSAIC Layer 2c

Computes Jensen-Shannon Divergence between the current 14-day lineage
frequency distribution and a 90-day rolling baseline, then calibrates
the score against an empirical null distribution to produce a soft
alarm probability p_t^gen.

JSD is bounded in [0, log 2] and is defined even when frequencies are
zero, avoiding the numerical instability of asymmetric KL on sparse
distributions.

Key output (eq. 11):
    p_t^gen = P(A ≥ A_t | null) = 1 - F_null(A_t)

where A_t = JSD(p_t || q_t^base) is the genomic anomaly score at time t.

Ref: MOSAIC paper §5.3 (Layer 2c — KL-Divergence Genomic Anomaly Scoring)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from scipy import stats

from mosaic_core.ingest.nextstrain import LineageSnapshot, snapshots_to_matrix

logger = logging.getLogger(__name__)


@dataclass
class GenomicAnomalyResult:
    """Genomic anomaly scores for a single time point."""
    date: object                    # datetime.date
    jsd: float                      # Jensen-Shannon divergence A_t
    alarm_prob: float               # p_t^gen = P(A ≥ A_t | null)
    baseline_days: int              # actual number of days in rolling baseline
    top_shifting_lineages: list[tuple[str, float]]  # (lineage, Δfreq) sorted by |Δ|


def kl_divergence(p: np.ndarray, q: np.ndarray, eps: float = 1e-10) -> float:
    """
    KL divergence KL(P || Q) with epsilon smoothing for zero entries.
    Returns nats (natural log base).
    """
    p = np.asarray(p, dtype=float)
    q = np.asarray(q, dtype=float)
    q = np.where(q < eps, eps, q)
    mask = p > 0
    return float(np.sum(p[mask] * np.log(p[mask] / q[mask])))


def js_divergence(p: np.ndarray, q: np.ndarray) -> float:
    """
    Jensen-Shannon Divergence JSD(P || Q).
    Symmetric, bounded [0, log 2], defined for sparse distributions.
    eq. (10) in MOSAIC paper.
    """
    p = np.asarray(p, dtype=float)
    q = np.asarray(q, dtype=float)
    m = (p + q) / 2
    return 0.5 * kl_divergence(p, m) + 0.5 * kl_divergence(q, m)


def compute_genomic_anomaly_scores(
    snapshots: list[LineageSnapshot],
    baseline_days: int = 90,
    window_days: int = 14,
    null_period_fraction: float = 0.25,
) -> list[GenomicAnomalyResult]:
    """
    Compute genomic anomaly scores for a time series of lineage snapshots.

    Args:
        snapshots:             Ordered list of lineage frequency snapshots
        baseline_days:         Rolling baseline window (paper: 90 days)
        window_days:           Current observation window (paper: 14 days)
        null_period_fraction:  Fraction of series used to estimate null JSD distribution

    Returns:
        List of GenomicAnomalyResult, one per snapshot after the warm-up period
    """
    if len(snapshots) < 2:
        return []

    dates, lineages, matrix = snapshots_to_matrix(snapshots)
    T, K = matrix.shape
    logger.info("Computing genomic anomaly scores: %d timepoints, %d lineages", T, K)

    # Estimate null JSD distribution from early inter-outbreak period
    null_period = max(5, int(T * null_period_fraction))
    null_jsds: list[float] = []

    results: list[GenomicAnomalyResult] = []

    for t in range(1, T):
        current_freq = matrix[t]
        # Normalise
        total = current_freq.sum()
        if total > 0:
            current_freq = current_freq / total
        else:
            current_freq = np.ones(K) / K

        # Rolling baseline: mean of snapshots in [t-baseline_days, t-1]
        # Approximate by index since we don't always have exact day counts
        baseline_start = max(0, t - baseline_days)
        baseline_matrix = matrix[baseline_start:t]
        if len(baseline_matrix) == 0:
            continue

        baseline_freq = baseline_matrix.mean(axis=0)
        btotal = baseline_freq.sum()
        if btotal > 0:
            baseline_freq = baseline_freq / btotal
        else:
            baseline_freq = np.ones(K) / K

        jsd = js_divergence(current_freq, baseline_freq)

        # Accumulate null distribution
        if t <= null_period:
            null_jsds.append(jsd)

        # P(A ≥ jsd | null) = 1 - F_null(jsd)
        if len(null_jsds) >= 5:
            # Empirical CDF of null distribution
            null_arr = np.array(null_jsds)
            # Fit exponential null model (JSD values are non-negative, roughly exponential)
            try:
                loc, scale = stats.expon.fit(null_arr, floc=0)
                alarm_prob = float(stats.expon.sf(jsd, loc=loc, scale=scale))
            except Exception:
                alarm_prob = float(np.mean(null_arr >= jsd))
        else:
            # Insufficient null samples — use conservative alarm prob
            alarm_prob = min(float(jsd / np.log(2)), 1.0)

        alarm_prob = float(np.clip(alarm_prob, 0.0, 1.0))

        # Top shifting lineages: |Δfreq| from previous snapshot
        prev_freq = matrix[t - 1]
        ptotal = prev_freq.sum()
        if ptotal > 0:
            prev_freq = prev_freq / ptotal
        deltas = [(lineages[i], float(current_freq[i] - prev_freq[i])) for i in range(K)]
        deltas.sort(key=lambda x: abs(x[1]), reverse=True)

        results.append(
            GenomicAnomalyResult(
                date=dates[t],
                jsd=jsd,
                alarm_prob=alarm_prob,
                baseline_days=t - baseline_start,
                top_shifting_lineages=deltas[:5],
            )
        )

    return results


if __name__ == "__main__":
    """
    Compute KL/JSD genomic anomaly scores from stored Nextstrain data.
    Reads data/output/nextstrain_{pathogen}.json → writes data/output/genomic_alarms.json.

    Usage:
        python -m mosaic_core.detect.kl_anomaly
        python -m mosaic_core.detect.kl_anomaly --pathogens sars-cov-2 h5n1
    """
    import argparse
    import sys
    from datetime import datetime, date
    from mosaic_core.store import load, save, list_files

    parser = argparse.ArgumentParser(description="Compute KL/JSD genomic anomaly scores")
    parser.add_argument("--pathogens", nargs="+", default=None,
                        help="Pathogen slugs (default: all available in data/output/)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    # Discover available Nextstrain files
    if args.pathogens:
        pathogens = args.pathogens
    else:
        pathogens = [
            f.replace("nextstrain_", "").replace(".json", "")
            for f in list_files()
            if f.startswith("nextstrain_")
        ]

    if not pathogens:
        print("  ✗ No nextstrain_*.json files found — run: python -m mosaic_core.ingest.nextstrain")
        sys.exit(1)

    print(f"[KL-anomaly] Processing {len(pathogens)} pathogen(s): {pathogens}")

    from mosaic_core.ingest.nextstrain import LineageSnapshot

    all_results = {}
    for pathogen in pathogens:
        data = load(f"nextstrain_{pathogen}.json")
        if not data:
            print(f"  ✗ No data for {pathogen} — skipping")
            continue

        snapshots = [
            LineageSnapshot(
                pathogen=pathogen,
                date=date.fromisoformat(s["date"]),
                frequencies=s["frequencies"],
                n_sequences=s.get("n_sequences", 100),
            )
            for s in data.get("snapshots", [])
        ]

        if len(snapshots) < 5:
            print(f"  ✗ Too few snapshots for {pathogen} ({len(snapshots)}) — skipping")
            continue

        scores = compute_genomic_anomaly_scores(snapshots)
        latest = scores[-1] if scores else None

        all_results[pathogen] = {
            "time_series": [
                {
                    "date": str(s.date),
                    "jsd": s.jsd,
                    "alarm_prob": s.alarm_prob,
                    "top_shifting_lineages": s.top_shifting_lineages[:3],
                }
                for s in scores
            ],
            "latest_jsd": latest.jsd if latest else 0,
            "latest_alarm_prob": latest.alarm_prob if latest else 0,
            "latest_date": str(latest.date) if latest else None,
        }
        if latest:
            print(f"  {pathogen:25s}  JSD={latest.jsd:.4f}  alarm={latest.alarm_prob:.3f}")

    save("genomic_alarms.json", {"alarms": all_results, "run_at": datetime.utcnow().isoformat()})
    print(f"\n[KL-anomaly] Saved {len(all_results)} pathogen scores → data/output/genomic_alarms.json")
