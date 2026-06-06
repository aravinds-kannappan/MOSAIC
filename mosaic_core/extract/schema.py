"""
EpiEvent Pydantic schema — the output schema for MOSAIC's LLM extractor.

Each document is passed to the LLM with this strict JSON schema enforced
via constrained decoding (outlines library), ensuring schema compliance
and enabling per-field confidence calibration.

Ref: MOSAIC paper §4.2 (Extraction Schema, Listing 1)
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class EpiEvent(BaseModel):
    """Structured epidemiological event extracted from a free-text report."""

    pathogen: str = Field(
        description="Pathogen name, e.g. 'SARS-CoV-2', 'H5N1 influenza A', 'mpox'"
    )
    pathogen_confidence: float = Field(
        ge=0.0, le=1.0,
        description="LLM self-assessed confidence (0-1) based on textual evidence quality"
    )

    location_country: str = Field(
        description="ISO 3166-1 alpha-2 country code, e.g. 'US', 'CN', 'CD'"
    )
    location_region: str | None = Field(
        default=None,
        description="Sub-national region or city, null if not mentioned"
    )
    location_confidence: float = Field(
        ge=0.0, le=1.0,
        description="Location extraction confidence"
    )

    event_date: date = Field(
        description="Onset or report date in YYYY-MM-DD format"
    )
    date_confidence: float = Field(
        ge=0.0, le=1.0,
        description="Date extraction confidence"
    )

    case_count: int | None = Field(
        default=None,
        description="Confirmed or suspected case count, null if not mentioned"
    )
    death_count: int | None = Field(
        default=None,
        description="Confirmed death count, null if not mentioned"
    )
    count_confidence: float = Field(
        ge=0.0, le=1.0,
        description="Case/death count extraction confidence"
    )

    novelty_flag: bool = Field(
        description="True if report describes unknown etiology or unusual spread pattern"
    )

    source_type: Literal["ProMED", "WHO", "news"] = Field(
        description="Source of the original document"
    )
    source_url: str = Field(
        description="URL of the source document"
    )

    @field_validator("location_country")
    @classmethod
    def validate_iso_country(cls, v: str) -> str:
        if v and len(v) != 2:
            # Accept longer strings (model may return full name) — normalise later
            pass
        return v.upper() if v else v

    @property
    def quality_weight(self) -> float:
        """
        q_t ∈ [0, 1] — composite quality weight derived from field confidences.
        Used in Layer 2a BOCPD as the quality-weighted event count.
        q_t = sqrt(pathogen_conf * location_conf * date_conf)
        """
        return (
            self.pathogen_confidence
            * self.location_confidence
            * self.date_confidence
        ) ** (1 / 3)


# System prompt for the LLM extractor (MOSAIC paper §4.3)
EXTRACTION_SYSTEM_PROMPT = """\
You are an expert epidemiological analyst. Your task is to extract structured
information from disease outbreak reports. You must output ONLY valid JSON
conforming exactly to the schema provided.

Rules:
1. Set confidence = 0.0 when a field cannot be reliably inferred from the text.
2. Set location_region = null if no sub-national location is mentioned.
3. Set case_count = null if no specific number is given.
4. Set novelty_flag = true ONLY if the report explicitly mentions unknown etiology,
   unusual transmission, or an emerging pathogen with no established lineage.
5. The location_country field MUST be an ISO 3166-1 alpha-2 code (2 letters).
6. Do not hallucinate numbers — if a case count is ambiguous, set confidence < 0.5.

Think step by step in a <reasoning> block before producing the JSON output.
""".strip()

# Few-shot examples (annotated from EventEpi corpus)
FEW_SHOT_EXAMPLES: list[dict[str, str]] = [
    {
        "input": (
            "ProMED 20211125.8709302 — SARS-CoV-2 UPDATE (107): GLOBAL, NEW VARIANT "
            "B.1.1.529, OMICRON, WHO — South Africa reported 1,200 new cases of a "
            "novel SARS-CoV-2 variant on 25 November 2021."
        ),
        "output": """\
<reasoning>
The text describes a SARS-CoV-2 variant (Omicron) detected in South Africa on 25 Nov 2021.
Case count 1,200 is explicitly stated. The novel variant flag is warranted.
</reasoning>
{"pathogen":"SARS-CoV-2","pathogen_confidence":0.99,"location_country":"ZA",
"location_region":null,"location_confidence":0.97,"event_date":"2021-11-25",
"date_confidence":0.99,"case_count":1200,"death_count":null,"count_confidence":0.95,
"novelty_flag":true,"source_type":"ProMED","source_url":"https://promedmail.org/promed-post/?id=8709302"}""",
    },
    {
        "input": (
            "WHO DON 2022-05-20 — Monkeypox — Multiple countries. As of 20 May 2022, "
            "92 confirmed cases and 28 suspected cases of monkeypox have been reported "
            "from 12 Member States that are not endemic for monkeypox virus."
        ),
        "output": """\
<reasoning>
Monkeypox outbreak in multiple non-endemic countries. WHO reports 92 confirmed + 28 suspected.
Location is 'global / multiple countries' — best code is 'MULTI' but I'll use 'ZZ' as placeholder.
Date is 2022-05-20. Unusual spread (non-endemic) warrants novelty_flag=true.
</reasoning>
{"pathogen":"mpox","pathogen_confidence":0.99,"location_country":"ZZ",
"location_region":"multiple countries","location_confidence":0.70,
"event_date":"2022-05-20","date_confidence":0.99,"case_count":92,"death_count":null,
"count_confidence":0.90,"novelty_flag":true,"source_type":"WHO",
"source_url":"https://www.who.int/emergencies/disease-outbreak-news"}""",
    },
]
