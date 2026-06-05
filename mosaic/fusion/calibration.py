"""
MOSAIC Calibration Evaluation — Layer 4

Computes calibration metrics for the fusion model posteriors:
  - Reliability diagram (eq. 21 in paper)
  - Expected Calibration Error (ECE)
  - Continuous Ranked Probability Score (CRPS, eq. 22)
  - Weighted Interval Score (WIS, eq. 23)

Also runs retrospective validation across the 4 historical outbreaks
to compute lead time vs WHO DON publication dates.

Ref: MOSAIC paper §7.2 (Calibration Evaluation) and §8 (Retrospective Validation)
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

VALIDATION_OUTBREAKS = [
    {
        "name": "SARS-CoV-2 Omicron",
        "pathogen": "sars-cov-2",
        "start_date": "2021-10-01",
        "who_don_date": "2021-11-26",
        "alert_threshold": 0.80,
    },
    {
        "name": "Mpox USA",
        "pathogen": "mpox",
        "start_date": "2022-04-01",
        "who_don_date": "2022-05-23",
        "alert_threshold": 0.80,
    },
    {
        "name": "Poliovirus NY",
        "pathogen": "polio",
        "start_date": "2022-05-01",
        "who_don_date": "2022-07-21",
        "alert_threshold": 0.80,
    },
    {
        "name": "H5N1 cattle USA",
        "pathogen": "h5n1",
        "start_date": "2024-02-01",
        "who_don_date": "2024-03-25",
        "alert_threshold": 0.80,
    },
]


@dataclass
class CalibrationBin:
    bin_center: float
    predicted_prob: float
    observed_freq: float
    count: int


@dataclass
class CalibrationMetrics:
    bins: list[CalibrationBin]
    ece: float           # Expected Calibration Error (eq. 21)
    sharpness: float     # Mean predicted probability (resolution proxy)
    resolution: float    # Variance of predicted probabilities
    n_observations: int
    last_updated: str


def reliability_diagram(
    predicted_probs: np.ndarray,
    observed_outcomes: np.ndarray,
    n_bins: int = 10,
) -> CalibrationMetrics:
    """
    Compute reliability diagram and ECE (eq. 21 in MOSAIC paper).

    ECE = Σ_b |B_b|/N * |mean_pred_b - mean_obs_b|

    Args:
        predicted_probs:   P(R_t > 1) predictions, shape (N,)
        observed_outcomes: Binary outcomes (1 if R_t > 1 in ground truth), shape (N,)
        n_bins:            Number of equal-width bins B = 10 (paper default)
    """
    predicted_probs = np.asarray(predicted_probs, dtype=float)
    observed_outcomes = np.asarray(observed_outcomes, dtype=float)
    N = len(predicted_probs)

    bins = np.linspace(0, 1, n_bins + 1)
    bin_centers = (bins[:-1] + bins[1:]) / 2

    calibration_bins: list[CalibrationBin] = []
    ece = 0.0

    for i, (lo, hi) in enumerate(zip(bins[:-1], bins[1:])):
        mask = (predicted_probs >= lo) & (predicted_probs < hi)
        if i == n_bins - 1:  # Include right edge in last bin
            mask = (predicted_probs >= lo) & (predicted_probs <= hi)

        n_b = int(mask.sum())
        if n_b == 0:
            calibration_bins.append(CalibrationBin(
                bin_center=float(bin_centers[i]),
                predicted_prob=float(bin_centers[i]),
                observed_freq=float(bin_centers[i]),  # no data
                count=0,
            ))
            continue

        mean_pred = float(predicted_probs[mask].mean())
        mean_obs = float(observed_outcomes[mask].mean())

        ece += (n_b / N) * abs(mean_pred - mean_obs)
        calibration_bins.append(CalibrationBin(
            bin_center=float(bin_centers[i]),
            predicted_prob=mean_pred,
            observed_freq=mean_obs,
            count=n_b,
        ))

    sharpness = float(predicted_probs.mean())
    resolution = float(predicted_probs.var())

    return CalibrationMetrics(
        bins=calibration_bins,
        ece=float(ece),
        sharpness=sharpness,
        resolution=resolution,
        n_observations=N,
        last_updated=date.today().isoformat(),
    )


def crps(predicted_cdf_samples: np.ndarray, y_obs: float) -> float:
    """
    Continuous Ranked Probability Score (eq. 22).
    CRPS(F̂, y) = ∫(F̂(z) - 1[z≥y])² dz
    Estimated via the energy form using posterior samples.
    """
    n = len(predicted_cdf_samples)
    term1 = np.mean(np.abs(predicted_cdf_samples - y_obs))
    term2 = np.mean(np.abs(predicted_cdf_samples[:, None] - predicted_cdf_samples[None, :]))
    return float(term1 - 0.5 * term2)


def weighted_interval_score(
    y_obs: float,
    y_median: float,
    intervals: list[tuple[float, float, float]],  # (alpha, lower, upper)
) -> float:
    """
    Weighted Interval Score (eq. 23) — standard metric from US COVID-19 Forecast Hub.
    WIS = 1/(K+0.5) * (0.5*|y - median| + Σ_k (α_k/2) * IS_k)
    where IS_k = (upper_k - lower_k) + 2/α_k * max(lower_k - y, 0) + 2/α_k * max(y - upper_k, 0)
    """
    K = len(intervals)
    abs_error = abs(y_obs - y_median)
    interval_sum = 0.0

    for alpha, lower, upper in intervals:
        width = upper - lower
        undershoot = max(lower - y_obs, 0)
        overshoot = max(y_obs - upper, 0)
        is_k = width + (2 / alpha) * undershoot + (2 / alpha) * overshoot
        interval_sum += (alpha / 2) * is_k

    return (0.5 * abs_error + interval_sum) / (K + 0.5)


def save_calibration_results(metrics: CalibrationMetrics, path: str) -> None:
    """Save calibration metrics to JSON for the web dashboard."""
    data = {
        "bins": [asdict(b) for b in metrics.bins],
        "ece": metrics.ece,
        "sharpness": metrics.sharpness,
        "resolution": metrics.resolution,
        "n_observations": metrics.n_observations,
        "last_updated": metrics.last_updated,
    }
    Path(path).write_text(json.dumps(data, indent=2))
    logger.info("Saved calibration results to %s (ECE=%.4f)", path, metrics.ece)


def compute_lead_time(
    p_outbreak_series: np.ndarray,
    dates: list[date],
    who_don_date: date,
    threshold: float = 0.80,
) -> int | None:
    """
    Compute lead time Δt = t_WHO - t* in days.
    t* = first day MOSAIC's posterior crosses P(R_t > 1) > threshold.
    Positive lead time means MOSAIC detected earlier than WHO DON.

    Ref: MOSAIC paper §8.1 (Validation Design)
    """
    for i, p in enumerate(p_outbreak_series):
        if p > threshold:
            t_star = dates[i]
            return (who_don_date - t_star).days
    return None  # MOSAIC never crossed threshold (missed detection)
