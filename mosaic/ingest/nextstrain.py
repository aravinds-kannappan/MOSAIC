"""
Nextstrain / Pathoplexus genomic lineage frequency data client.

Fetches lineage frequency distributions from the Nextstrain open data API.
Data is updated continuously as new sequences are deposited.

Data sources:
  - SARS-CoV-2: https://data.nextstrain.org/files/ncov/open/global/6m/tip-frequencies.json
  - H5N1:       https://data.nextstrain.org/files/workflows/avian-flu/h5n1/ha/tip-frequencies.json
  - Mpox:       https://data.nextstrain.org/files/workflows/mpox/clade-iib/tip-frequencies.json
  - Flu H3N2:   https://data.nextstrain.org/files/workflows/seasonal-flu/h3n2/ha/2y/tip-frequencies.json
  - Flu H1N1:   https://data.nextstrain.org/files/workflows/seasonal-flu/h1n1pdm/ha/2y/tip-frequencies.json

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
    "sars-cov-2": "https://data.nextstrain.org/files/ncov/open/global/6m/tip-frequencies.json",
    "h5n1": "https://data.nextstrain.org/files/workflows/avian-flu/h5n1/ha/tip-frequencies.json",
    "mpox": "https://data.nextstrain.org/files/workflows/mpox/clade-iib/tip-frequencies.json",
    "influenza-h3n2": "https://data.nextstrain.org/files/workflows/seasonal-flu/h3n2/ha/2y/tip-frequencies.json",
    "influenza-h1n1": "https://data.nextstrain.org/files/workflows/seasonal-flu/h1n1pdm/ha/2y/tip-frequencies.json",
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

    Nextstrain tip-frequencies.json format:
    {
      "pivots": [2021.5, 2021.6, ...],    # decimal years
      "generated_by": {...},
      "<clade_name>": [f_1, f_2, ...],    # frequency at each pivot
      ...
    }
    """
    pathogen = pathogen.lower()
    url = NEXTSTRAIN_DATASETS.get(pathogen)
    if not url:
        raise ValueError(
            f"Unknown pathogen '{pathogen}'. Available: {list(NEXTSTRAIN_DATASETS)}"
        )

    logger.info("Fetching Nextstrain frequencies: %s (%s)", pathogen, url)

    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(url, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()

    pivots: list[float] = data.pop("pivots", [])
    data.pop("generated_by", None)
    data.pop("counts", None)

    if not pivots:
        raise ValueError("Nextstrain response missing 'pivots' key")

    # Each remaining key is a clade with a frequency array parallel to pivots
    clades = {k: v for k, v in data.items() if isinstance(v, list) and len(v) == len(pivots)}
    logger.info("Nextstrain: %d pivots, %d clades", len(pivots), len(clades))

    snapshots: list[LineageSnapshot] = []
    for i, pivot in enumerate(pivots):
        freq_at_pivot = {clade: float(freqs[i]) for clade, freqs in clades.items()}
        # Normalise so frequencies sum to 1
        total = sum(freq_at_pivot.values())
        if total > 0:
            freq_at_pivot = {k: v / total for k, v in freq_at_pivot.items()}

        # Approximate sequence count from max frequency stability
        # (Nextstrain doesn't always expose raw counts in tip-frequencies)
        n_seq = max(10, int(1 / max(freq_at_pivot.values(), default=1.0)))

        snapshots.append(
            LineageSnapshot(
                pathogen=pathogen,
                date=_decimal_year_to_date(pivot),
                frequencies=freq_at_pivot,
                n_sequences=n_seq,
            )
        )

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
