"""Tests for LLM extraction schema and parsing utilities."""

from datetime import date, timezone, datetime

import pytest

from mosaic.extract.schema import EpiEvent
from mosaic.ingest.promed import _strip_html


def test_epi_event_quality_weight_range():
    """quality_weight must be in [0, 1]."""
    event = EpiEvent(
        pathogen="SARS-CoV-2",
        pathogen_confidence=0.9,
        location_country="US",
        location_region=None,
        location_confidence=0.8,
        event_date=date(2024, 1, 15),
        date_confidence=0.95,
        case_count=100,
        death_count=5,
        count_confidence=0.85,
        novelty_flag=False,
        source_type="ProMED",
        source_url="https://promedmail.org/1",
    )
    assert 0 <= event.quality_weight <= 1


def test_epi_event_quality_weight_geometric_mean():
    """quality_weight = (p_conf * l_conf * d_conf)^(1/3)"""
    event = EpiEvent(
        pathogen="mpox",
        pathogen_confidence=0.8,
        location_country="US",
        location_region="New York",
        location_confidence=0.9,
        event_date=date(2022, 5, 20),
        date_confidence=1.0,
        case_count=None,
        death_count=None,
        count_confidence=0.0,
        novelty_flag=True,
        source_type="WHO",
        source_url="https://who.int/1",
    )
    expected = (0.8 * 0.9 * 1.0) ** (1 / 3)
    assert abs(event.quality_weight - expected) < 1e-6


def test_epi_event_country_uppercase():
    event = EpiEvent(
        pathogen="influenza",
        pathogen_confidence=0.7,
        location_country="us",  # lowercase input
        location_region=None,
        location_confidence=0.6,
        event_date=date(2024, 3, 1),
        date_confidence=0.8,
        case_count=None,
        death_count=None,
        count_confidence=0.0,
        novelty_flag=False,
        source_type="news",
        source_url="https://example.com",
    )
    assert event.location_country == "US"


def test_strip_html():
    html = "<p>Hello <b>world</b> — <a href='x'>link</a></p>"
    text = _strip_html(html)
    assert "<" not in text
    assert "Hello" in text
    assert "world" in text


def test_epi_event_validation_confidence_range():
    """Confidence values outside [0, 1] should raise ValidationError."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        EpiEvent(
            pathogen="test",
            pathogen_confidence=1.5,  # Invalid
            location_country="US",
            location_region=None,
            location_confidence=0.5,
            event_date=date(2024, 1, 1),
            date_confidence=0.5,
            case_count=None,
            death_count=None,
            count_confidence=0.5,
            novelty_flag=False,
            source_type="ProMED",
            source_url="https://example.com",
        )
