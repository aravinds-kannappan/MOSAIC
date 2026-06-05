"""Tests for KL/JSD genomic anomaly scoring."""

from datetime import date, timedelta

import numpy as np
import pytest

from mosaic.detect.kl_anomaly import (
    js_divergence,
    kl_divergence,
    compute_genomic_anomaly_scores,
)
from mosaic.ingest.nextstrain import LineageSnapshot


def test_kl_divergence_identical_distributions():
    p = np.array([0.5, 0.3, 0.2])
    assert abs(kl_divergence(p, p)) < 1e-10


def test_kl_divergence_zero_p():
    p = np.array([0.0, 0.5, 0.5])
    q = np.array([0.3, 0.4, 0.3])
    kl = kl_divergence(p, q)
    assert kl >= 0


def test_jsd_symmetry():
    p = np.array([0.6, 0.3, 0.1])
    q = np.array([0.1, 0.3, 0.6])
    assert abs(js_divergence(p, q) - js_divergence(q, p)) < 1e-10


def test_jsd_bounded():
    """JSD must be in [0, log 2]."""
    for _ in range(20):
        p = np.random.dirichlet(np.ones(10))
        q = np.random.dirichlet(np.ones(10))
        jsd = js_divergence(p, q)
        assert 0 <= jsd <= np.log(2) + 1e-8, f"JSD out of range: {jsd}"


def test_jsd_zero_for_identical():
    p = np.array([0.4, 0.4, 0.2])
    assert js_divergence(p, p) < 1e-10


def make_snapshots(n: int, shift_at: int | None = None) -> list[LineageSnapshot]:
    """Create synthetic snapshots with optional frequency shift."""
    base = {"A": 0.7, "B": 0.2, "C": 0.1}
    shifted = {"A": 0.1, "B": 0.2, "C": 0.7}  # C dominates after shift
    snapshots = []
    today = date(2024, 1, 1)
    for i in range(n):
        freqs = shifted if (shift_at is not None and i >= shift_at) else base
        snapshots.append(LineageSnapshot(
            pathogen="sars-cov-2",
            date=today + timedelta(weeks=i),
            frequencies=freqs,
            n_sequences=100,
        ))
    return snapshots


def test_anomaly_scores_shape():
    snapshots = make_snapshots(20)
    results = compute_genomic_anomaly_scores(snapshots)
    assert len(results) == len(snapshots) - 1  # First snapshot has no baseline


def test_anomaly_detects_frequency_shift():
    """A sudden lineage composition shift should produce elevated alarm probability."""
    snapshots = make_snapshots(30, shift_at=20)
    results = compute_genomic_anomaly_scores(snapshots, null_period_fraction=0.4)
    # JSD after the shift should be higher than before
    pre_shift = [r.jsd for r in results if r.date <= date(2024, 5, 15)]
    post_shift = [r.jsd for r in results if r.date > date(2024, 5, 15)]
    if pre_shift and post_shift:
        assert np.mean(post_shift) > np.mean(pre_shift) * 2, (
            f"Expected elevated JSD after shift: pre={np.mean(pre_shift):.4f} post={np.mean(post_shift):.4f}"
        )


def test_alarm_prob_in_unit_interval():
    snapshots = make_snapshots(25)
    results = compute_genomic_anomaly_scores(snapshots)
    for r in results:
        assert 0 <= r.alarm_prob <= 1, f"alarm_prob={r.alarm_prob} out of [0, 1]"
