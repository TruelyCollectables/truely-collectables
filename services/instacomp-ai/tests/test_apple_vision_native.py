from __future__ import annotations

import sys
from pathlib import Path

import pytest

from app.apple_vision import AppleVisionOCR
from app.local_vision import synthetic_text_image


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
