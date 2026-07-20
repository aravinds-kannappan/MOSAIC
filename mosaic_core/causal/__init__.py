"""
MOSAIC causal-inference layer (full tier).

An explicit causal graph, an assumed structural causal model, do / counterfactual
/ potential-outcome queries, and confounding-adjusted treatment-effect estimators
(g-computation, IPW, doubly-robust AIPW). Mirrors the lite tier in
`apps/web/lib/causal/`. Outputs are model-implied under stated assumptions, not
learned from interventional data.
"""

from __future__ import annotations

from .graph import CausalGraph, Node, mosaic_dag, describe, TREATMENTS, OUTCOME
from .scm import StructuralCausalModel, StructuralParams, COVARIATE_KEYS
from .estimators import (
    naive_ate, g_computation, ipw, aipw, bootstrap_ci, cate,
)
from .report import causal_report

__all__ = [
    "CausalGraph",
    "Node",
    "mosaic_dag",
    "describe",
    "TREATMENTS",
    "OUTCOME",
    "StructuralCausalModel",
    "StructuralParams",
    "COVARIATE_KEYS",
    "naive_ate",
    "g_computation",
    "ipw",
    "aipw",
    "bootstrap_ci",
    "cate",
    "causal_report",
]
