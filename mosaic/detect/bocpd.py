"""
Bayesian Online Change-Point Detection (BOCPD) — MOSAIC Layer 2a

Applied to daily LLM-extracted event counts per pathogen-location pair.

Model:
    n_t | λ_t ~ Poisson(λ_t)
    Conjugate prior: λ ~ Gamma(α_0, β_0)
    Hazard: h(τ) = 1/μ_RL (constant hazard, geometric run-length prior)
    Mean run-length μ_RL = 30 days (characteristic outbreak onset timescale)

Key output (eq. 6):
    p_t^text = P(change-point ≤ t | n_{1:t}) ∈ [0, 1]

Ref: Adams & MacKay (2007). arXiv:0710.3742
     MOSAIC paper §5.1 (Layer 2a)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
from scipy.special import gammaln

logger = logging.getLogger(__name__)


@dataclass
class BOCPDState:
    """Internal state of the BOCPD filter at a given time step."""
    R: np.ndarray = field(default_factory=lambda: np.array([1.0]))
    alphas: np.ndarray = field(default_factory=lambda: np.array([1.0]))
    betas: np.ndarray = field(default_factory=lambda: np.array([1.0]))
    t: int = 0


@dataclass
class BOCPDResult:
    """Output of a full BOCPD run on a time series."""
    change_point_prob: np.ndarray    # P(change-point at t) — instantaneous
    cum_cp_prob: np.ndarray          # P(change-point ≤ t) — cumulative (p_t^text)
    run_length_mode: np.ndarray      # modal run-length at each time step
    log_predictive: np.ndarray       # log P(n_t | n_{1:t-1}) — for model comparison


def _negbin_log_pmf(n: int, alpha: np.ndarray, beta: np.ndarray) -> np.ndarray:
    """
    Log PMF of NegBin(n; alpha, p) where p = beta/(beta+1).
    This is the Poisson-Gamma predictive distribution.
    """
    p = beta / (beta + 1)
    log_pmf = (
        gammaln(alpha + n)
        - gammaln(alpha)
        - gammaln(n + 1)
        + alpha * np.log(p)
        + n * np.log1p(-p)
    )
    return log_pmf


def bocpd_update(
    state: BOCPDState,
    n_t: int,
    alpha0: float = 1.0,
    beta0: float = 1.0,
    hazard: float = 1 / 30,
) -> tuple[BOCPDState, float, float]:
    """
    Update the BOCPD filter with a new observation.

    Returns:
        new_state: Updated filter state
        cp_prob:   P(change-point at t) — instantaneous
        log_pred:  log P(n_t | n_{1:t-1}) — marginal predictive log-probability
    """
    # 1. Predictive log-probabilities under each run-length hypothesis
    log_pred_r = _negbin_log_pmf(n_t, state.alphas, state.betas)

    # Numerical stability: subtract max before exponentiating
    max_log = np.max(log_pred_r)
    pred_r = np.exp(log_pred_r - max_log)

    # 2. Growth messages: existing run-lengths grow (no change-point)
    growth_msgs = state.R * (1 - hazard) * pred_r

    # 3. Change-point message: run-length resets to 0
    cp_mass = np.sum(state.R * hazard * pred_r)

    # 4. Normalise (total probability of new observation)
    total = np.sum(growth_msgs) + cp_mass
    if total < 1e-300:
        # Numerical underflow — reset to prior
        new_R = np.array([1.0])
        new_alphas = np.array([alpha0])
        new_betas = np.array([beta0])
        cp_prob = 0.0
    else:
        new_R = np.concatenate([[cp_mass / total], growth_msgs / total])
        new_alphas = np.concatenate([[alpha0], state.alphas + n_t])
        new_betas = np.concatenate([[beta0], state.betas + 1.0])
        cp_prob = float(cp_mass / total)

    log_pred = float(np.log(total) + max_log)

    new_state = BOCPDState(R=new_R, alphas=new_alphas, betas=new_betas, t=state.t + 1)
    return new_state, cp_prob, log_pred


def run_bocpd(
    counts: Sequence[int],
    alpha0: float = 1.0,
    beta0: float = 1.0,
    mean_run_length: float = 30.0,
    quality_weights: Sequence[float] | None = None,
) -> BOCPDResult:
    """
    Run BOCPD on a complete time series of event counts.

    Args:
        counts:           Daily event counts n_t (non-negative integers)
        alpha0:           Gamma prior shape
        beta0:            Gamma prior rate
        mean_run_length:  μ_RL in days (hazard = 1/μ_RL)
        quality_weights:  Per-observation quality weights q_t ∈ [0, 1]
                         Applied as: effective count = round(q_t * n_t)

    Returns:
        BOCPDResult with change-point probabilities and diagnostics
    """
    T = len(counts)
    if T == 0:
        return BOCPDResult(
            change_point_prob=np.array([]),
            cum_cp_prob=np.array([]),
            run_length_mode=np.array([], dtype=int),
            log_predictive=np.array([]),
        )

    hazard = 1.0 / mean_run_length
    state = BOCPDState(
        R=np.array([1.0]),
        alphas=np.array([alpha0]),
        betas=np.array([beta0]),
    )

    cp_probs = np.zeros(T)
    run_length_modes = np.zeros(T, dtype=int)
    log_predictives = np.zeros(T)

    for t, n in enumerate(counts):
        # Apply quality weight if provided
        if quality_weights is not None:
            n = round(max(0, quality_weights[t]) * n)

        state, cp_prob, log_pred = bocpd_update(
            state, int(n), alpha0=alpha0, beta0=beta0, hazard=hazard
        )
        cp_probs[t] = cp_prob
        run_length_modes[t] = int(np.argmax(state.R))
        log_predictives[t] = log_pred

    # Cumulative change-point probability: P(τ ≤ t) via survival function
    # P(τ ≤ t) = 1 - ∏_{s≤t} (1 - P(τ=s))
    survival = np.cumprod(1 - cp_probs)
    cum_cp_probs = 1 - survival

    return BOCPDResult(
        change_point_prob=cp_probs,
        cum_cp_prob=cum_cp_probs,
        run_length_mode=run_length_modes,
        log_predictive=log_predictives,
    )


def events_to_daily_counts(
    event_dates: list,    # list of datetime.date objects
    quality_weights: list[float] | None = None,
) -> tuple[list, list[int], list[float]]:
    """
    Convert a list of event dates to a sorted list of (date, count, weight) triples.
    Fills in zeros for days with no events.
    """
    from datetime import date, timedelta
    from collections import defaultdict

    if not event_dates:
        return [], [], []

    date_counts: dict = defaultdict(float)
    date_weights: dict = defaultdict(float)
    date_event_count: dict = defaultdict(int)

    for i, d in enumerate(event_dates):
        w = quality_weights[i] if quality_weights else 1.0
        date_counts[d] += w
        date_weights[d] += w
        date_event_count[d] += 1

    first_date = min(event_dates)
    last_date = max(event_dates)
    all_dates = []
    d = first_date
    while d <= last_date:
        all_dates.append(d)
        d += timedelta(days=1)

    counts = [round(date_counts[d]) for d in all_dates]
    weights = [date_weights[d] / max(date_event_count[d], 1) for d in all_dates]

    return all_dates, counts, weights


if __name__ == "__main__":
    """
    Run BOCPD change-point detection on ProMED/WHO text event counts.
    Reads data/output/promed_events.json → writes data/output/text_alarms.json.

    Usage:
        python -m mosaic.detect.bocpd
    """
    import sys
    import re
    from collections import defaultdict
    from datetime import datetime
    from mosaic.store import load, save

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    print("[BOCPD] Loading ProMED/WHO events …")
    data = load("promed_events.json")
    if not data:
        print("  ✗ data/output/promed_events.json not found — run: python -m mosaic.ingest.promed")
        sys.exit(1)

    events = data.get("events", [])
    print(f"  {len(events)} events loaded")

    # Lightweight pathogen detection (mirrors the Next.js regex in promed/route.ts)
    PATHOGEN_RE = [
        (re.compile(r"\bSARS-CoV-2\b|\bCOVID-19\b|\bcoronavirus\b", re.I), "SARS-CoV-2"),
        (re.compile(r"\bmpox\b|\bmonkeypox\b", re.I),                        "mpox"),
        (re.compile(r"\bH5N1\b|\bavian influenza\b|\bbird flu\b", re.I),      "H5N1"),
        (re.compile(r"\bH5\b",                                                re.I), "H5"),
        (re.compile(r"\binfluenza\b|\bflu\b",                                 re.I), "influenza"),
        (re.compile(r"\bpoliovirus\b|\bpolio\b",                              re.I), "polio"),
        (re.compile(r"\bebola\b",                                             re.I), "ebola"),
        (re.compile(r"\bmarburg\b",                                           re.I), "marburg"),
        (re.compile(r"\bcholera\b",                                           re.I), "cholera"),
        (re.compile(r"\bdengue\b",                                            re.I), "dengue"),
        (re.compile(r"\bmeasles\b",                                           re.I), "measles"),
        (re.compile(r"\bRSV\b|\brespiratory syncytial\b",                     re.I), "RSV"),
    ]

    # Bucket events by pathogen and date
    pathogen_daily: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for ev in events:
        text = ev["title"] + " " + ev.get("body", "")[:500]
        pub_date = ev["published_at"][:10]  # YYYY-MM-DD
        for pat, name in PATHOGEN_RE:
            if pat.search(text):
                pathogen_daily[name][pub_date] += 1

    if not pathogen_daily:
        print("  ⚠ No pathogens detected in events")
        save("text_alarms.json", {"alarms": {}, "run_at": datetime.utcnow().isoformat()})
        sys.exit(0)

    results = {}
    for pathogen, daily_counts in pathogen_daily.items():
        sorted_dates = sorted(daily_counts)
        counts = [daily_counts[d] for d in sorted_dates]
        if len(counts) < 3:
            continue
        bocpd = run_bocpd(counts, mean_run_length=30)
        results[pathogen] = {
            "dates": sorted_dates,
            "counts": counts,
            "change_point_prob": bocpd.change_point_prob.tolist(),
            "cum_cp_prob": bocpd.cum_cp_prob.tolist(),
            "latest_alarm_prob": float(bocpd.cum_cp_prob[-1]),
        }
        print(f"  {pathogen:20s}  latest alarm: {bocpd.cum_cp_prob[-1]:.3f}  ({len(counts)} days)")

    save("text_alarms.json", {"alarms": results, "run_at": datetime.utcnow().isoformat()})
    print(f"\n[BOCPD] Saved {len(results)} pathogen alarm series → data/output/text_alarms.json")
