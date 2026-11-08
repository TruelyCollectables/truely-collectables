from __future__ import annotations

from pathlib import Path

import numpy as np

from app import local_vision
from app.models import ColorEvidence, OCRBox, OCRObservation, PatternEvidence


class Settings:
    database_path = Path("data/instacomp_ai.sqlite3")
    service_root = Path(".")

    def resolve_local_path(self, value):
        return Path(value).resolve()


class WorkingOcr:
    supported = True

    def recognize(self, _content: bytes, *, side: str):
        if side == "back":
            return [
                OCRObservation(
                    text="2025 PANINI CARD NO. 116",
                    confidence=0.99,
                    box=OCRBox(x=0.1, y=0.8, width=0.7, height=0.08),
                    side="back",
                    source="test",
                )
            ], []
        return [], []


def test_opencv_decode_failure_preserves_apple_vision_ocr_and_hints(monkeypatch):
    monkeypatch.setattr(local_vision, "AppleVisionOCR", lambda *_args, **_kwargs: WorkingOcr())

    def broken_decode(_content: bytes):
        raise TypeError("synthetic OpenCV decode TypeError")

    monkeypatch.setattr(local_vision, "_decode_image", broken_decode)
    result = local_vision.analyze_local_vision_sync(b"front", b"back", Settings())

    assert result.combined_text == "2025 PANINI CARD NO. 116"
    assert result.identity_hints.year == "2025"
    assert result.identity_hints.manufacturer == "Panini"
    assert result.identity_hints.card_number == "116"
    assert result.apple_vision_available is True
    assert result.opencv_available is False
    assert "front:opencv_decode_failed:typeerror" in result.front.errors
    assert result.back is not None
    assert "back:opencv_decode_failed:typeerror" in result.back.errors


def test_apple_vision_failure_preserves_opencv_witness(monkeypatch):
    class BrokenOcr:
        supported = True

        def recognize(self, _content: bytes, *, side: str):
            raise TypeError(f"synthetic {side} OCR TypeError")

    monkeypatch.setattr(local_vision, "AppleVisionOCR", lambda *_args, **_kwargs: BrokenOcr())
    monkeypatch.setattr(local_vision, "_decode_image", lambda _content: np.zeros((120, 80, 3), dtype=np.uint8))
    monkeypatch.setattr(local_vision, "analyze_colors", lambda _image: ColorEvidence(dominant_colors=["black"]))
    monkeypatch.setattr(local_vision, "analyze_pattern", lambda _image: PatternEvidence(label="unknown"))

    result = local_vision.analyze_local_vision_sync(b"front", b"back", Settings())

    assert result.opencv_available is True
    assert result.front.width == 80
    assert result.front.height == 120
    assert result.front.colors.dominant_colors == ["black"]
    assert "front:apple_vision_stage_failed:typeerror" in result.front.errors
    assert result.back is not None
    assert "back:apple_vision_stage_failed:typeerror" in result.back.errors


def test_color_failure_does_not_erase_ocr_or_pattern(monkeypatch):
    monkeypatch.setattr(local_vision, "AppleVisionOCR", lambda *_args, **_kwargs: WorkingOcr())
    monkeypatch.setattr(local_vision, "_decode_image", lambda _content: np.zeros((120, 80, 3), dtype=np.uint8))

    def broken_colors(_image):
        raise TypeError("synthetic color TypeError")

    monkeypatch.setattr(local_vision, "analyze_colors", broken_colors)
    monkeypatch.setattr(local_vision, "analyze_pattern", lambda _image: PatternEvidence(label="velocity", confidence=0.8))

    result = local_vision.analyze_local_vision_sync(b"front", b"back", Settings())

    assert result.combined_text == "2025 PANINI CARD NO. 116"
    assert result.back is not None
    assert result.back.pattern.label == "velocity"
    assert result.back.colors == ColorEvidence()
    assert "back:opencv_color_failed:typeerror" in result.back.errors


def test_pattern_failure_does_not_erase_ocr_or_colors(monkeypatch):
    monkeypatch.setattr(local_vision, "AppleVisionOCR", lambda *_args, **_kwargs: WorkingOcr())
    monkeypatch.setattr(local_vision, "_decode_image", lambda _content: np.zeros((120, 80, 3), dtype=np.uint8))
    monkeypatch.setattr(local_vision, "analyze_colors", lambda _image: ColorEvidence(dominant_colors=["silver"]))

    def broken_pattern(_image):
        raise TypeError("synthetic pattern TypeError")

    monkeypatch.setattr(local_vision, "analyze_pattern", broken_pattern)
    result = local_vision.analyze_local_vision_sync(b"front", b"back", Settings())

    assert result.combined_text == "2025 PANINI CARD NO. 116"
    assert result.back is not None
    assert result.back.colors.dominant_colors == ["silver"]
    assert result.back.pattern == PatternEvidence()
    assert "back:opencv_pattern_failed:typeerror" in result.back.errors
