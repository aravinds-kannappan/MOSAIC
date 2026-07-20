"""
Assemble the full causal report for the API and CLI.

Ties the graph identification, the assumed structural coefficients, the
treatment-effect estimators (naive / g-computation / IPW / AIPW against the SCM
truth, plus the bad-control contrast and CATE), and a representative
counterfactual into one serialisable dict. Deterministic given the seed.
"""

from __future__ import annotations

import numpy as np

from .graph import mosaic_dag, describe, OUTCOME
from .scm import StructuralCausalModel
from .estimators import naive_ate, g_computation, ipw, aipw, bootstrap_ci, cate


def _one_hot(region: np.ndarray) -> np.ndarray:
    levels = np.unique(region)
    return np.column_stack([(region == lv).astype(float) for lv in levels[1:]]) if len(levels) > 1 else np.zeros((len(region), 0))


def causal_report(
    do_immunity: float | None = None,
    do_mobility: float | None = None,
    do_npi: float | None = None,
    seed: int = 42,
    n: int = 400,
) -> dict:
    g = mosaic_dag()
    scm = StructuralCausalModel()
    treatment = "immunity"

    adjustment_set = g.backdoor_adjustment_set(treatment, OUTCOME)
    bad_controls = g.bad_controls(treatment, OUTCOME)
    backdoor = g.backdoor_paths(treatment, OUTCOME)

    # simulate a confounded cohort with a known ATE
    sim = scm.simulate(n=n, seed=seed)
    t, y, c, region, desc = sim["t"], sim["y"], sim["c"], sim["region"], sim["descendant"]
    true_ate = float(sim["true_ate"][0])

    x_backdoor = np.column_stack([c, _one_hot(region)])           # {climate, region}
    x_bad = np.column_stack([c, _one_hot(region), desc])          # + descendant (bad control)

    estimates = {
        "naive": bootstrap_ci(lambda tt, yy, xx: naive_ate(tt, yy), t, y, x_backdoor, seed=seed),
        "g_computation": bootstrap_ci(g_computation, t, y, x_backdoor, seed=seed),
        "ipw": bootstrap_ci(ipw, t, y, x_backdoor, seed=seed),
        "aipw": bootstrap_ci(aipw, t, y, x_backdoor, seed=seed),
    }
    bad_control = bootstrap_ci(g_computation, t, y, x_bad, seed=seed)

    # CATE by a pre-treatment confounder tertile
    tertile = np.digitize(c, np.quantile(c, [1 / 3, 2 / 3]))
    cate_by_c = cate(t, y, x_backdoor, tertile)

    # a representative per-site counterfactual under the requested interventions
    base_cov = {"climate": 60.0, "immunity": 62.0, "mobility": 55.0, "variant": 6.0, "npi": 0.0}
    interventions: dict[str, float] = {}
    if do_immunity is not None:
        interventions["immunity"] = do_immunity
    if do_mobility is not None:
        interventions["mobility"] = do_mobility
    if do_npi is not None:
        interventions["npi"] = do_npi
    cf = scm.counterfactual(base_cov, observed_rt=1.08, interventions=interventions)

    p = scm.p
    return {
        "graph": describe(g),
        "identification": {
            "treatment": treatment,
            "outcome": OUTCOME,
            "adjustment_set": adjustment_set,
            "bad_controls": bad_controls,
            "n_backdoor_paths": len(backdoor),
            "backdoor_paths": backdoor,
        },
        "params": {
            "b_immunity": p.b_immunity,
            "b_mobility": p.b_mobility,
            "b_npi": p.b_npi,
            "b_climate": p.b_climate,
            "b_variant": p.b_variant,
            "sigma_log_rt": p.sigma_log_rt,
        },
        "effects": {
            "true_ate": true_ate,
            "estimates": estimates,
            "bad_control": bad_control,
            "cate_by_climate_tertile": cate_by_c,
            "treated_share": float(t.mean()),
            "n": int(n),
        },
        "counterfactual": {
            "base_covariates": base_cov,
            "interventions": interventions,
            **cf,
        },
        "assumptions_note": (
            "Model-implied under an explicitly assumed structural causal model. The DAG and "
            "coefficients are stated assumptions, not learned from outcomes; no interventional "
            "ground truth exists in open surveillance data."
        ),
    }
