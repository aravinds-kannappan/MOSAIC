"""Tests for BOCPD change-point detection."""

import numpy as np
import pytest

from mosaic_core.detect.bocpd import run_bocpd, bocpd_update, BOCPDState


def test_bocpd_returns_correct_shape():
    counts = [0, 1, 0, 2, 0, 1, 0, 0, 5, 8, 12, 10, 9, 11]
    result = run_bocpd(counts)
    assert len(result.change_point_prob) == len(counts)
    assert len(result.cum_cp_prob) == len(counts)
    assert len(result.run_length_mode) == len(counts)


def test_bocpd_probs_in_unit_interval():
    counts = list(range(20))
    result = run_bocpd(counts)
    assert np.all(result.change_point_prob >= 0)
    assert np.all(result.change_point_prob <= 1)
    assert np.all(result.cum_cp_prob >= 0)
    assert np.all(result.cum_cp_prob <= 1)


def test_bocpd_detects_obvious_change_point():
    """A sudden jump from 0-1 counts to 50+ should yield high CP probability."""
    baseline = [0, 1, 0, 0, 1, 0, 1, 0, 0, 0] * 3
    outbreak = [50, 55, 60, 52, 58, 61, 55, 53]
    counts = baseline + outbreak
    result = run_bocpd(counts)
    # CP probability at the transition should be elevated
    transition_idx = len(baseline)
    assert result.change_point_prob[transition_idx] > 0.1, (
        f"Expected elevated CP prob at transition, got {result.change_point_prob[transition_idx]:.4f}"
    )


def test_bocpd_empty_input():
    result = run_bocpd([])
    assert len(result.change_point_prob) == 0
    assert len(result.cum_cp_prob) == 0


def test_bocpd_constant_series():
    """A constant-rate series should produce low CP probability."""
    counts = [5] * 30
    result = run_bocpd(counts)
    # After initial transient, CP probability should be low
    assert result.cum_cp_prob[-1] < 0.5, (
        f"Constant series should not trigger high CP prob, got {result.cum_cp_prob[-1]:.4f}"
    )


def test_bocpd_update_normalised():
    """Run-length distribution should sum to 1 after update."""
    state = BOCPDState()
    new_state, cp_prob, log_pred = bocpd_update(state, n_t=3, hazard=1/30)
    assert abs(new_state.R.sum() - 1.0) < 1e-6, f"R sums to {new_state.R.sum():.6f}"


def test_bocpd_with_quality_weights():
    """Quality weights should scale effective counts without breaking output shape."""
    counts = [0, 1, 0, 5, 8, 10]
    weights = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]
    result = run_bocpd(counts, quality_weights=weights)
    assert len(result.change_point_prob) == len(counts)
