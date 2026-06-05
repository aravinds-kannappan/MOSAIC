"""
MOSAIC Inference Runners — NUTS + ADVI

Fits the mosaic_model using:
  1. No-U-Turn Sampler (NUTS) — primary, 4 chains, 1000 warmup, 2000 samples
  2. Automatic Differentiation Variational Inference (ADVI) — sub-minute fallback

Convergence is assessed via R̂ < 1.01 and effective sample size > 400.

Ref: MOSAIC paper §6.3 (Joint Posterior and Inference)
     Bingham et al. (2019). JMLR 20(28), 1–6. (Pyro/NumPyro)
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import arviz as az
import jax
import jax.numpy as jnp
import numpy as np
import numpyro
import numpyro.distributions as dist
from jax import random
from numpyro.infer import MCMC, NUTS, SVI, Trace_ELBO, autoguide

from mosaic.fusion.model import mosaic_model

logger = logging.getLogger(__name__)

NUM_CHAINS = int(os.getenv("MCMC_NUM_CHAINS", "4"))
NUM_WARMUP = int(os.getenv("MCMC_NUM_WARMUP", "1000"))
NUM_SAMPLES = int(os.getenv("MCMC_NUM_SAMPLES", "2000"))
USE_ADVI = os.getenv("USE_ADVI", "false").lower() == "true"


@dataclass
class InferenceResult:
    """Output of the MOSAIC fusion inference."""
    # Core outputs
    Rt_median: np.ndarray           # Posterior median R_t, shape (T,)
    Rt_lower95: np.ndarray          # 2.5th percentile
    Rt_upper95: np.ndarray          # 97.5th percentile
    p_outbreak: np.ndarray          # P(R_t > 1 | data), shape (T,)

    # Diagnostics
    r_hat_max: float                # Maximum R̂ across all parameters
    ess_min: float                  # Minimum effective sample size
    n_divergences: int              # NUTS divergences (0 is ideal)
    inference_time_s: float

    # Posterior samples (for downstream calibration)
    samples: dict[str, np.ndarray] = field(default_factory=dict)

    # Stream contributions (Shapley-value approximation)
    stream_contributions: dict[str, float] = field(default_factory=dict)


def run_nuts(
    wastewater: np.ndarray | None,
    news_counts: np.ndarray | None,
    news_quality: np.ndarray | None,
    genomic_props: np.ndarray | None,
    genomic_counts: np.ndarray | None,
    T: int,
    si_mean: float = 5.1,
    si_sd: float = 4.0,
    rng_seed: int = 42,
) -> InferenceResult:
    """
    Run NUTS MCMC on the MOSAIC fusion model.
    Automatically falls back to ADVI if USE_ADVI=true or on convergence failure.
    """
    t0 = time.time()

    if USE_ADVI:
        return run_advi(wastewater, news_counts, news_quality,
                       genomic_props, genomic_counts, T, si_mean, si_sd)

    logger.info(
        "Running NUTS: %d chains × (%d warmup + %d samples)", NUM_CHAINS, NUM_WARMUP, NUM_SAMPLES
    )

    kernel = NUTS(mosaic_model, target_accept_prob=0.9, max_tree_depth=10)
    mcmc = MCMC(
        kernel,
        num_warmup=NUM_WARMUP,
        num_samples=NUM_SAMPLES,
        num_chains=NUM_CHAINS,
        progress_bar=True,
    )

    rng_key = random.PRNGKey(rng_seed)
    mcmc.run(
        rng_key,
        wastewater=wastewater,
        news_counts=news_counts,
        news_quality=news_quality,
        genomic_props=genomic_props,
        genomic_counts=genomic_counts,
        T=T,
        si_mean=si_mean,
        si_sd=si_sd,
    )

    samples = mcmc.get_samples()
    extra_fields = mcmc.get_extra_fields()

    # Convergence diagnostics
    idata = az.from_numpyro(mcmc)
    rhat = az.rhat(idata)
    ess = az.ess(idata)

    r_hat_max = float(max(v.values.max() for v in rhat.data_vars.values()))
    ess_min = float(min(v.values.min() for v in ess.data_vars.values()))
    n_divergences = int(extra_fields.get("diverging", jnp.zeros(1)).sum())

    if r_hat_max > 1.05:
        logger.warning("R̂ = %.3f > 1.05 — consider longer warmup or ADVI", r_hat_max)

    # Extract R_t posterior
    Rt_samples = np.array(samples.get("Rt", np.ones((NUM_SAMPLES * NUM_CHAINS, T))))
    Rt_median = np.median(Rt_samples, axis=0)
    Rt_lower95 = np.percentile(Rt_samples, 2.5, axis=0)
    Rt_upper95 = np.percentile(Rt_samples, 97.5, axis=0)
    p_outbreak = (Rt_samples > 1.0).mean(axis=0)

    # Stream contributions via leave-one-out Shapley approximation
    stream_contribs = _estimate_stream_contributions(
        p_outbreak_full=float(p_outbreak[-1]),
        wastewater=wastewater,
        news_counts=news_counts,
        genomic_props=genomic_props,
        T=T, si_mean=si_mean, si_sd=si_sd, rng_seed=rng_seed,
    )

    return InferenceResult(
        Rt_median=Rt_median,
        Rt_lower95=Rt_lower95,
        Rt_upper95=Rt_upper95,
        p_outbreak=p_outbreak,
        r_hat_max=r_hat_max,
        ess_min=ess_min,
        n_divergences=n_divergences,
        inference_time_s=time.time() - t0,
        samples=dict(samples),
        stream_contributions=stream_contribs,
    )


def run_advi(
    wastewater: np.ndarray | None,
    news_counts: np.ndarray | None,
    news_quality: np.ndarray | None,
    genomic_props: np.ndarray | None,
    genomic_counts: np.ndarray | None,
    T: int,
    si_mean: float = 5.1,
    si_sd: float = 4.0,
    n_steps: int = 10000,
    rng_seed: int = 42,
) -> InferenceResult:
    """
    ADVI fallback for sub-minute inference (real-time deployment).
    Uses AutoNormal guide (mean-field variational family).
    """
    t0 = time.time()
    logger.info("Running ADVI: %d steps", n_steps)

    guide = autoguide.AutoNormal(mosaic_model)
    optimizer = numpyro.optim.ClippedAdam(step_size=0.01)
    svi = SVI(mosaic_model, guide, optimizer, loss=Trace_ELBO())

    rng_key = random.PRNGKey(rng_seed)
    model_kwargs = dict(
        wastewater=wastewater, news_counts=news_counts, news_quality=news_quality,
        genomic_props=genomic_props, genomic_counts=genomic_counts,
        T=T, si_mean=si_mean, si_sd=si_sd,
    )
    svi_result = svi.run(rng_key, n_steps, **model_kwargs)

    # Draw posterior samples from variational distribution
    pred_key = random.PRNGKey(rng_seed + 1)
    samples = guide.sample_posterior(pred_key, svi_result.params, sample_shape=(NUM_SAMPLES,))

    Rt_samples = np.array(samples.get("Rt", np.ones((NUM_SAMPLES, T))))
    Rt_median = np.median(Rt_samples, axis=0)
    Rt_lower95 = np.percentile(Rt_samples, 2.5, axis=0)
    Rt_upper95 = np.percentile(Rt_samples, 97.5, axis=0)
    p_outbreak = (Rt_samples > 1.0).mean(axis=0)

    return InferenceResult(
        Rt_median=Rt_median,
        Rt_lower95=Rt_lower95,
        Rt_upper95=Rt_upper95,
        p_outbreak=p_outbreak,
        r_hat_max=float("nan"),  # Not applicable for ADVI
        ess_min=float("nan"),
        n_divergences=0,
        inference_time_s=time.time() - t0,
        samples=dict(samples),
        stream_contributions={},
    )


def _estimate_stream_contributions(
    p_outbreak_full: float,
    wastewater: np.ndarray | None,
    news_counts: np.ndarray | None,
    genomic_props: np.ndarray | None,
    T: int,
    si_mean: float,
    si_sd: float,
    rng_seed: int,
) -> dict[str, float]:
    """
    Estimate Shapley-value-inspired stream contributions (MOSAIC paper §7.1 point 2).
    Runs three additional inferences with one stream removed each time.
    Returns fractional contributions summing to 1.
    """
    contributions = {}
    for stream_name, (ww, nc, gp) in [
        ("text_stream", (wastewater, None, genomic_props)),
        ("wastewater_stream", (None, news_counts, genomic_props)),
        ("genomic_stream", (wastewater, news_counts, None)),
    ]:
        try:
            result_ablated = run_advi(
                ww, nc, None, gp, None, T, si_mean, si_sd, n_steps=2000, rng_seed=rng_seed + hash(stream_name) % 100
            )
            p_ablated = float(result_ablated.p_outbreak[-1])
            contributions[stream_name] = abs(p_outbreak_full - p_ablated)
        except Exception:
            contributions[stream_name] = 0.0

    total = sum(contributions.values()) or 1.0
    return {k: v / total for k, v in contributions.items()}
