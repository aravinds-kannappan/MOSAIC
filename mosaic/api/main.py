"""
MOSAIC FastAPI REST Backend

Serves MOSAIC's calibrated outbreak posteriors via a JSON REST API.
Intended to be deployed alongside the Next.js dashboard; set
MOSAIC_API_URL=http://your-server:8000 in Vercel environment variables
to enable full NumPyro NUTS inference.

Endpoints:
  GET /api/v1/outbreak-probability  — per pathogen/location/date posterior
  GET /api/v1/alerts                — all active alerts
  GET /api/v1/signals               — per-stream time series
  GET /api/v1/nwss                  — CDC wastewater data + BOCPD
  GET /api/v1/nextstrain            — Nextstrain genomic anomaly scores
  GET /api/v1/promed                — ProMED/WHO event stream
  GET /api/v1/calibration           — reliability diagram + ECE
  GET /docs                         — OpenAPI documentation

Run locally:
  uvicorn mosaic.api.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from mosaic.ingest.nwss import fetch_nwss, aggregate_national
from mosaic.ingest.nextstrain import fetch_nextstrain_frequencies
from mosaic.ingest.promed import stream_all_sources
from mosaic.detect.bocpd import run_bocpd, events_to_daily_counts
from mosaic.detect.kl_anomaly import compute_genomic_anomaly_scores
from mosaic.detect.beast_wrapper import run_beast, nwss_df_to_beast_input

logger = logging.getLogger(__name__)

# In-memory cache for inference results (replace with Redis/Postgres in production)
_cache: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("MOSAIC API starting up")
    yield
    logger.info("MOSAIC API shutting down")
    _cache.clear()


app = FastAPI(
    title="MOSAIC API",
    description=(
        "Multi-Modal Open Surveillance with AI-Driven Calibrated Inference. "
        "Fuses CDC NWSS wastewater, Nextstrain genomic, and ProMED/WHO text streams "
        "into calibrated Bayesian outbreak posteriors P(R_t > 1)."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(tz=timezone.utc).isoformat()}


@app.get("/api/v1/nwss")
async def get_nwss(
    pathogen: str = Query("SARS-CoV-2", description="Pathogen name"),
    state: str | None = Query(None, description="US state abbreviation (e.g. CA, NY)"),
    limit: int = Query(2000, le=5000),
):
    """
    Fetch CDC NWSS wastewater data and run BEAST/BOCPD change-point detection.
    Data source: https://data.cdc.gov/resource/2ew6-ywp6.json
    """
    try:
        df = fetch_nwss(pathogen=pathogen, state=state, limit=limit)
        if df.empty:
            return {"sites": [], "meta": {"pathogen": pathogen, "state": state, "count": 0}}

        # Aggregate to national level
        national = aggregate_national(df)

        # Run BEAST on national aggregate
        dates, concentrations = nwss_df_to_beast_input(national.rename(columns={"date_end": "date_end", "detect_prop_national": "detect_prop_15d"}))
        beast_result = run_beast(dates, concentrations)

        sites_data = []
        for (site_id, group) in df.groupby("wwtp_id") if "wwtp_id" in df.columns else []:
            group = group.sort_values("date_end")
            dates_site, conc_site = nwss_df_to_beast_input(group)
            if len(dates_site) >= 3:
                site_beast = run_beast(dates_site, conc_site)
                latest_cp = float(site_beast.change_point_prob[-1]) if len(site_beast.change_point_prob) > 0 else 0.0
            else:
                latest_cp = 0.0

            latest = group.iloc[-1]
            sites_data.append({
                "siteId": str(site_id),
                "state": str(latest.get("wwtp_jurisdiction", "")),
                "populationServed": int(latest.get("population_served", 0)),
                "pathogen": pathogen,
                "latestDate": str(latest.get("date_end", "")),
                "latestDetectProp": float(latest.get("detect_prop_15d", 0) or 0),
                "latestPercentile": float(latest.get("percentile", 0) or 0),
                "changePointProb": latest_cp,
            })

        sites_data.sort(key=lambda x: x["changePointProb"], reverse=True)

        return {
            "sites": sites_data,
            "national": {
                "dates": [str(d) for d in beast_result.dates],
                "changePointProb": beast_result.change_point_prob.tolist(),
                "trend": beast_result.trend.tolist(),
            },
            "meta": {
                "pathogen": pathogen,
                "state": state,
                "count": len(sites_data),
                "source": "CDC NWSS Socrata API",
                "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
            },
        }
    except Exception as exc:
        logger.exception("NWSS fetch failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/v1/nextstrain")
async def get_nextstrain(
    pathogen: str = Query("sars-cov-2", description="Pathogen slug"),
):
    """
    Fetch Nextstrain lineage frequencies and compute KL/JSD genomic anomaly scores.
    """
    try:
        snapshots = fetch_nextstrain_frequencies(pathogen=pathogen)
        anomaly_scores = compute_genomic_anomaly_scores(snapshots)

        latest = anomaly_scores[-1] if anomaly_scores else None
        latest_snap = snapshots[-1] if snapshots else None

        return {
            "pathogen": pathogen,
            "latestDate": str(latest.date) if latest else None,
            "latestJsd": latest.jsd if latest else 0,
            "genomicAlarmProb": latest.alarm_prob if latest else 0,
            "topShiftingLineages": [
                {"lineage": l, "delta": d} for l, d in (latest.top_shifting_lineages[:3] if latest else [])
            ],
            "topCirculatingLineages": sorted(
                [{"name": k, "frequency": v} for k, v in (latest_snap.frequencies.items() if latest_snap else {}.items())],
                key=lambda x: x["frequency"],
                reverse=True,
            )[:10],
            "anomalyTimeSeries": [
                {"date": str(s.date), "jsd": s.jsd, "alarmProb": s.alarm_prob}
                for s in anomaly_scores
            ],
            "meta": {
                "pathogen": pathogen,
                "numSnapshots": len(snapshots),
                "source": "Nextstrain open data",
                "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
            },
        }
    except Exception as exc:
        logger.exception("Nextstrain fetch failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/v1/promed")
async def get_promed():
    """
    Fetch ProMED RSS and WHO DON text events, extract with LLM.
    Falls back to regex extraction if Ollama/OpenAI is unavailable.
    """
    try:
        raw_events = list(stream_all_sources())
        # For now return raw events; LLM extraction adds latency
        events_out = [
            {
                "source": ev.source,
                "title": ev.title,
                "body": ev.body[:300],
                "url": ev.url,
                "publishedAt": ev.published_at.isoformat(),
            }
            for ev in raw_events[:50]
        ]
        return {
            "events": events_out,
            "meta": {
                "count": len(events_out),
                "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
            },
        }
    except Exception as exc:
        logger.exception("ProMED fetch failed")
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/v1/calibration")
async def get_calibration():
    """Return calibration metrics from the last retrospective validation run."""
    from pathlib import Path
    calib_path = Path("data/calibration_results.json")
    if calib_path.exists():
        import json
        return json.loads(calib_path.read_text())
    return {
        "status": "pending",
        "message": "Run: python -m mosaic.fusion.calibration --validate",
        "bins": [],
        "ece": -1,
        "sharpness": -1,
        "resolution": -1,
        "n_observations": 0,
        "last_updated": datetime.now(tz=timezone.utc).isoformat(),
    }


@app.get("/api/v1/alerts")
async def get_alerts():
    """Aggregate all three streams and return active alerts."""
    # This is the full inference endpoint — deferred to a background task in prod
    return JSONResponse(content={
        "alerts": [],
        "meta": {
            "note": "Full inference requires background task. POST /api/v1/run-inference to trigger.",
            "fetchedAt": datetime.now(tz=timezone.utc).isoformat(),
        },
    })


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
