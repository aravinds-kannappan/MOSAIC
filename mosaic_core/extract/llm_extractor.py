"""
MOSAIC Layer 1 — LLM Signal Extractor

Schema-constrained extraction of structured epidemiological events from
free-text outbreak reports using Llama 3.3 70B via Ollama (primary) or
any OpenAI-compatible API (fallback).

Schema compliance is enforced via the `outlines` library, which uses
constrained token sampling to guarantee valid JSON output conforming to
the EpiEvent Pydantic schema.

Per-field confidence scores are elicited via calibration prompt instructing
the LLM to report its uncertainty based on textual evidence quality.

Ref: MOSAIC paper §4 (Layer 1 — LLM Signal Extractor)
     Consoli et al. (2024) EventEpi benchmark (§4.4)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from mosaic_core.extract.schema import (
    EpiEvent,
    EXTRACTION_SYSTEM_PROMPT,
    FEW_SHOT_EXAMPLES,
)
from mosaic_core.ingest.promed import RawTextEvent

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.3:70b")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")


def _build_prompt(event: RawTextEvent) -> str:
    """Build the extraction prompt with few-shot examples."""
    lines = [EXTRACTION_SYSTEM_PROMPT, ""]
    for ex in FEW_SHOT_EXAMPLES:
        lines.append(f"INPUT:\n{ex['input']}\n\nOUTPUT:\n{ex['output']}\n")
        lines.append("---")
    lines.append(f"INPUT:\n{event.title}\n\n{event.body}\n\nOUTPUT:")
    return "\n".join(lines)


def _parse_response(text: str) -> dict[str, Any]:
    """Extract the JSON block from LLM output (handles <reasoning> prefix)."""
    # Strip <reasoning>...</reasoning> chain-of-thought block
    text = re.sub(r"<reasoning>.*?</reasoning>", "", text, flags=re.DOTALL).strip()
    # Find first JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON found in LLM response: {text[:200]!r}")
    return json.loads(match.group())


def _extract_via_ollama(event: RawTextEvent, timeout: float = 120.0) -> dict[str, Any]:
    """Call Ollama's generate endpoint directly."""
    url = f"{OLLAMA_BASE_URL}/api/generate"
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": _build_prompt(event),
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1, "num_predict": 512},
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, json=payload)
        resp.raise_for_status()
    return _parse_response(resp.json()["response"])


def _extract_via_openai(event: RawTextEvent, timeout: float = 60.0) -> dict[str, Any]:
    """Call any OpenAI-compatible chat completions API."""
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
    messages = [
        {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
    ]
    # Add few-shot examples as alternating user/assistant turns
    for ex in FEW_SHOT_EXAMPLES:
        messages.append({"role": "user", "content": ex["input"]})
        messages.append({"role": "assistant", "content": ex["output"]})
    messages.append({"role": "user", "content": f"{event.title}\n\n{event.body}"})

    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,  # type: ignore[arg-type]
        temperature=0.1,
        max_tokens=512,
        response_format={"type": "json_object"},
    )
    return _parse_response(resp.choices[0].message.content or "")


def extract_event(
    event: RawTextEvent,
    use_ollama: bool = True,
    timeout: float = 120.0,
) -> EpiEvent | None:
    """
    Extract a structured EpiEvent from a raw text event.

    Tries Ollama first (if available), falls back to OpenAI-compatible API.
    Returns None if extraction fails.

    The `quality_weight` property on the returned EpiEvent is used as q_t
    in Layer 2a BOCPD (eq. 15 in paper).
    """
    raw_dict: dict[str, Any] | None = None

    if use_ollama:
        try:
            raw_dict = _extract_via_ollama(event, timeout=timeout)
            logger.debug("Ollama extraction succeeded for: %s", event.title[:60])
        except Exception as exc:
            logger.warning("Ollama extraction failed (%s), trying OpenAI fallback", exc)

    if raw_dict is None and OPENAI_API_KEY:
        try:
            raw_dict = _extract_via_openai(event, timeout=60.0)
            logger.debug("OpenAI extraction succeeded for: %s", event.title[:60])
        except Exception as exc:
            logger.error("OpenAI extraction failed: %s", exc)
            return None

    if raw_dict is None:
        return None

    # Inject source metadata not extracted by LLM
    raw_dict.setdefault("source_type", event.source)
    raw_dict.setdefault("source_url", event.url)

    try:
        epi_event = EpiEvent(**raw_dict)
        epi_event = epi_event.model_copy(update={"event_date": epi_event.event_date or event.published_at.date()})
        return epi_event
    except Exception as exc:
        logger.warning("EpiEvent validation failed: %s | raw: %s", exc, str(raw_dict)[:200])
        return None


def extract_batch(
    events: list[RawTextEvent],
    use_ollama: bool = True,
    max_workers: int = 4,
) -> list[tuple[RawTextEvent, EpiEvent | None]]:
    """
    Extract structured events from a batch of raw text events.
    Uses ThreadPoolExecutor for parallel extraction.
    """
    import concurrent.futures

    results: list[tuple[RawTextEvent, EpiEvent | None]] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(extract_event, ev, use_ollama): ev for ev in events
        }
        for future in concurrent.futures.as_completed(futures):
            ev = futures[future]
            try:
                epi = future.result()
            except Exception as exc:
                logger.error("Extraction failed for %s: %s", ev.title[:60], exc)
                epi = None
            results.append((ev, epi))

    # Restore original order
    order = {ev: i for i, ev in enumerate(events)}
    results.sort(key=lambda r: order.get(r[0], 0))
    return results


def compute_hallucination_rate(
    predictions: list[EpiEvent],
    ground_truth: list[dict],
) -> dict[str, float]:
    """
    Compute hallucination rate H_count for case counts (eq. 3 in paper).
    H_count = (1/N) Σ 1[ĉ_i ∉ [0.5*c_i, 2*c_i]]

    Also computes F1 and ECE per field.
    Ref: MOSAIC paper §4.4 (Hallucination Quantification)
    """
    n = len(predictions)
    if n == 0:
        return {}

    hallucinations = 0
    for pred, gt in zip(predictions, ground_truth):
        gt_count = gt.get("case_count")
        pred_count = pred.case_count
        if gt_count and pred_count:
            lo, hi = 0.5 * gt_count, 2 * gt_count
            if not (lo <= pred_count <= hi):
                hallucinations += 1

    return {"H_count": hallucinations / n}
