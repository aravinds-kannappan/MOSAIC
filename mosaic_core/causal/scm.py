"""
MOSAIC structural causal model (full tier).

An explicit, ASSUMED structural model for how the drivers set the growth rate,
layered on the paper's renewal equation. There is no interventional ground truth
in open surveillance data, so the coefficients are stated assumptions, not
learned. Every output is model-implied under these assumptions.

Structural equation (log-Rt scale):
    log Rt = b0
           + b_climate  * (climate  - c_climate)
           + b_immunity * (immunity - c_immunity)
           + b_mobility * (mobility - c_mobility)
           + b_variant  * (variant  - c_variant)
           + b_npi      * npi
           + u_R
with u_R the site-specific exogenous residual recovered by abduction. do(x = v)
sets x, holds u_R fixed, and propagates to Rt and P(Rt>1).

The class also provides `simulate`, which draws a confounded observational cohort
with a known average treatment effect, used to validate the estimators.

References: Pearl, Causality (2009), ch. 7; Cori et al. (2013) EpiEstim.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.stats import norm


@dataclass
class StructuralParams:
    b0: float = 0.0
    b_climate: float = 0.003
    b_immunity: float = -0.008
    b_mobility: float = 0.002
    b_variant: float = 0.010
    b_npi: float = -0.35
    c_climate: float = 50.0
    c_immunity: float = 65.0
    c_mobility: float = 50.0
    c_variant: float = 0.0
    sigma_log_rt: float = 0.18


COVARIATE_KEYS = ("climate", "immunity", "mobility", "variant", "npi")


class StructuralCausalModel:
    """Assumed SCM for MOSAIC growth, with do / counterfactual / potential outcomes."""

    def __init__(self, params: StructuralParams | None = None) -> None:
        self.p = params or StructuralParams()

    # --------------------------- structural mean -------------------------

    def structural_log_rt(self, cov: dict[str, float]) -> float:
        p = self.p
        return (
            p.b0
            + p.b_climate * (cov.get("climate", p.c_climate) - p.c_climate)
            + p.b_immunity * (cov.get("immunity", p.c_immunity) - p.c_immunity)
            + p.b_mobility * (cov.get("mobility", p.c_mobility) - p.c_mobility)
            + p.b_variant * (cov.get("variant", p.c_variant) - p.c_variant)
            + p.b_npi * cov.get("npi", 0.0)
        )

    def p_outbreak(self, log_rt: float) -> float:
        """P(Rt > 1) = P(log Rt > 0) = Phi(log Rt / sigma)."""
        return float(np.clip(norm.cdf(log_rt / self.p.sigma_log_rt), 1e-3, 1 - 1e-3))

    # ----------------------- abduction / interventions -------------------

    def abduct_residual(self, cov: dict[str, float], observed_rt: float) -> float:
        """Recover u_R so the SCM reproduces the observed Rt."""
        return float(np.log(max(0.2, observed_rt)) - self.structural_log_rt(cov))

    def do(self, cov: dict[str, float], residual: float, interventions: dict[str, float]) -> dict[str, float]:
        """do(x = v): apply interventions, hold the residual fixed, read off Rt and P(Rt>1)."""
        cov_do = {**cov, **interventions}
        log_rt = self.structural_log_rt(cov_do) + residual
        return {"log_rt": log_rt, "rt": float(np.exp(log_rt)), "p_outbreak": self.p_outbreak(log_rt)}

    def counterfactual(
        self, cov: dict[str, float], observed_rt: float, interventions: dict[str, float]
    ) -> dict[str, float]:
        """Pearl abduction-action-prediction: reproduces observed at the null intervention."""
        u = self.abduct_residual(cov, observed_rt)
        obs = self.do(cov, u, {})
        cf = self.do(cov, u, interventions)
        return {
            "rt_observed": obs["rt"],
            "rt_counterfactual": cf["rt"],
            "p_observed": obs["p_outbreak"],
            "p_counterfactual": cf["p_outbreak"],
            "delta": cf["p_outbreak"] - obs["p_outbreak"],
        }

    def potential_outcomes(
        self, cov: dict[str, float], residual: float, key: str, control: float, treated: float
    ) -> dict[str, float]:
        """Y(0), Y(1) and the individual treatment effect for a binary treatment."""
        y0 = self.do(cov, residual, {key: control})["p_outbreak"]
        y1 = self.do(cov, residual, {key: treated})["p_outbreak"]
        return {"y0": y0, "y1": y1, "ite": y1 - y0}

    # ------------------------------- simulate ----------------------------

    def simulate(
        self,
        n: int = 400,
        seed: int = 42,
        tau: float = -0.14,
        confounding: float = 0.9,
    ) -> dict[str, np.ndarray]:
        """
        Draw a confounded observational cohort with a KNOWN average treatment
        effect, evaluated at the P(Rt>1) ~ 0.5 operating point where the SCM's
        Phi link is locally linear.

        Returns arrays: t (treatment), y (outcome), c (confounder), region (int
        code), descendant (a post-outcome variable = bad control), and the true
        ATE. Confounding: high climate raises growth AND lowers the chance of
        treatment, so the naive contrast is biased and adjustment for the
        confounder recovers `tau`.
        """
        rng = np.random.default_rng(seed)
        c = rng.normal(0.0, 1.0, n)                    # confounder (e.g. climate pressure)
        region = rng.integers(0, 6, n)                 # a categorical context
        region_effect = (region - 2.5) * 0.02
        # confounded, stochastic treatment assignment: high confounder -> less
        # likely treated. A smooth propensity gives proper overlap (positivity).
        prop = 1.0 / (1.0 + np.exp(-(confounding * (-c) - region_effect * 5)))
        t = (rng.uniform(0.0, 1.0, n) < prop).astype(float)

        base = 0.5 + 0.12 * c + region_effect + rng.normal(0.0, 0.03, n)
        y0 = np.clip(base, 0.03, 0.97)
        y1 = np.clip(base + tau, 0.03, 0.97)
        y = np.where(t == 1, y1, y0)
        true_ate = float(np.mean(y1 - y0))

        # ICU-headroom-like descendant of the outcome (post-treatment). It is a
        # fairly clean readout of growth, so conditioning on it over-controls.
        descendant = np.clip(70 - 80 * (y - 0.5) + rng.normal(0.0, 2.5, n), 5, 95)

        return {
            "t": t,
            "y": y,
            "c": c,
            "region": region.astype(float),
            "descendant": descendant,
            "y0": y0,
            "y1": y1,
            "true_ate": np.array([true_ate]),
        }
