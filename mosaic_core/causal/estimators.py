"""
MOSAIC treatment-effect estimators (full tier).

Estimates the average treatment effect (ATE) of a lever on the outbreak-growth
outcome, four ways, to make confounding visible:
  - naive:         E[Y|T=1] - E[Y|T=0], unadjusted (biased under confounding)
  - g-computation: standardisation over the backdoor adjustment set
  - IPW:           inverse propensity weighting (stabilised)
  - AIPW:          augmented IPW, doubly robust

Implemented on numpy/scipy (both project dependencies). The estimators take a
treatment vector, an outcome vector, and an adjustment-covariate matrix; they do
not see the potential outcomes. Validated in tests/test_causal.py against a
cohort simulated from a known SCM.

References: Robins (1986) g-computation; Horvitz-Thompson (1952); Hernan &
Robins, Causal Inference: What If (2020).
"""

from __future__ import annotations

import numpy as np


def _design(x: np.ndarray, t: np.ndarray | None = None) -> np.ndarray:
    """Design matrix: intercept, adjustment covariates, and optionally treatment."""
    n = x.shape[0]
    mat = np.column_stack([np.ones(n), x.reshape(n, -1)])
    if t is not None:
        mat = np.column_stack([mat, t])
    return mat


def _ridge_solve(a: np.ndarray, b: np.ndarray, ridge: float) -> np.ndarray:
    k = a.shape[0]
    return np.linalg.solve(a + ridge * np.eye(k), b)


def _linear_fit(x: np.ndarray, y: np.ndarray, ridge: float = 1e-4) -> np.ndarray:
    xtx = x.T @ x
    xty = x.T @ y
    return _ridge_solve(xtx, xty, ridge)


def _logistic_fit(x: np.ndarray, t: np.ndarray, ridge: float = 1e-2, iters: int = 30) -> np.ndarray:
    """IRLS logistic regression with a small ridge for stability."""
    beta = np.zeros(x.shape[1])
    for _ in range(iters):
        eta = np.clip(x @ beta, -30, 30)
        mu = 1.0 / (1.0 + np.exp(-eta))
        w = np.clip(mu * (1 - mu), 1e-4, None)
        z = eta + (t - mu) / w
        xtwx = x.T @ (w[:, None] * x)
        xtwz = x.T @ (w * z)
        nxt = _ridge_solve(xtwx, xtwz, ridge)
        if np.max(np.abs(nxt - beta)) < 1e-8:
            beta = nxt
            break
        beta = nxt
    return beta


def _propensity(x_adj: np.ndarray, t: np.ndarray) -> np.ndarray:
    x = _design(x_adj)
    beta = _logistic_fit(x, t)
    e = 1.0 / (1.0 + np.exp(-np.clip(x @ beta, -30, 30)))
    return np.clip(e, 0.05, 0.95)


def naive_ate(t: np.ndarray, y: np.ndarray) -> float:
    return float(y[t == 1].mean() - y[t == 0].mean())


def g_computation(t: np.ndarray, y: np.ndarray, x_adj: np.ndarray) -> float:
    """Fit E[Y|T,X], predict every unit under T=1 and T=0, average the difference."""
    x = _design(x_adj, t)
    beta = _linear_fit(x, y)
    x1 = _design(x_adj, np.ones_like(t))
    x0 = _design(x_adj, np.zeros_like(t))
    return float(np.mean(x1 @ beta - x0 @ beta))


def ipw(t: np.ndarray, y: np.ndarray, x_adj: np.ndarray) -> float:
    """Stabilised (Hajek) inverse propensity weighting."""
    e = _propensity(x_adj, t)
    num1 = np.sum(t * y / e)
    den1 = np.sum(t / e)
    num0 = np.sum((1 - t) * y / (1 - e))
    den0 = np.sum((1 - t) / (1 - e))
    return float(num1 / den1 - num0 / den0)


def aipw(t: np.ndarray, y: np.ndarray, x_adj: np.ndarray) -> float:
    """Augmented IPW: doubly robust (consistent if either model is correct)."""
    e = _propensity(x_adj, t)
    x = _design(x_adj, t)
    beta = _linear_fit(x, y)
    mu1 = _design(x_adj, np.ones_like(t)) @ beta
    mu0 = _design(x_adj, np.zeros_like(t)) @ beta
    dr1 = t * (y - mu1) / e + mu1
    dr0 = (1 - t) * (y - mu0) / (1 - e) + mu0
    return float(np.mean(dr1 - dr0))


def bootstrap_ci(
    estimator,
    t: np.ndarray,
    y: np.ndarray,
    x_adj: np.ndarray,
    n_boot: int = 500,
    seed: int = 12345,
    alpha: float = 0.05,
) -> dict[str, float]:
    """Percentile bootstrap CI for an estimator, seeded for determinism."""
    rng = np.random.default_rng(seed)
    n = len(t)
    point = estimator(t, y, x_adj)
    draws = []
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        tb = t[idx]
        if tb.sum() == 0 or tb.sum() == n:
            continue
        val = estimator(tb, y[idx], x_adj[idx])
        if np.isfinite(val):
            draws.append(val)
    draws = np.sort(draws)
    lo = float(np.quantile(draws, alpha / 2)) if len(draws) else point
    hi = float(np.quantile(draws, 1 - alpha / 2)) if len(draws) else point
    return {"ate": float(point), "ci_low": lo, "ci_high": hi}


def cate(t: np.ndarray, y: np.ndarray, x_adj: np.ndarray, group: np.ndarray) -> dict[int, float]:
    """Conditional ATE by group, via g-computation within each stratum."""
    out: dict[int, float] = {}
    for g in np.unique(group):
        mask = group == g
        if t[mask].sum() in (0, mask.sum()):
            out[int(g)] = float("nan")
            continue
        out[int(g)] = g_computation(t[mask], y[mask], x_adj[mask])
    return out
