from __future__ import annotations

from app.local_vision import parse_serial_evidence
from app.models import OCRBox, OCRObservation


def _obs(
    text: str,
    *,
    side: str = "front",
    source: str = "apple-vision",
    confidence: float = 0.99,
) -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=confidence,
        box=OCRBox(x=0.1, y=0.1, width=0.4, height=0.05),
        side=side,
        source=source,
    )


def test_aja_noisy_front_fraction_is_not_a_hard_serial() -> None:
    evidence = parse_serial_evidence([_obs("2/6 0б 6")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.visible_denominator == 6


def test_noisy_fraction_inside_stats_is_not_a_hard_serial() -> None:
    evidence = parse_serial_evidence([_obs("STATS 2/6 FG")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None


def test_clean_bare_serial_stamp_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("017/299", side="back")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"
    assert evidence.numerator == 17
    assert evidence.visible_denominator == 299


def test_explicit_serial_cue_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("SERIAL 017/299", side="front")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_clean_of_stamp_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("17 OF 299", side="back")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_repeated_noisy_fraction_same_channel_is_not_corroboration() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare"),
            _obs("edge 17/299 foil"),
        ]
    )
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None


def test_noisy_fraction_requires_independent_channel_corroboration() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare", side="front", source="apple-vision", confidence=0.91),
            _obs("edge 17/299 foil", side="back", source="apple-vision", confidence=0.93),
        ]
    )
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"
    assert evidence.visible_denominator == 299


def test_different_ocr_sources_can_corroborate_same_side() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare", source="apple-vision", confidence=0.90),
            _obs("edge 17/299 foil", source="secondary-ocr", confidence=0.94),
        ]
    )
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_full_aja_style_line_cannot_poison_registry_serial() -> None:
    evidence = parse_serial_evidence(
        [_obs("A'JA WILSON 2/6 0б 6 CARD 76", side="front")]
    )
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.visible_denominator == 6
