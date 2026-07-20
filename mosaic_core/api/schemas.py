"""Pydantic response models for the MOSAIC REST API."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class StreamContributions(BaseModel):
    text_stream: float = Field(ge=0, le=1)
    wastewater_stream: float = Field(ge=0, le=1)
    genomic_stream: float = Field(ge=0, le=1)


class SourceLinks(BaseModel):
    promed_post: str | None = None
    nwss_site: str | None = None
    nextstrain: str | None = None


class OutbreakProbabilityResponse(BaseModel):
    """Response from GET /api/v1/outbreak-probability"""
    pathogen: str
    location: str
    date: date
    r_t_median: float
    r_t_ci_lower: float
    r_t_ci_upper: float
    p_outbreak: float = Field(ge=0, le=1, description="P(R_t > 1)")
    alert_level: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    stream_contributions: StreamContributions
    last_updated: datetime
    source_links: SourceLinks
    inference_method: Literal["nuts", "advi", "lightweight-js"]
    r_hat: float | None = None
    n_divergences: int | None = None


class AlertResponse(BaseModel):
    """Single alert in the alert feed."""
    id: str
    pathogen: str
    location: str
    location_country: str
    p_outbreak: float
    r_t_median: float
    r_t_ci_lower: float
    r_t_ci_upper: float
    alert_level: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    stream_contributions: StreamContributions
    last_updated: datetime
    source_links: SourceLinks
    novelty_flag: bool


class AlertFeedResponse(BaseModel):
    """Response from GET /api/v1/alerts"""
    alerts: list[AlertResponse]
    meta: dict


class SignalPoint(BaseModel):
    """A single time-indexed signal data point."""
    date: date
    p_outbreak: float
    p_outbreak_lower: float
    p_outbreak_upper: float
    r_t_median: float | None
    r_t_ci_lower: float | None
    r_t_ci_upper: float | None
    p_text: float
    p_wastewater: float
    p_genomic: float
    contrib_text: float
    contrib_wastewater: float
    contrib_genomic: float


class SignalExplorerResponse(BaseModel):
    """Response from GET /api/v1/signals"""
    pathogen: str
    location: str
    date_range: tuple[date, date]
    signals: list[SignalPoint]
    who_don_date: date | None = None
    mosaic_alert_date: date | None = None
    lead_time_days: int | None = None
    meta: dict


class CalibrationBinResponse(BaseModel):
    bin_center: float
    predicted_prob: float
    observed_freq: float
    count: int


class CalibrationResponse(BaseModel):
    """Response from GET /api/v1/calibration"""
    bins: list[CalibrationBinResponse]
    ece: float
    sharpness: float
    resolution: float
    last_updated: datetime
    n_observations: int


class NWSSResponse(BaseModel):
    """Response from GET /api/v1/nwss"""
    sites: list[dict]
    meta: dict


class NextstrainResponse(BaseModel):
    """Response from GET /api/v1/nextstrain"""
    pathogen: str
    latestDate: str
    latestJsd: float
    genomicAlarmProb: float
    topShiftingLineages: list[dict]
    topCirculatingLineages: list[dict]
    anomalyTimeSeries: list[dict]
    meta: dict


class ATEEstimate(BaseModel):
    """A single treatment-effect estimate with a bootstrap CI (on P(Rt>1))."""
    ate: float
    ci_low: float
    ci_high: float


class CausalIdentification(BaseModel):
    treatment: str
    outcome: str
    adjustment_set: list[str]
    bad_controls: list[str]
    n_backdoor_paths: int


class CausalResponse(BaseModel):
    """Response from GET /api/v1/causal.

    Outputs are model-implied under an explicitly assumed structural causal
    model, not learned from interventional data.
    """
    graph: dict
    identification: CausalIdentification
    params: dict
    effects: dict
    counterfactual: dict
    assumptions_note: str
    meta: dict | None = None
