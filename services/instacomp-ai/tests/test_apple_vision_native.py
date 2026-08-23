from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

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


def jpeg(width: int, height: int) -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "white").save(output, format="JPEG")
    return output.getvalue()


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


def test_orientation_score_rejects_vertical_ocr_boxes() -> None:
    horizontal = [
        OCRObservation(
            text="KIKI RICE",
            confidence=1.0,
            box=OCRBox(x=0.1, y=0.1, width=0.3, height=0.03),
            side="front",
            source="test",
        )
    ]
    vertical = [
        OCRObservation(
            text="KIKI RICE",
            confidence=1.0,
            box=OCRBox(x=0.1, y=0.1, width=0.03, height=0.3),
            side="front",
            source="test",
        )
    ]

    assert AppleVisionOCR._orientation_score(
        horizontal,
        side="front",
    ) > AppleVisionOCR._orientation_score(vertical, side="front")


def test_sideways_image_geometry_forces_portrait_rotation_candidates() -> None:
    choices, evidence = AppleVisionOCR._image_frame_rotation_choices(jpeg(900, 600))

    assert choices == (90, 270)
    assert any("force_portrait" in value for value in evidence)


def test_portrait_image_geometry_allows_only_flip_candidates() -> None:
    choices, evidence = AppleVisionOCR._image_frame_rotation_choices(jpeg(600, 900))

    assert choices == (0, 180)
    assert any("allow_flip_only" in value for value in evidence)


def test_detect_rotation_does_not_allow_sideways_ocr_to_win(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    reader = AppleVisionOCR(Path("."), tmp_path)
    seen_rotations: list[int] = []

    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(
        AppleVisionOCR,
        "_clockwise_rotated_bytes",
        staticmethod(lambda content, rotation: str(rotation).encode()),
    )

    def recognize(self: AppleVisionOCR, image_bytes: bytes, *, side: str):
        rotation = int(image_bytes.decode())
        seen_rotations.append(rotation)
        confidence_by_rotation = {0: 1.0, 90: 0.80, 180: 0.50, 270: 0.55}
        return (
            [
                OCRObservation(
                    text="CARDTEXT",
                    confidence=confidence_by_rotation[rotation],
                    box=OCRBox(x=0.1, y=0.1, width=0.8, height=0.03),
                    side=side,
                    source="test",
                )
            ],
            [],
        )

    monkeypatch.setattr(AppleVisionOCR, "recognize", recognize)

    rotation, confidence, evidence = reader.detect_upright_rotation(
        jpeg(900, 600),
        side="front",
    )

    assert seen_rotations == [90, 270]
    assert rotation == 90
    assert confidence >= 0.55
    assert any("force_portrait" in value for value in evidence)


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
