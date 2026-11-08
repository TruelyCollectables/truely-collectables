from __future__ import annotations

import json

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
from app.ollama import local_vision_prompt_payload


def _observation(index: int, side: str) -> OCRObservation:
    return OCRObservation(
        text=(f"{side.upper()} LINE {index} " + "X" * 180),
        confidence=0.91,
        box=OCRBox(x=0.1, y=0.2, width=0.3, height=0.04),
        side=side,
        source="apple_vision",
    )


def _side(side: str) -> SideVisionEvidence:
    return SideVisionEvidence(
        side=side,
        width=1200,
        height=1680,
        ocr=[_observation(index, side) for index in range(100)],
        colors=ColorEvidence(
            dominant_colors=["blue", "silver", "white"],
            proportions={"blue": 0.48, "silver": 0.32, "white": 0.2},
            mean_saturation=0.61,
            mean_brightness=0.72,
            metallic_score=0.83,
        ),
        pattern=PatternEvidence(
            label="velocity",
            confidence=0.88,
            scores={"velocity": 0.88, "cracked_ice": 0.12},
            geometry=["diagonal_lines", "directional_repetition"],
            line_count=64,
            polygon_count=2,
            edge_density=0.37,
            dominant_angle=43.5,
            angle_concentration=0.79,
            angle_entropy=0.21,
        ),
    )


def test_local_vision_prompt_payload_is_bounded_and_drops_boxes() -> None:
    evidence = LocalVisionEvidence(
        front=_side("front"),
        back=_side("back"),
        serial=SerialEvidence(
            stamp_present=True,
            exact_stamp="17/99",
            numerator=17,
            visible_denominator=99,
            side="back",
            confidence=0.99,
            source_text="17/99",
            box=OCRBox(x=0.2, y=0.7, width=0.2, height=0.05),
        ),
        identity_hints=CardIdentity(
            year="2025",
            manufacturer="Panini",
            set_name="Prizm WNBA",
            player="Sonia Citron",
            card_number="122",
            parallel="Blue Velocity Prizm",
        ),
        combined_text="ignored in the bounded reasoning digest",
        apple_vision_available=True,
    )

    payload = local_vision_prompt_payload(evidence)
    assert payload is not None
    assert len(payload["front"]["ocr"]) == 40
    assert len(payload["back"]["ocr"]) == 40
    assert all(len(row["text"]) <= 120 for row in payload["front"]["ocr"])
    assert all("box" not in row for row in payload["front"]["ocr"])
    assert "box" not in payload["serial"]
    assert payload["serial"]["exact_stamp"] == "17/99"
    assert payload["identity_hints"]["card_number"] == "122"

    serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    assert len(serialized) < 18000


def test_local_vision_prompt_payload_deduplicates_ocr_text() -> None:
    duplicate = OCRObservation(
        text="2025 PANINI",
        confidence=0.95,
        box=OCRBox(x=0.1, y=0.1, width=0.3, height=0.04),
        side="front",
        source="apple_vision",
    )
    side = SideVisionEvidence(
        side="front",
        width=1000,
        height=1400,
        ocr=[duplicate, duplicate.model_copy()],
    )
    payload = local_vision_prompt_payload(LocalVisionEvidence(front=side))
    assert payload is not None
    assert payload["front"]["ocr"] == [
        {"text": "2025 PANINI", "confidence": 0.95}
    ]
