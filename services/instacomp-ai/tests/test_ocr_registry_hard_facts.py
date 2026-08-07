from __future__ import annotations

from app.local_vision import build_identity_hints
from app.models import (
    CardIdentity,
    ColorEvidence,
    LocalVisionEvidence,
    OCRBox,
    OCRObservation,
    PatternEvidence,
    SerialEvidence,
    SideVisionEvidence,
)
from app.ollama import merge_local_vision_payload


def obs(text: str, *, side: str, x: float, y: float, confidence: float = 0.95):
    return OCRObservation(
        text=text,
        confidence=confidence,
        box=OCRBox(x=x, y=y, width=0.12, height=0.035),
        side=side,
        source="test",
    )


def side(side_name: str, observations: list[OCRObservation], *, pattern: str = "unknown", pattern_confidence: float = 0.0):
    return SideVisionEvidence(
        side=side_name,
        width=800,
        height=1100,
        ocr=observations,
        colors=ColorEvidence(
            dominant_colors=["white", "black", "blue"],
            proportions={"white": 0.4, "black": 0.3, "blue": 0.2},
            metallic_score=0.35,
        ),
        pattern=PatternEvidence(label=pattern, confidence=pattern_confidence),
    )


def test_release_year_and_split_no_card_number_outrank_stats_and_jersey_numbers():
    front = side(
        "front",
        [
            obs("SONIA CITRON", side="front", x=0.25, y=0.08),
            obs("22", side="front", x=0.48, y=0.55),
            obs("PRIZM", side="front", x=0.40, y=0.92),
        ],
    )
    back = side(
        "back",
        [
            obs("No.", side="back", x=0.10, y=0.90),
            obs("122", side="back", x=0.22, y=0.90),
            obs("2024 WNBA TOTALS", side="back", x=0.10, y=0.42),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.08, y=0.08),
            obs("Officially Licensed Product © 2025", side="back", x=0.08, y=0.04),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.year == "2025"
    assert identity.card_number == "122"
    assert identity.manufacturer == "Panini"
    # Generic dominant image colors must not invent a named parallel.
    assert identity.parallel is None


def test_confident_surface_geometry_can_supply_parallel_without_using_jersey_color():
    front = side(
        "front",
        [obs("DOMINIQUE MALONGA", side="front", x=0.2, y=0.1)],
        pattern="cracked_ice",
        pattern_confidence=0.84,
    )
    back = side(
        "back",
        [
            obs("No. 116", side="back", x=0.1, y=0.9),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.08, y=0.08),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.card_number == "116"
    assert identity.parallel == "Cracked Ice Prizm"


def test_ollama_merge_uses_hard_ocr_facts_and_drops_unseen_serial_hallucination():
    front = side("front", [obs("RICKEA JACKSON", side="front", x=0.2, y=0.1)])
    back = side(
        "back",
        [
            obs("No.", side="back", x=0.1, y=0.9),
            obs("118", side="back", x=0.2, y=0.9),
            obs("2024 WNBA TOTALS", side="back", x=0.1, y=0.4),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.1, y=0.08),
        ],
    )
    hints = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    local = LocalVisionEvidence(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
        identity_hints=hints,
        combined_text="",
        apple_vision_available=True,
        opencv_available=True,
    )
    payload = {
        "identity": {
            "year": "2024",
            "manufacturer": "Panini",
            "player": "Rickea Jackson",
            "card_number": "1",
            "parallel": "Black Prizm",
            "serial_number": "/299",
            "serial_run": 299,
        },
        "evidence": {},
        "confidence": 0.5,
        "explanation": "test",
    }
    merged = merge_local_vision_payload(payload, local)
    assert merged["identity"]["year"] == "2025"
    assert merged["identity"]["card_number"] == "118"
    assert merged["identity"]["serial_number"] is None
    assert merged["identity"]["serial_run"] is None
    assert merged["identity"]["parallel"] is None


def test_paige_top_card_number_beats_biography_no_one_overall_pick():
    front = side("front", [obs("PAIGE BUECKERS", side="front", x=0.2, y=0.1)])
    back = side(
        "back",
        [
            obs("No. 1 overall pick", side="back", x=0.20, y=0.28, confidence=0.99),
            obs("No.", side="back", x=0.78, y=0.90, confidence=0.79),
            obs("5", side="back", x=0.88, y=0.90, confidence=0.76),
            obs("2024", side="back", x=0.10, y=0.42),
            obs("WNBA TOTALS", side="back", x=0.22, y=0.42),
            obs("2025", side="back", x=0.54, y=0.08, confidence=0.83),
            obs("PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.70, y=0.08, confidence=0.91),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.card_number == "5"
    assert identity.year == "2025"
    assert identity.manufacturer == "Panini"


def test_unique_upper_back_number_survives_missing_no_label():
    front = side(
        "front",
        [
            obs("SONIA CITRON", side="front", x=0.25, y=0.08),
            obs("22", side="front", x=0.48, y=0.55),
        ],
    )
    back = side(
        "back",
        [
            obs("122", side="back", x=0.84, y=0.90, confidence=0.91),
            obs("32", side="back", x=0.22, y=0.43, confidence=0.96),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.55, y=0.08),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.card_number == "122"


def test_biography_no_one_without_physical_card_number_fails_closed():
    front = side("front", [obs("PAIGE BUECKERS", side="front", x=0.2, y=0.1)])
    back = side(
        "back",
        [
            obs("No. 1 overall pick", side="back", x=0.2, y=0.28, confidence=0.99),
            obs("2025 PANINI - WNBA PRIZM BASKETBALL", side="back", x=0.55, y=0.08),
        ],
    )
    identity = build_identity_hints(front=front, back=back, serial=SerialEvidence())
    assert identity.card_number is None
