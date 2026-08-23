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


def test_front_orientation_score_prefers_player_label_over_rookie_artwork() -> None:
    upright = [
        observation("AJSA SIVKA", 0.88),
        observation("DONRUSS", 0.80),
        observation("CHICAGO", 0.45),
    ]
    upside_down = [
        observation("RATED", 0.88),
        observation("ROOKIE", 0.84),
        observation("DONRUSS", 0.15),
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
        confidence_by_rotation = {0: 0.20, 90: 1.0, 180: 0.10, 270: 0.70}
        count_by_rotation = {0: 1, 90: 3, 180: 1, 270: 2}
        return (
            [
                OCRObservation(
                    text=f"CARDTEXT {index}",
                    confidence=confidence_by_rotation[rotation],
                    box=OCRBox(
                        x=0.1,
                        y=0.1 + index * 0.06,
                        width=0.8,
                        height=0.03,
                    ),
                    side=side,
                    source="test",
                )
                for index in range(count_by_rotation[rotation])
            ],
            [],
        )

    monkeypatch.setattr(AppleVisionOCR, "recognize", recognize)

    rotation, confidence, evidence = reader.detect_upright_rotation(
        jpeg(900, 600),
        side="front",
    )

    assert seen_rotations == [0, 90, 180, 270]
    assert rotation == 90
    assert confidence >= 0.55
    assert any("front_sideways_rotation" in value for value in evidence)


def test_ambiguous_front_portrait_scan_keeps_existing_orientation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    reader = AppleVisionOCR(Path("."), tmp_path)

    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(
        AppleVisionOCR,
        "_clockwise_rotated_bytes",
        staticmethod(lambda content, rotation: str(rotation).encode()),
    )

    def recognize(self: AppleVisionOCR, image_bytes: bytes, *, side: str):
        rotation = int(image_bytes.decode())
        confidence_by_rotation = {0: 0.80, 90: 0.10, 180: 0.79, 270: 0.10}
        return (
            [
                OCRObservation(
                    text="BLAKE WESLEY",
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
        jpeg(600, 900),
        side="front",
    )

    assert rotation == 0
    assert confidence >= 0.55
    assert any("front_source_preserved" in value for value in evidence)


def test_front_portrait_preserves_source_before_running_ocr_flip(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    reader = AppleVisionOCR(Path("."), tmp_path)

    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(
        AppleVisionOCR,
        "_clockwise_rotated_bytes",
        staticmethod(lambda content, rotation: str(rotation).encode()),
    )

    def recognize(self: AppleVisionOCR, image_bytes: bytes, *, side: str):
        rotation = int(image_bytes.decode())
        return (
            [
                OCRObservation(
                    text=f"ROTATION {rotation}",
                    confidence=1.0,
                    box=OCRBox(x=0.1, y=0.1, width=0.8, height=0.03),
                    side=side,
                    source="test",
                )
            ],
            [],
        )

    monkeypatch.setattr(AppleVisionOCR, "recognize", recognize)

    rotation, confidence, evidence = reader.detect_upright_rotation(
        jpeg(600, 900),
        side="front",
    )

    assert rotation == 0
    assert confidence >= 0.55
    assert any("front_source_preserved" in value for value in evidence)


def test_no_text_front_portrait_scan_keeps_existing_orientation(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    reader = AppleVisionOCR(Path("."), tmp_path)

    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(
        AppleVisionOCR,
        "_clockwise_rotated_bytes",
        staticmethod(lambda content, rotation: str(rotation).encode()),
    )
    monkeypatch.setattr(AppleVisionOCR, "recognize", lambda self, image_bytes, *, side: ([], []))

    rotation, confidence, evidence = reader.detect_upright_rotation(
        jpeg(600, 900),
        side="front",
    )

    assert rotation == 0
    assert confidence >= 0.55
    assert any("front_source_preserved" in value for value in evidence)


def test_ambiguous_back_portrait_scan_keeps_existing_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    reader = AppleVisionOCR(Path("."), tmp_path)

    monkeypatch.setattr(AppleVisionOCR, "supported", property(lambda self: True))
    monkeypatch.setattr(
        AppleVisionOCR,
        "_clockwise_rotated_bytes",
        staticmethod(lambda content, rotation: str(rotation).encode()),
    )

    def recognize(self: AppleVisionOCR, image_bytes: bytes, *, side: str):
        return (
            [
                OCRObservation(
                    text="OFFICIALLY LICENSED",
                    confidence=0.8,
                    box=OCRBox(x=0.1, y=0.1, width=0.8, height=0.03),
                    side=side,
                    source="test",
                )
            ],
            [],
        )

    monkeypatch.setattr(AppleVisionOCR, "recognize", recognize)

    rotation, _confidence, evidence = reader.detect_upright_rotation(
        jpeg(600, 900),
        side="back",
    )

    assert rotation == 0
    assert not any("front_portrait_scanner_fallback" in value for value in evidence)


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
