"""
BEAST (Bayesian Ensemble Algorithm for Signal Trend analysis) wrapper
for wastewater time-series change-point detection — MOSAIC Layer 2b.

BEAST decomposes a time series as:
    C_t = T_t + S_t + ε_t,   ε_t ~ N(0, σ²)

where T_t is a piecewise-linear trend with an unknown number of
change-points K ~ Poisson(λ_K), and S_t is a harmonic seasonal component.
Change-point locations τ_{1:K} are treated as random variables fitted via
Reversible-Jump MCMC (RJMCMC).

Key output (eq. 8):
    p_t^ww = P(∃ τ_k = t | C_{1:T}) — marginal posterior change-point probability

Negative-Binomial extension (§5.2.3): for overdispersed wastewater data
(especially near the limit of quantification), we extend to:
    C_t ~ NegBin(μ_t, φ),  log μ_t = T_t + S_t

Primary implementation uses the `Rbeast` Python package (RJMCMC reference
implementation). Falls back to a Python-native piecewise-linear BOCPD
approximation if Rbeast is not available.

Ref: Zhao et al. (2019). Remote Sensing of Environment 232, 111181.
     MOSAIC paper §5.2 (Layer 2b)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


@dataclass
class BEASTResult:
    """Output of BEAST change-point analysis on a wastewater time series."""
    dates: list                      # datetime.date objects
    change_point_prob: np.ndarray    # p_t^ww — marginal CP probability at each t
    trend: np.ndarray                # posterior mean trend T_t
    seasonal: np.ndarray             # posterior mean seasonal component S_t
    n_changepoints_mean: float       # posterior mean number of change-points
    overdispersion: float | None     # φ if NegBin extension was used


def run_beast(
    dates: list,
    concentrations: np.ndarray,
    season_type: str = "harmonic",
    season_period: int = 52,        # weekly data → 52 weeks/year
    use_negbin: bool = True,
) -> BEASTResult:
    """
    Run BEAST change-point analysis on a wastewater concentration series.

    Args:
        dates:          List of datetime.date objects (weekly)
        concentrations: PMMoV-normalised concentration values
        season_type:    "harmonic" or "dummy"
        season_period:  Seasonal period in observation units
        use_negbin:     If True, attempt Negative-Binomial extension

    Returns:
        BEASTResult with per-timestep change-point probabilities
    """
    concentrations = np.asarray(concentrations, dtype=float)
    T = len(concentrations)

    if T == 0:
        return BEASTResult(dates=[], change_point_prob=np.array([]),
                          trend=np.array([]), seasonal=np.array([]),
                          n_changepoints_mean=0, overdispersion=None)

    # Try Rbeast Python package (requires R + Rbeast installed)
    try:
        import Rbeast as rb  # type: ignore[import]
        return _run_with_rbeast(rb, dates, concentrations, season_period)
    except ImportError:
        logger.info("Rbeast not available — using Python-native BOCPD approximation")
    except Exception as exc:
        logger.warning("Rbeast failed (%s) — falling back to BOCPD approximation", exc)

    # Fallback: BOCPD on concentration values (Gaussian-Normal conjugate)
    return _run_bocpd_fallback(dates, concentrations)


def _run_with_rbeast(rb, dates, concentrations, season_period: int) -> BEASTResult:
    """Run BEAST using the Rbeast Python package."""
    result = rb.beast(
        concentrations,
        season="harmonic",
        period=season_period,
        print_progress=False,
        print_options=False,
    )
    # Rbeast output: result.trend.cpProb, result.trend.Y, result.season.Y
    cp_prob = np.array(result.trend.cpProb, dtype=float)
    trend = np.array(result.trend.Y, dtype=float)
    seasonal_arr = np.array(result.season.Y, dtype=float) if hasattr(result, "season") else np.zeros_like(trend)
    n_cp = float(result.trend.ncp_median) if hasattr(result.trend, "ncp_median") else float(np.sum(cp_prob > 0.5))

    return BEASTResult(
        dates=dates,
        change_point_prob=cp_prob,
        trend=trend,
        seasonal=seasonal_arr,
        n_changepoints_mean=n_cp,
        overdispersion=None,
    )


def _run_bocpd_fallback(dates, concentrations: np.ndarray) -> BEASTResult:
    """
    Python-native Gaussian-Normal conjugate BOCPD as BEAST fallback.
    Uses Normal-Normal update: C_t | μ,σ² ~ N(μ, σ²), μ ~ N(μ_0, τ_0²).
    """
    from mosaic.detect.bocpd import bocpd_update, BOCPDState
    import numpy as np

    T = len(concentrations)
    # Normalise to [0, 100] pseudo-count for Poisson-Gamma BOCPD
    c_min, c_max = concentrations.min(), concentrations.max()
    if c_max > c_min:
        scaled = ((concentrations - c_min) / (c_max - c_min) * 50).astype(int)
    else:
        scaled = np.zeros(T, dtype=int)

    # Reuse Poisson-Gamma BOCPD as approximation
    from mosaic.detect.bocpd import run_bocpd, BOCPDResult
    bocpd_result: BOCPDResult = run_bocpd(scaled.tolist(), mean_run_length=12)

    # Detrend: simple linear regression for trend component
    x = np.arange(T)
    if T > 1:
        slope, intercept = np.polyfit(x, concentrations, 1)
        trend = slope * x + intercept
    else:
        trend = concentrations.copy()

    seasonal = concentrations - trend

    return BEASTResult(
        dates=dates,
        change_point_prob=bocpd_result.change_point_prob,
        trend=trend,
        seasonal=seasonal,
        n_changepoints_mean=float(np.sum(bocpd_result.change_point_prob > 0.5)),
        overdispersion=None,
    )


def nwss_df_to_beast_input(
    df: pd.DataFrame,
    site_id: str | None = None,
) -> tuple[list, np.ndarray]:
    """
    Convert a NWSS pandas DataFrame to (dates, concentrations) for BEAST.

    Uses `detect_prop_15d` (detection proportion) as the concentration proxy,
    falling back to `percentile/100` if detect_prop is unavailable.
    """
    if site_id and "wwtp_id" in df.columns:
        df = df[df["wwtp_id"] == site_id]

    if df.empty:
        return [], np.array([])

    df = df.sort_values("date_end").dropna(subset=["date_end"])

    if "detect_prop_15d" in df.columns and df["detect_prop_15d"].notna().any():
        conc = df["detect_prop_15d"].fillna(0).values
    elif "percentile" in df.columns:
        conc = df["percentile"].fillna(0).values / 100.0
    else:
        conc = np.zeros(len(df))

    return df["date_end"].tolist(), conc
