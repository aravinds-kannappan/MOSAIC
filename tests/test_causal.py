"""Tests for the causal-inference layer: graph, SCM, and estimators.

The headline check is self-validation: on a cohort simulated from a known
structural causal model with built-in confounding, the adjusted estimators
(g-computation, IPW, AIPW) recover the true ATE, the naive estimator is biased,
and adding a descendant of the outcome as a control reintroduces bias.
"""

import numpy as np
import pytest

from mosaic_core.causal.graph import mosaic_dag, OUTCOME
from mosaic_core.causal.scm import StructuralCausalModel
from mosaic_core.causal.estimators import (
    naive_ate, g_computation, ipw, aipw, bootstrap_ci, cate,
)
from mosaic_core.causal.report import causal_report


# ------------------------------- graph --------------------------------

def test_graph_is_acyclic():
    g = mosaic_dag()
    assert g.verify_acyclic(), "the MOSAIC DAG must be acyclic"


def test_ancestors_and_descendants():
    g = mosaic_dag()
    # wastewater is downstream of Rt via transmission
    assert "Rt" in g.ancestors("wastewater")
    assert "wastewater" in g.descendants("Rt")
    # immunity is not a descendant of anything measured downstream
    assert "wastewater" not in g.ancestors("immunity")


def test_backdoor_adjustment_set_immunity():
    g = mosaic_dag()
    adj = g.backdoor_adjustment_set("immunity", OUTCOME)
    # region blocks the only backdoor path immunity <- region -> climate -> Rt
    assert "region" in adj
    # a descendant of the treatment/outcome must never be in the set
    assert "wastewater" not in adj and "icu" not in adj


def test_backdoor_adjustment_blocks_all_paths():
    g = mosaic_dag()
    adj = set(g.backdoor_adjustment_set("immunity", OUTCOME))
    paths = g.backdoor_paths("immunity", OUTCOME)
    assert len(paths) >= 1
    for p in paths:
        assert g._path_blocked(p, adj), f"backdoor path {p} not blocked by {adj}"


def test_d_separation_collider():
    g = mosaic_dag()
    # region and season-like climate both feed Rt; conditioning on a descendant
    # of Rt opens a path. Check the collider logic directly:
    # immunity and mobility are marginally d-separated (no common cause / collider path open)
    assert g.d_separated("immunity", "mobility", set())
    # conditioning on the common child Rt opens the collider path immunity -> Rt <- mobility
    assert not g.d_separated("immunity", "mobility", {"Rt"})


def test_bad_controls_are_descendants():
    g = mosaic_dag()
    bad = set(g.bad_controls("immunity", OUTCOME))
    for node in ("wastewater", "clinical", "positivity", "icu", "genomic_jsd"):
        assert node in bad, f"{node} should be flagged as a bad control"
    assert "region" not in bad and "climate" not in bad


# -------------------------------- SCM ---------------------------------

def test_do_immunity_lowers_growth():
    scm = StructuralCausalModel()
    cov = {"climate": 55, "immunity": 55, "mobility": 55, "variant": 5, "npi": 0}
    resid = scm.abduct_residual(cov, observed_rt=1.1)
    low = scm.do(cov, resid, {"immunity": 50})["p_outbreak"]
    high = scm.do(cov, resid, {"immunity": 90})["p_outbreak"]
    assert high < low, "raising immunity must lower P(Rt>1)"


def test_counterfactual_reproduces_observed_at_null():
    scm = StructuralCausalModel()
    cov = {"climate": 60, "immunity": 70, "mobility": 40, "variant": 3, "npi": 0}
    cf = scm.counterfactual(cov, observed_rt=1.15, interventions={})
    assert abs(cf["delta"]) < 1e-9
    assert cf["rt_observed"] == pytest.approx(1.15, abs=1e-6)


def test_npi_lowers_growth():
    scm = StructuralCausalModel()
    cov = {"climate": 60, "immunity": 60, "mobility": 60, "variant": 8, "npi": 0}
    cf = scm.counterfactual(cov, observed_rt=1.2, interventions={"npi": 0.6})
    assert cf["delta"] < 0, "an NPI must lower P(Rt>1)"


