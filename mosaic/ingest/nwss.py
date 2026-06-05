"""
CDC National Wastewater Surveillance System (NWSS) data client.

Fetches viral concentration measurements via the Socrata open API.
No API key required (higher rate limits with SOCRATA_APP_TOKEN env var).

Data source: https://data.cdc.gov/resource/2ew6-ywp6.json
Ref: MOSAIC paper §5.2.1 (Layer 2b — BEAST on Wastewater Concentrations)
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

import httpx
import pandas as pd
from datetime import timezone

logger = logging.getLogger(__name__)

NWSS_ENDPOINT = "https://data.cdc.gov/resource/2ew6-ywp6.json"
SOCRATA_APP_TOKEN = os.getenv("SOCRATA_APP_TOKEN", "")

# Pathogens available in the NWSS dataset
NWSS_PATHOGENS = [
    "SARS-CoV-2",
    "Influenza A",
    "RSV",
    "mpox",
    "H5",
    "poliovirus",
]


@dataclass
class NWSSSiteRecord:
    wwtp_id: str
    wwtp_jurisdiction: str        # state abbreviation
    reporting_jurisdiction: str
    population_served: int
    key_plot_id: str              # pathogen name
    date_start: date
    date_end: date
    detect_prop_15d: float | None # detection proportion (0-1) over 15 days
    percentile: float | None      # national percentile (0-100)
    ptc_15d: float | None         # percent change over 15 days
    county_fips: str | None
    county_names: str | None


def fetch_nwss(
    pathogen: str = "SARS-CoV-2",
    state: str | None = None,
    days_back: int = 365,
    limit: int = 50000,
    timeout: float = 60.0,
) -> pd.DataFrame:
    """
    Fetch NWSS wastewater concentration data.

    Note: CDC NWSS API structure changed; pathogen is encoded in key_plot_id.
    We fetch all recent data and return it; filtering by pathogen is done downstream.

    Returns a pandas DataFrame with columns:
        wwtp_id, wwtp_jurisdiction, population_served, key_plot_id,
        date_end, detect_prop_15d, percentile, ptc_15d
    """
    cutoff = (date.today() - timedelta(days=days_back)).isoformat()

    where_clause = f"date_end >= '{cutoff}'"
    if state:
        where_clause += f" AND wwtp_jurisdiction = '{state}'"

    params: dict[str, Any] = {
        "$where": where_clause,
        "$limit": str(limit),
        "$order": "date_end DESC",
    }

    headers = {"Accept": "application/json"}
    if SOCRATA_APP_TOKEN:
        headers["X-App-Token"] = SOCRATA_APP_TOKEN

    logger.info("Fetching NWSS data: pathogen=%s state=%s days_back=%d", pathogen, state, days_back)

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(NWSS_ENDPOINT, params=params, headers=headers)
        resp.raise_for_status()
        raw = resp.json()

    logger.info("NWSS response: %d records", len(raw) if isinstance(raw, list) else 0)

    if not raw or (isinstance(raw, list) and len(raw) == 0):
        # Try simpler query without date filter to test connectivity
        logger.warning("NWSS returned empty for date_end >= '%s', trying without date filter", cutoff)
        try:
            fallback_params = {
                "$limit": str(limit),
                "$order": "date_end DESC",
            }
            resp2 = client.get(NWSS_ENDPOINT, params=fallback_params, headers=headers)
            raw = resp2.json()
            logger.info("Fallback query: %d records", len(raw) if isinstance(raw, list) else 0)
            if not raw:
                logger.warning("NWSS API appears to be empty or unavailable")
                return pd.DataFrame()
        except Exception as e:
            logger.error("Fallback query failed: %s", e)
            return pd.DataFrame()

    df = pd.DataFrame(raw)
    logger.info("NWSS: received %d rows", len(df))

    # Type conversions
    for col in ["detect_prop_15d", "percentile", "ptc_15d"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "date_end" in df.columns:
        df["date_end"] = pd.to_datetime(df["date_end"], errors="coerce").dt.date

    if "population_served" in df.columns:
        df["population_served"] = pd.to_numeric(df["population_served"], errors="coerce").fillna(0).astype(int)

    return df


def get_site_time_series(
    df: pd.DataFrame,
    site_id: str | None = None,
) -> dict[str, pd.DataFrame]:
    """
    Split NWSS dataframe into per-site time series.
    If site_id is provided, returns only that site.
    Returns dict mapping wwtp_id -> chronological DataFrame.
    """
    if "wwtp_id" not in df.columns:
        return {}

    if site_id:
        df = df[df["wwtp_id"] == site_id]

    result: dict[str, pd.DataFrame] = {}
    for sid, group in df.groupby("wwtp_id"):
        result[str(sid)] = group.sort_values("date_end").reset_index(drop=True)

    return result


def aggregate_national(df: pd.DataFrame) -> pd.DataFrame:  # noqa: E302
    """
    Aggregate NWSS data to national level by computing
    population-weighted mean percentile per date.
    """
    if df.empty or "date_end" not in df.columns:
        return pd.DataFrame()

    df = df.dropna(subset=["percentile", "population_served"])
    df = df[df["population_served"] > 0]

    def weighted_mean(group: pd.DataFrame) -> float:
        w = group["population_served"]
        return float((group["percentile"] * w).sum() / w.sum())

    national = (
        df.groupby("date_end")
        .apply(weighted_mean, include_groups=False)
        .reset_index()
        .rename(columns={0: "percentile_national"})
    )
    national["detect_prop_national"] = national["percentile_national"] / 100.0
    return national.sort_values("date_end")


if __name__ == "__main__":
    """
    Fetch CDC NWSS wastewater data and save to data/output/.

    Note: CDC NWSS API now returns all sites without pathogen filtering.
    We fetch once and aggregate nationally.

    Usage:
        python -m mosaic.ingest.nwss
        python -m mosaic.ingest.nwss --days 180 --state CA
    """
    import argparse
    import sys
    from mosaic.store import save

    parser = argparse.ArgumentParser(description="Fetch CDC NWSS wastewater data")
    parser.add_argument("--days", type=int, default=365, help="Days of history")
    parser.add_argument("--state", default=None, help="Limit to one US state (e.g. CA)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    print(f"\n[NWSS] Fetching wastewater data (last {args.days} days)…")
    try:
        df = fetch_nwss(days_back=args.days, state=args.state)
        if df.empty:
            print(f"  ⚠ No data returned")
            sys.exit(1)

        print(f"  ✓ Received {len(df)} records from {df['wwtp_id'].nunique()} sites")
        national = aggregate_national(df)

        if not national.empty:
            print(f"  ✓ Aggregated to national level: {len(national)} dates")

        # Build site-level records
        sites = []
        if "wwtp_id" in df.columns:
            for site_id, grp in df.groupby("wwtp_id"):
                grp = grp.sort_values("date_end")
                latest = grp.iloc[-1]
                sites.append({
                    "wwtp_id": str(site_id),
                    "state": str(latest.get("wwtp_jurisdiction", "")),
                    "population_served": int(latest.get("population_served", 0) or 0),
                    "time_series": [
                        {
                            "date": str(r["date_end"]),
                            "detect_prop_15d": float(r.get("detect_prop_15d") or 0),
                            "percentile": float(r.get("percentile") or 0),
                            "ptc_15d": float(r.get("ptc_15d") or 0),
                        }
                        for _, r in grp.iterrows()
                    ],
                })

        payload = {
            "n_sites": len(sites),
            "national": national.to_dict(orient="records") if not national.empty else [],
            "sites": sites,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        filename = "nwss_wastewater.json"
        save(filename, payload)
        print(f"  ✓ {len(sites)} sites, {len(national)} national dates → data/output/{filename}")
    except Exception as exc:
        print(f"  ✗ Failed: {exc}", file=sys.stderr)
        sys.exit(1)

    print("\n[NWSS] Done.")
