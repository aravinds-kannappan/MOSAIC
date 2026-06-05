"""
ProMED-mail RSS + WHO Disease Outbreak News ingestion client.

Data sources:
  - ProMED RSS:  https://promedmail.org/feed/            (no auth)
  - WHO DON API: https://www.who.int/api/hubs/cms/en/NewsTypes/DONs  (no auth)

Ref: MOSAIC paper §4.1 (Layer 1 — LLM Signal Extractor sources)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator

import feedparser
import httpx

logger = logging.getLogger(__name__)

PROMED_RSS_URL = "https://promedmail.org/feed/"
WHO_DON_API_URL = (
    "https://www.who.int/api/hubs/cms/en/NewsTypes/DONs"
    "?sf_culture=en&$top=100"
)


@dataclass
class RawTextEvent:
    """A raw outbreak report before LLM extraction."""
    source: str          # "ProMED" | "WHO"
    title: str
    body: str
    url: str
    published_at: datetime
    raw: dict = field(default_factory=dict, repr=False)


def fetch_promed_rss(timeout: float = 30.0) -> list[RawTextEvent]:
    """
    Fetch and parse the ProMED-mail RSS feed.
    Returns up to 100 most-recent posts.
    """
    logger.info("Fetching ProMED RSS feed: %s", PROMED_RSS_URL)
    feed = feedparser.parse(PROMED_RSS_URL)
    if feed.bozo:
        logger.warning("ProMED RSS parse warning: %s", feed.bozo_exception)

    events: list[RawTextEvent] = []
    for entry in feed.entries:
        published = entry.get("published_parsed") or entry.get("updated_parsed")
        if published:
            dt = datetime(*published[:6], tzinfo=timezone.utc)
        else:
            dt = datetime.now(tz=timezone.utc)

        # Strip HTML tags from summary/content
        body = entry.get("summary", "") or entry.get("content", [{}])[0].get("value", "")
        body = _strip_html(body)

        events.append(
            RawTextEvent(
                source="ProMED",
                title=entry.get("title", ""),
                body=body[:4000],  # Truncate to ~4k chars for LLM input
                url=entry.get("link", entry.get("id", "")),
                published_at=dt,
                raw=dict(entry),
            )
        )

    logger.info("ProMED: fetched %d posts", len(events))
    return events


def fetch_who_don(timeout: float = 30.0) -> list[RawTextEvent]:
    """
    Fetch WHO Disease Outbreak News from the WHO CMS REST API.
    Returns up to 100 most-recent DONs.
    """
    logger.info("Fetching WHO DON API: %s", WHO_DON_API_URL)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(WHO_DON_API_URL, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()

    items = data.get("value", [])
    events: list[RawTextEvent] = []

    for item in items:
        # WHO CMS API field names (may vary by version)
        title = item.get("Title") or item.get("title") or ""
        body = item.get("Summary") or item.get("summary") or title
        url_path = item.get("Url") or item.get("url") or ""
        url = f"https://www.who.int{url_path}" if url_path.startswith("/") else url_path

        pub_str = item.get("PublicationDateAndTime") or item.get("DatePublished") or ""
        try:
            dt = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            dt = datetime.now(tz=timezone.utc)

        events.append(
            RawTextEvent(
                source="WHO",
                title=title,
                body=body[:4000],
                url=url,
                published_at=dt,
                raw=item,
            )
        )

    logger.info("WHO DON: fetched %d items", len(events))
    return events


def stream_all_sources(
    include_promed: bool = True,
    include_who: bool = True,
) -> Iterator[RawTextEvent]:
    """
    Generator that yields raw text events from all configured sources,
    sorted by publication date descending.
    """
    all_events: list[RawTextEvent] = []

    if include_promed:
        try:
            all_events.extend(fetch_promed_rss())
        except Exception as exc:
            logger.error("ProMED fetch failed: %s", exc)

    if include_who:
        try:
            all_events.extend(fetch_who_don())
        except Exception as exc:
            logger.error("WHO DON fetch failed: %s", exc)

    all_events.sort(key=lambda e: e.published_at, reverse=True)
    yield from all_events


def _strip_html(text: str) -> str:
    """Remove HTML tags from text."""
    import re
    return re.sub(r"<[^>]+>", " ", text).strip()


if __name__ == "__main__":
    """
    Fetch ProMED RSS + WHO DON events and save to data/output/promed_events.json.

    Usage:
        python -m mosaic.ingest.promed
        python -m mosaic.ingest.promed --no-who   # ProMED only
    """
    import argparse
    import sys
    from mosaic.store import save

    parser = argparse.ArgumentParser(description="Fetch ProMED RSS and WHO DON events")
    parser.add_argument("--no-promed", action="store_true", help="Skip ProMED RSS")
    parser.add_argument("--no-who", action="store_true", help="Skip WHO DON")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    print("[ProMED/WHO] Fetching outbreak reports …")
    events = list(stream_all_sources(
        include_promed=not args.no_promed,
        include_who=not args.no_who,
    ))

    if not events:
        print("  ⚠ No events fetched — check network connectivity")
        import sys; sys.exit(1)

    serialised = [
        {
            "source": ev.source,
            "title": ev.title,
            "body": ev.body[:2000],
            "url": ev.url,
            "published_at": ev.published_at.isoformat(),
        }
        for ev in events
    ]

    payload = {
        "events": serialised,
        "n_promed": sum(1 for e in events if e.source == "ProMED"),
        "n_who": sum(1 for e in events if e.source == "WHO"),
        "fetched_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    save("promed_events.json", payload)
    print(f"  ✓ {len(events)} events ({payload['n_promed']} ProMED, {payload['n_who']} WHO) → data/output/promed_events.json")
    print("[ProMED/WHO] Done.")
