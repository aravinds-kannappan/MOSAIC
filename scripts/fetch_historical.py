#!/usr/bin/env python3
"""Fetch public retrospective validation source data for MOSAIC.

The script intentionally stores raw, provenance-rich source extracts rather than
synthetic fixtures. It keeps files small enough for GitHub by limiting each API
pull to the outbreak window used for retrospective replay.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "historical"

WHO_DON_API = "https://cms.who.int/api/hubs/diseaseoutbreaknews"
NWSS_API = "https://data.cdc.gov/resource/2ew6-ywp6.json"

NEXTSTRAIN_DATASETS = {
    "sars-cov-2": "https://nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m",
    "mpox": "https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib",
    "h5n1": "https://nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha",
}


@dataclass(frozen=True)
class Outbreak:
    slug: str
    label: str
    pathogen: str
    who_don_date: str
    window_start: str
    window_end: str
    who_keywords: tuple[str, ...]
    nwss_pathogen: str | None
    nextstrain_slug: str | None
    notes: str


OUTBREAKS = {
    "omicron_2021": Outbreak(
        slug="omicron_2021",
        label="SARS-CoV-2 Omicron emergence",
        pathogen="SARS-CoV-2",
        who_don_date="2021-11-26",
        window_start="2021-10-01",
        window_end="2021-12-31",
        who_keywords=("omicron", "B.1.1.529", "SARS-CoV-2"),
        nwss_pathogen="SARS-CoV-2",
        nextstrain_slug="sars-cov-2",
        notes="Nextstrain public 6-month tip frequencies are current-only; store provenance for replay code to select available pivots.",
    ),
    "mpox_2022": Outbreak(
        slug="mpox_2022",
        label="Mpox USA emergence",
        pathogen="mpox",
        who_don_date="2022-05-23",
        window_start="2022-04-15",
        window_end="2022-07-15",
        who_keywords=("mpox", "monkeypox"),
        nwss_pathogen="mpox",
        nextstrain_slug="mpox",
        notes="NWSS mpox coverage is sparse and may be absent in early 2022; fetches still preserve real API responses.",
    ),
    "polio_ny_2022": Outbreak(
        slug="polio_ny_2022",
        label="Poliovirus New York detection",
        pathogen="poliovirus",
        who_don_date="2022-07-21",
        window_start="2022-06-01",
        window_end="2022-08-31",
        who_keywords=("polio", "poliovirus", "New York"),
        nwss_pathogen="poliovirus",
        nextstrain_slug=None,
        notes="Public Nextstrain poliovirus lineage frequencies are not available in the same tip-frequency format.",
    ),
    "h5n1_2024": Outbreak(
        slug="h5n1_2024",
        label="H5N1 cattle USA",
        pathogen="H5N1",
        who_don_date="2024-03-25",
        window_start="2024-02-01",
        window_end="2024-05-31",
        who_keywords=("H5N1", "avian influenza", "cattle"),
        nwss_pathogen="H5",
        nextstrain_slug="h5n1",
        notes="Uses public A/H5 Nextstrain frequencies and CDC NWSS H5 rows when available.",
    ),
}


def get_json(url: str, params: dict[str, str] | None = None, token: str | None = None) -> Any:
    full_url = f"{url}?{urlencode(params)}" if params else url
    headers = {
        "Accept": "application/json",
        "User-Agent": "MOSAIC/0.1 public-data-fetcher",
    }
    if token:
        headers["X-App-Token"] = token
    req = Request(full_url, headers=headers)
    with urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def decimal_year_to_date(decimal_year: float) -> str:
    year = int(decimal_year)
    day_of_year = int((decimal_year - year) * 365.25)
    return (date(year, 1, 1) + timedelta(days=day_of_year)).isoformat()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def fetch_who_don(outbreak: Outbreak) -> list[dict[str, Any]]:
    params = {
        "$top": "100",
        "$filter": (
            f"PublicationDate ge {outbreak.window_start}T00:00:00Z "
            f"and PublicationDate le {outbreak.window_end}T23:59:59Z"
        ),
    }
    data = get_json(WHO_DON_API, params)
    items = data.get("value", []) if isinstance(data, dict) else []
    matches = []
    for item in items:
      text = " ".join(str(item.get(k, "")) for k in ("Title", "Summary", "Url")).lower()
      if any(keyword.lower() in text for keyword in outbreak.who_keywords):
          matches.append(item)
    return matches


def fetch_nwss(outbreak: Outbreak) -> list[dict[str, Any]]:
    if not outbreak.nwss_pathogen:
        return []
    where = (
        f"date_end between '{outbreak.window_start}' and '{outbreak.window_end}' "
        f"AND key_plot_id = '{outbreak.nwss_pathogen}'"
    )
    params = {
        "$limit": "5000",
        "$order": "date_end ASC",
        "$where": where,
    }
    return get_json(NWSS_API, params, token=os.getenv("SOCRATA_APP_TOKEN") or None)


def fetch_nextstrain(outbreak: Outbreak) -> dict[str, Any] | None:
    if not outbreak.nextstrain_slug:
        return None
    url = NEXTSTRAIN_DATASETS[outbreak.nextstrain_slug]
    data = get_json(url)
    if not isinstance(data, dict):
        return {"source_url": url, "raw": data}
    snapshots = nextstrain_tree_to_snapshots(data.get("tree", {}))
    lineages = sorted({lineage for snap in snapshots for lineage in snap["frequencies"]})
    meta = data.get("meta", {}) if isinstance(data.get("meta"), dict) else {}
    meta_summary = {
        key: meta.get(key)
        for key in ("updated", "build_url", "title", "maintainers")
        if key in meta
    }
    return {
        "source_url": url,
        "n_snapshots": len(snapshots),
        "n_lineages": len(lineages),
        "lineages": lineages,
        "meta": meta_summary,
        "snapshots": snapshots,
    }


def nextstrain_tree_to_snapshots(tree: dict[str, Any]) -> list[dict[str, Any]]:
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


def fetch_one(outbreak: Outbreak) -> None:
    out_dir = DATA_DIR / outbreak.slug
    fetched_at = datetime.now(timezone.utc).isoformat()
    manifest = {
        **asdict(outbreak),
        "fetched_at": fetched_at,
        "sources": {
            "who_don": WHO_DON_API,
            "nwss": NWSS_API if outbreak.nwss_pathogen else None,
            "nextstrain": NEXTSTRAIN_DATASETS.get(outbreak.nextstrain_slug or ""),
        },
        "files": {},
    }

    print(f"[{outbreak.slug}] fetching WHO DON")
    who = fetch_who_don(outbreak)
    write_json(out_dir / "who_don.json", {"records": who, "fetched_at": fetched_at})
    manifest["files"]["who_don.json"] = {"records": len(who)}

    print(f"[{outbreak.slug}] fetching CDC NWSS")
    try:
        nwss = fetch_nwss(outbreak)
    except (HTTPError, URLError, TimeoutError) as exc:
        nwss = []
        manifest["nwss_error"] = str(exc)
    write_json(out_dir / "nwss.json", {"records": nwss, "fetched_at": fetched_at})
    manifest["files"]["nwss.json"] = {"records": len(nwss)}

    if outbreak.nextstrain_slug:
        print(f"[{outbreak.slug}] fetching Nextstrain")
        try:
            nextstrain = fetch_nextstrain(outbreak)
        except (HTTPError, URLError, TimeoutError) as exc:
            nextstrain = {"error": str(exc)}
        write_json(out_dir / "nextstrain_tip_frequencies.json", {
            "data": nextstrain,
            "fetched_at": fetched_at,
        })
        manifest["files"]["nextstrain_tip_frequencies.json"] = {
            "n_snapshots": (nextstrain or {}).get("n_snapshots", 0) if isinstance(nextstrain, dict) else 0,
        }

    write_json(out_dir / "source_manifest.json", manifest)
    print(f"[{outbreak.slug}] wrote {out_dir.relative_to(ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch real historical MOSAIC validation sources")
    parser.add_argument(
        "--outbreak",
        choices=[*OUTBREAKS.keys(), "all"],
        required=True,
        help="Outbreak slug to fetch, or all",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = OUTBREAKS.values() if args.outbreak == "all" else [OUTBREAKS[args.outbreak]]
    for outbreak in selected:
        try:
            fetch_one(outbreak)
        except Exception as exc:
            print(f"[{outbreak.slug}] failed: {exc}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