def test_potential_outcomes_sign():
    scm = StructuralCausalModel()
    cov = {"climate": 50, "immunity": 65, "mobility": 50, "variant": 0, "npi": 0}
    po = scm.potential_outcomes(cov, residual=0.0, key="immunity", control=50, treated=80)
    assert po["ite"] < 0
    assert po["y1"] < po["y0"]


# ---------------------- estimators (self-validation) -------------------

def test_adjusted_estimators_recover_true_ate():
    """g-computation and AIPW recover the SCM's true ATE within tolerance."""
    scm = StructuralCausalModel()
    sim = scm.simulate(n=2000, seed=7, tau=-0.14)
    t, y, c, region = sim["t"], sim["y"], sim["c"], sim["region"]
    true_ate = sim["true_ate"][0]
    x = np.column_stack([c, region])

    g = g_computation(t, y, x)
    a = aipw(t, y, x)
    i = ipw(t, y, x)
    assert abs(g - true_ate) < 0.03, f"g-computation {g:.3f} vs truth {true_ate:.3f}"
    assert abs(a - true_ate) < 0.03, f"AIPW {a:.3f} vs truth {true_ate:.3f}"
    assert abs(i - true_ate) < 0.05, f"IPW {i:.3f} vs truth {true_ate:.3f}"


def test_naive_estimator_is_biased():
    """Under confounding, the naive contrast is biased away from the truth,
    and the adjusted estimators are closer."""
    scm = StructuralCausalModel()
    sim = scm.simulate(n=2000, seed=11, tau=-0.14)
    t, y, c, region = sim["t"], sim["y"], sim["c"], sim["region"]
    true_ate = sim["true_ate"][0]
    x = np.column_stack([c, region])

    naive = naive_ate(t, y)
    adjusted = aipw(t, y, x)
    assert abs(naive - true_ate) > 0.03, "naive estimate should be visibly biased"
    assert abs(adjusted - true_ate) < abs(naive - true_ate), "adjustment should reduce bias"


def test_bad_control_reintroduces_bias():
    """Adding a descendant of the outcome to the adjustment set biases g-comp."""
    scm = StructuralCausalModel()
    sim = scm.simulate(n=2000, seed=13, tau=-0.14)
    t, y, c, region, desc = sim["t"], sim["y"], sim["c"], sim["region"], sim["descendant"]
    true_ate = sim["true_ate"][0]

    x_good = np.column_stack([c, region])
    x_bad = np.column_stack([c, region, desc])
    good = g_computation(t, y, x_good)
    bad = g_computation(t, y, x_bad)
    assert abs(good - true_ate) < 0.03
    assert abs(bad - true_ate) > abs(good - true_ate), "the bad control should worsen the estimate"


def test_bootstrap_ci_covers_truth_for_adjusted():
    scm = StructuralCausalModel()
    sim = scm.simulate(n=1500, seed=3, tau=-0.14)
    t, y, c, region = sim["t"], sim["y"], sim["c"], sim["region"]
    true_ate = sim["true_ate"][0]
    x = np.column_stack([c, region])
    res = bootstrap_ci(aipw, t, y, x, n_boot=300, seed=5)
    assert res["ci_low"] <= true_ate <= res["ci_high"], (
        f"CI [{res['ci_low']:.3f}, {res['ci_high']:.3f}] should cover truth {true_ate:.3f}"
    )


def test_cate_varies_across_strata():
    scm = StructuralCausalModel()
    sim = scm.simulate(n=2000, seed=9, tau=-0.14)
    t, y, c, region = sim["t"], sim["y"], sim["c"], sim["region"]
    x = np.column_stack([c, region])
    tertile = np.digitize(c, np.quantile(c, [1 / 3, 2 / 3]))
    out = cate(t, y, x, tertile)
    assert len(out) == 3
    assert all(np.isfinite(v) for v in out.values())


# ------------------------------- report -------------------------------

def test_causal_report_shape_and_determinism():
    r1 = causal_report(do_immunity=80, do_npi=0.5, seed=42, n=300)
    r2 = causal_report(do_immunity=80, do_npi=0.5, seed=42, n=300)
    assert r1["identification"]["treatment"] == "immunity"
    assert "region" in r1["identification"]["adjustment_set"]
    assert r1["effects"]["true_ate"] == r2["effects"]["true_ate"], "report must be deterministic"
    # intervention lowers growth
    assert r1["counterfactual"]["delta"] < 0
