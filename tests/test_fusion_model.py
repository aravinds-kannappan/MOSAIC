"""Tests for the calibration metrics and Rt estimation utilities."""

import numpy as np
import pytest

from mosaic.fusion.calibration import (
    reliability_diagram,
    crps,
    weighted_interval_score,
    compute_lead_time,
)


def test_reliability_diagram_perfect_calibration():
    """A perfectly calibrated model should have ECE ≈ 0."""
    np.random.seed(42)
    probs = np.random.uniform(0, 1, 1000)
    outcomes = np.random.binomial(1, probs)  # outcomes drawn from predicted probs
    metrics = reliability_diagram(probs, outcomes, n_bins=10)
    # ECE should be small (< 0.05 with enough samples)
    assert metrics.ece < 0.10, f"ECE = {metrics.ece:.4f} for calibrated model"


def test_reliability_diagram_overconfident():
    """An always-confident model should have high ECE."""
    probs = np.ones(200) * 0.95
    outcomes = np.random.binomial(1, 0.5, 200)
    metrics = reliability_diagram(probs, outcomes)
    assert metrics.ece > 0.3


def test_reliability_diagram_n_bins():
    probs = np.linspace(0, 1, 100)
    outcomes = (probs > 0.5).astype(float)
    metrics = reliability_diagram(probs, outcomes, n_bins=10)
    assert len(metrics.bins) == 10


def test_crps_perfect_forecast():
    """CRPS should be 0 when all samples equal the observation."""
    y = 5.0
    samples = np.full(1000, y)
    assert abs(crps(samples, y)) < 1e-6


def test_crps_nonnegative():
    np.random.seed(42)
    samples = np.random.normal(3, 1, 500)
    score = crps(samples, 2.0)
    assert score >= 0


def test_wis_basic():
    """WIS should be positive for non-trivial cases."""
    y = 10.0
    intervals = [(0.5, 8.0, 12.0), (0.2, 6.0, 14.0), (0.1, 4.0, 16.0)]
    score = weighted_interval_score(y, 10.0, intervals)
    assert score >= 0


def test_wis_perfect_median():
    """WIS should decrease when median equals observation."""
    y = 10.0
    intervals = [(0.5, 8.0, 12.0)]
    wis_good = weighted_interval_score(y, 10.0, intervals)
    wis_bad = weighted_interval_score(y, 15.0, intervals)
    assert wis_good < wis_bad


def test_compute_lead_time_detected():
    from datetime import date
    dates = [date(2021, 11, i + 1) for i in range(30)]
    p_outbreak = np.concatenate([np.zeros(10), np.linspace(0, 1, 20)])
    who_don = date(2021, 11, 26)
    lead_time = compute_lead_time(p_outbreak, dates, who_don, threshold=0.80)
    assert lead_time is not None
    assert lead_time > 0


def test_compute_lead_time_missed():
    from datetime import date
    dates = [date(2021, 11, i + 1) for i in range(30)]
    p_outbreak = np.zeros(30)  # Never crosses threshold
    who_don = date(2021, 11, 26)
    result = compute_lead_time(p_outbreak, dates, who_don, threshold=0.80)
    assert result is None
