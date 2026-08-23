from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.apple_vision import AppleVisionOCR
from app.local_vision import synthetic_text_image
from app.models import OCRBox, OCRObservation


def observation(text: str, y: float) -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=1.0,
        box=OCRBox(x=0.1, y=y, width=0.8, height=0.03),
        side="back",
        source="test",
    )


def test_back_orientation_score_prefers_legal_footer_and_top_card_number() -> None:
    upright = [
        observation("No. 16", 0.90),
        observation("JACY SHELDON", 0.75),
        observation("Officially Licensed Product of the WNBPA © 2024", 0.05),
        observation("The collegiate indicia are trademarks", 0.02),
    ]
    upside_down = [
        observation("The collegiate indicia are trademarks", 0.95),
        observation("Officially Licensed Product of the WNBPA © 2024", 0.91),
        observation("JACY SHELDON", 0.20),
        observation("No. 16", 0.06),
    ]

    assert AppleVisionOCR._orientation_score(
        upright,
        side="back",
    ) > AppleVisionOCR._orientation_score(upside_down, side="back")


def test_front_orientation_score_prefers_set_markers_above_player_label() -> None:
    upright = [
        observation("ALL-AMERICAN", 0.90),
        observation("ROOKIE RC", 0.82),
        observation("JACY SHELDON", 0.08),
    ]
    upside_down = [
        observation("JACY SHELDON", 0.89),
        observation("ROOKIE RC", 0.15),
        observation("ALL-AMERICAN", 0.06),
    ]

    assert AppleVisionOCR._orientation_score(
        upright,
        side="front",
    ) > AppleVisionOCR._orientation_score(upside_down, side="front")


@pytest.mark.skipif(sys.platform != "darwin", reason="Apple Vision requires macOS")
def test_native_apple_vision_helper_compiles_and_reads_card_text(tmp_path: Path) -> None:
    service_root = Path(__file__).resolve().parents[1]
    reader = AppleVisionOCR(service_root, tmp_path)
    healthy, reason = reader.health()
    assert healthy, reason

    observations, errors = reader.recognize(
        synthetic_text_image("2025 PANINI NO. 122 SONIA CITRON"),
        side="front",
    )
    assert not errors
    combined = " ".join(value.text.upper() for value in observations)
    assert "2025" in combined
    assert "122" in combined
