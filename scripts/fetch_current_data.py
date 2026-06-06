#!/usr/bin/env python3
"""Fetch a broader current public-data cache for the MOSAIC demo."""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "current"

WHO_DON_API = "https://cms.who.int/api/hubs/diseaseoutbreaknews"
NWSS_API = "https://data.cdc.gov/resource/2ew6-ywp6.json"

NEXTSTRAIN_DATASETS = {
    "sars-cov-2": "https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m",
    "h5n1": "https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha",
    "influenza-h3n2": "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h3n2/ha/2y",
    "influenza-h1n1": "https://nextstrain.org/charon/getDataset?prefix=seasonal-flu/h1n1pdm/ha/2y",
}


def get_json(url: str, params: dict[str, str] | None = None, token: str | None = None) -> Any:
    full_url = f"{url}?{urlencode(params)}" if params else url
    headers = {
        "Accept": "application/json",
        "User-Agent": "MOSAIC/0.1 public-current-data-fetcher",
    }
    if token:
        headers["X-App-Token"] = token
    with urlopen(Request(full_url, headers=headers), timeout=90) as response:
        return json.loads(response.read().decode("utf-8"))


def write_json(name: str, payload: Any) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / name).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def decimal_year_to_date(decimal_year: float) -> str:
    year = int(decimal_year)
    day_of_year = int((decimal_year - year) * 365.25)
    return (date(year, 1, 1) + timedelta(days=day_of_year)).isoformat()


def tree_to_snapshots(tree: dict[str, Any]) -> list[dict[str, Any]]:
    tips: list[tuple[str, str]] = []

    def visit(node: dict[str, Any]) -> None:
        children = node.get("children") or []
        if children:
            for child in children:
                visit(child)
            return
        attrs = node.get("node_attrs") or {}
        num_date = (attrs.get("num_date") or {}).get("value")
        lineage = (
            (attrs.get("pango_lineage") or {}).get("value")
            or (attrs.get("Nextclade_pango") or {}).get("value")
            or (attrs.get("clade_membership") or {}).get("value")
            or "unknown"
        )
        if isinstance(num_date, (int, float)):
            tips.append((decimal_year_to_date(float(num_date)), str(lineage)))

    visit(tree)

    by_window: dict[str, dict[str, int]] = {}
    for tip_date, lineage in tips:
        d = date.fromisoformat(tip_date)
        window_start = d - timedelta(days=d.toordinal() % 14)
        key = window_start.isoformat()
        by_window.setdefault(key, {})
        by_window[key][lineage] = by_window[key].get(lineage, 0) + 1

    snapshots = []
    for snapshot_date, counts in sorted(by_window.items()):
        total = sum(counts.values()) or 1
        snapshots.append(
            {
                "date": snapshot_date,
                "n_sequences": total,
                "frequencies": {
                    lineage: count / total
                    for lineage, count in sorted(counts.items(), key=lambda item: item[0])
                },
            }
        )
    return snapshots


def fetch_who() -> dict[str, Any]:
    data = get_json(WHO_DON_API, {"$top": "100"})
    return {
        "source_url": WHO_DON_API,
        "records": data.get("value", []) if isinstance(data, dict) else [],
    }


def fetch_nwss() -> dict[str, Any]:
    data = get_json(
        NWSS_API,
        {"$limit": "5000", "$order": "date_end DESC"},
        token=os.getenv("SOCRATA_APP_TOKEN") or None,
    )
    return {
        "source_url": NWSS_API,
        "records": data if isinstance(data, list) else [],
    }


def fetch_nextstrain() -> dict[str, Any]:
    datasets: dict[str, Any] = {}
    for pathogen, url in NEXTSTRAIN_DATASETS.items():
        try:
            data = get_json(url)
            snapshots = tree_to_snapshots(data.get("tree", {}) if isinstance(data, dict) else {})
            lineages = sorted({lineage for snap in snapshots for lineage in snap["frequencies"]})
            datasets[pathogen] = {
                "source_url": url,
                "n_snapshots": len(snapshots),
                "n_lineages": len(lineages),
                "lineages": lineages,
                "snapshots": snapshots,
            }
        except Exception as exc:
            datasets[pathogen] = {"source_url": url, "error": str(exc)}
    return datasets


def main() -> int:
    fetched_at = datetime.now(timezone.utc).isoformat()

    print("[current] fetching WHO DON")
    who = fetch_who()
    write_json("who_don_latest.json", {**who, "fetched_at": fetched_at})

    print("[current] fetching CDC NWSS")
    nwss = fetch_nwss()
    write_json("nwss_latest.json", {**nwss, "fetched_at": fetched_at})

    print("[current] fetching Nextstrain")
    nextstrain = fetch_nextstrain()
    write_json("nextstrain_lineage_snapshots.json", {
        "datasets": nextstrain,
        "fetched_at": fetched_at,
    })

    write_json(
        "source_manifest.json",
        {
            "fetched_at": fetched_at,
            "files": {
                "who_don_latest.json": {"records": len(who["records"])},
                "nwss_latest.json": {"records": len(nwss["records"])},
                "nextstrain_lineage_snapshots.json": {
                    pathogen: {
                        "n_snapshots": data.get("n_snapshots", 0),
                        "n_lineages": data.get("n_lineages", 0),
                    }
                    for pathogen, data in nextstrain.items()
                },
            },
            "note": "Current public data cache; no synthetic records.",
        },
    )
    print("[current] wrote data/current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
