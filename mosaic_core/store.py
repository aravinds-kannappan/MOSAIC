"""
MOSAIC data store — JSON file persistence layer.

All pipeline outputs are written to data/output/ as JSON files.
The FastAPI backend reads from these files to serve the dashboard.

File layout:
  data/output/
    nwss_{pathogen}.json          raw NWSS rows + BEAST change-point probs
    nextstrain_{pathogen}.json    Nextstrain frequencies + JSD anomaly scores
    promed_events.json            ProMED RSS + WHO DON events (last 30 days)
    text_alarms.json              BOCPD results per pathogen
    genomic_alarms.json           KL-divergence results per pathogen
    wastewater_alarms.json        BEAST/BOCPD results per pathogen
    alerts.json                   fused alert feed (final dashboard output)
    pipeline_run.json             last pipeline run metadata
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).parent.parent / "data" / "output"


def _ensure_output_dir() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _path(name: str) -> Path:
    return OUTPUT_DIR / name


def _default_serialiser(obj: Any) -> Any:
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if hasattr(obj, "tolist"):        # numpy arrays
        return obj.tolist()
    if hasattr(obj, "__float__"):     # numpy scalars
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serialisable")


def save(name: str, data: Any) -> Path:
    """Serialise data to data/output/{name}.json."""
    _ensure_output_dir()
    path = _path(name)
    path.write_text(
        json.dumps(data, indent=2, default=_default_serialiser),
        encoding="utf-8",
    )
    logger.info("Saved → %s (%d bytes)", path, path.stat().st_size)
    return path


def load(name: str) -> Any | None:
    """Load data/output/{name}.json, returning None if missing."""
    path = _path(name)
    if not path.exists():
        logger.debug("Store miss: %s", path)
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def exists(name: str) -> bool:
    return _path(name).exists()


def list_files() -> list[str]:
    if not OUTPUT_DIR.exists():
        return []
    return sorted(p.name for p in OUTPUT_DIR.glob("*.json"))
