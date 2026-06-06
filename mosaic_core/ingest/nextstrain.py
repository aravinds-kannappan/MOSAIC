"""
Nextstrain / Pathoplexus genomic lineage frequency data client.

Fetches lineage frequency distributions from the Nextstrain open data API.
Data is updated continuously as new sequences are deposited.

Data sources:
  - SARS-CoV-2: https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m
  - H5N1:       https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha
  - Flu H3N2:   https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h3n2/ha/2y
  - Flu H1N1:   https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h1n1pdm/ha/2y

Ref: MOSAIC paper §5.3 (Layer 2c — KL-Divergence Genomic Anomaly Scoring)
     Hadfield et al. (2018) Bioinformatics 34(23), 4121–4123
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterator

import httpx
import numpy as np

logger = logging.getLogger(__name__)

NEXTSTRAIN_DATASETS: dict[str, str] = {
    "sars-cov-2": "https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m",
    "h5n1": "https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha",
    "mpox": "https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib",
    "influenza-h3n2": "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h3n2/ha/2y",
    "influenza-h1n1": "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h1n1pdm/ha/2y",
}


@dataclass
class LineageSnapshot:
    """Lineage frequency distribution at a single timepoint (14-day window)."""
    pathogen: str
    date: date
    frequencies: dict[str, float]   # lineage -> relative frequency (sums to ~1)
    n_sequences: int                 # total sequences in window (Nt in paper)


def _decimal_year_to_date(decimal_year: float) -> date:
    """Convert Nextstrain decimal year (e.g. 2021.9) to calendar date."""
    year = int(decimal_year)
    remainder = decimal_year - year
    day_of_year = int(remainder * 365.25)
    return date(year, 1, 1) + timedelta(days=day_of_year)


def fetch_nextstrain_frequencies(
    pathogen: str = "sars-cov-2",
    timeout: float = 60.0,
) -> list[LineageSnapshot]:
    """
    Fetch tip-frequency JSON from Nextstrain and return a list of
    LineageSnapshot objects, one per pivot timepoint.

    Nextstrain Charon dataset format provides an Auspice tree. We extract tip
    dates and clade labels, then aggregate them into rolling 14-day lineage
    frequency snapshots for the JSD anomaly detector.
    """
    pathogen = pathogen.lower()
    url = NEXTSTRAIN_DATASETS.get(pathogen)
    if not url:
        raise ValueError(
            f"Unknown pathogen '{pathogen}'. Available: {list(NEXTSTRAIN_DATASETS)}"
        )

    logger.info("Fetching Nextstrain data: %s (%s)", pathogen, url)

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()

    tree = data.get("tree", {})
    clade_tips: dict[str, list[str]] = {}
    tip_dates: dict[str, list[str]] = {}

    def walk_tree(node):
        """Extract clade labels and dates from tree tips."""
        if node.get("children"):
            for child in node["children"]:
                walk_tree(child)
        else:
            clade = node.get("clade", "unknown")
            date_str = node.get("date", "")
            if clade not in clade_tips:
                clade_tips[clade] = []
            clade_tips[clade].append(date_str)
            if date_str not in tip_dates:
                tip_dates[date_str] = []
            tip_dates[date_str].append(clade)

    walk_tree(tree)
    total_tips = sum(len(v) for v in clade_tips.values())
    logger.info("Nextstrain: %d tips in %d clades", total_tips, len(clade_tips))

    if total_tips == 0:
        raise ValueError("No tips found in Nextstrain tree")

    # Build 14-day snapshots
    snapshots: list[LineageSnapshot] = []
    unique_dates = sorted([d for d in tip_dates.keys() if d and len(d) >= 10])
    if not unique_dates:
        raise ValueError("No valid dates in Nextstrain tips")

    try:
        first_date = date.fromisoformat(unique_dates[0][:10])
        last_date = date.fromisoformat(unique_dates[-1][:10])
    except (ValueError, IndexError):
        raise ValueError("Cannot parse Nextstrain tip dates")

    current = first_date
    while current <= last_date:
        window_clades: dict[str, int] = {}
        for date_str in unique_dates:
            try:
                d = date.fromisoformat(date_str[:10])
                if current <= d < current + timedelta(days=14):
                    for clade in tip_dates[date_str]:
                        window_clades[clade] = window_clades.get(clade, 0) + 1
            except ValueError:
                continue

        if window_clades:
            total = sum(window_clades.values())
            freqs = {c: cnt / total for c, cnt in window_clades.items()}
            snapshots.append(
                LineageSnapshot(
                    pathogen=pathogen,
                    date=current,
                    frequencies=freqs,
                    n_sequences=total,
                )
            )

        current = current + timedelta(days=14)

    return snapshots


def get_all_lineages(snapshots: list[LineageSnapshot]) -> list[str]:
    """Return the union of all lineage names across all snapshots, sorted."""
    return sorted({l for s in snapshots for l in s.frequencies})


def snapshots_to_matrix(
    snapshots: list[LineageSnapshot],
) -> tuple[list[date], list[str], np.ndarray]:
    """
    Convert a list of snapshots to a (dates, lineages, matrix) triple.
    matrix shape: (T, K) where T=timepoints, K=lineages.
    """
    dates = [s.date for s in snapshots]
    lineages = get_all_lineages(snapshots)
    matrix = np.zeros((len(snapshots), len(lineages)))
    lineage_idx = {l: i for i, l in enumerate(lineages)}

    for t, snap in enumerate(snapshots):
        for lineage, freq in snap.frequencies.items():
            if lineage in lineage_idx:
                matrix[t, lineage_idx[lineage]] = freq

    return dates, lineages, matrix


if __name__ == "__main__":
    """
    Fetch Nextstrain lineage frequency data and save to data/output/.

    Usage:
        python -m mosaic_core.ingest.nextstrain
        python -m mosaic_core.ingest.nextstrain --pathogens sars-cov-2 h5n1 mpox
    """
    import argparse
    import sys
    from datetime import datetime, timezone
    from mosaic_core.store import save

    parser = argparse.ArgumentParser(description="Fetch Nextstrain lineage frequencies")
    parser.add_argument("--pathogens", nargs="+",
                        default=list(NEXTSTRAIN_DATASETS.keys()),
                        help="Pathogen slugs to fetch")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    for pathogen in args.pathogens:
        print(f"\n[Nextstrain] Fetching: {pathogen} …")
        try:
            snapshots = fetch_nextstrain_frequencies(pathogen)
            _, lineages, matrix = snapshots_to_matrix(snapshots)

            payload = {
                "pathogen": pathogen,
                "n_pivots": len(snapshots),
                "n_lineages": len(lineages),
                "lineages": lineages,
                "snapshots": [
                    {
                        "date": str(s.date),
                        "frequencies": s.frequencies,
                        "n_sequences": s.n_sequences,
                    }
                    for s in snapshots
                ],
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
            filename = f"nextstrain_{pathogen}.json"
            save(filename, payload)
            print(f"  ✓ {len(snapshots)} pivots, {len(lineages)} lineages → data/output/{filename}")
        except Exception as exc:
            print(f"  ✗ Failed ({pathogen}): {exc}", file=sys.stderr)

    print("\n[Nextstrain] Done.")
