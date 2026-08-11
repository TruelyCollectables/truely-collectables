#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "services/instacomp-ai/app/local_vision.py"
TEST = ROOT / "services/instacomp-ai/tests/test_local_vision_stage_isolation.py"

text = TARGET.read_text("utf-8")
start = text.index("def _analyze_side(\n")
end = text.index("async def analyze_local_vision(\n", start)

replacement = '''def _bounded_stage_error(side: str, stage: str, error: Exception) -> str:
    return f"{side}:{stage}:{type(error).__name__.lower()}"


def _analyze_side(
    content: bytes,
    *,
    side: str,
    ocr: AppleVisionOCR | None,
    ocr_init_error: Exception | None = None,
) -> tuple[SideVisionEvidence, bool]:
    """Analyze one side without allowing any witness stage to erase the rest.

    Apple Vision OCR and OpenCV are independent evidence sources. Decode, color,
    pattern, or OCR failures are recorded as bounded errors and never suppress a
    surviving stage. The outer package fail-safe remains only for truly
    unexpected orchestration failures outside these bounded stages.
    """
    errors: list[str] = []
    observations: list[OCRObservation] = []

    if ocr is None:
        if ocr_init_error is not None:
            errors.append(_bounded_stage_error(side, "apple_vision_init_failed", ocr_init_error))
        else:
            errors.append(f"{side}:apple_vision_unavailable")
    else:
        try:
            observations, ocr_errors = ocr.recognize(content, side=side)
            errors.extend(ocr_errors)
        except Exception as error:
            errors.append(_bounded_stage_error(side, "apple_vision_stage_failed", error))

    image: np.ndarray | None = None
    width = 1
    height = 1
    opencv_ok = False
    try:
        image = _decode_image(content)
        height, width = [int(value) for value in image.shape[:2]]
        opencv_ok = True
    except Exception as error:
        errors.append(_bounded_stage_error(side, "opencv_decode_failed", error))

    colors = ColorEvidence()
    pattern = PatternEvidence()
    if image is not None:
        try:
            colors = analyze_colors(image)
        except Exception as error:
            errors.append(_bounded_stage_error(side, "opencv_color_failed", error))
        try:
            pattern = analyze_pattern(image)
        except Exception as error:
            errors.append(_bounded_stage_error(side, "opencv_pattern_failed", error))

    return (
        SideVisionEvidence(
            side=side,
            width=max(1, width),
            height=max(1, height),
            ocr=observations,
            colors=colors,
            pattern=pattern,
            errors=errors,
        ),
        opencv_ok,
    )


def _append_side_error(side: SideVisionEvidence, error: str) -> SideVisionEvidence:
    return side.model_copy(update={"errors": [*side.errors, error]})


def analyze_local_vision_sync(
    front: bytes,
    back: bytes | None,
    settings: Settings,
) -> LocalVisionEvidence:
    data_root = settings.resolve_local_path(settings.database_path).parent

    ocr: AppleVisionOCR | None = None
    ocr_init_error: Exception | None = None
    try:
        ocr = AppleVisionOCR(Path(settings.service_root), data_root)
    except Exception as error:
        ocr_init_error = error

    front_evidence, front_opencv_ok = _analyze_side(
        front,
        side="front",
        ocr=ocr,
        ocr_init_error=ocr_init_error,
    )
    back_evidence: SideVisionEvidence | None = None
    back_opencv_ok = False
    if back:
        back_evidence, back_opencv_ok = _analyze_side(
            back,
            side="back",
            ocr=ocr,
            ocr_init_error=ocr_init_error,
        )

    observations = [
        *front_evidence.ocr,
        *(back_evidence.ocr if back_evidence else []),
    ]

    try:
        serial = parse_serial_evidence(observations)
    except Exception as error:
        serial = SerialEvidence(stamp_present=False)
        front_evidence = _append_side_error(
            front_evidence,
            _bounded_stage_error("front", "serial_parse_failed", error),
        )

    try:
        identity_hints = build_identity_hints(
            front=front_evidence,
            back=back_evidence,
            serial=serial,
        )
    except Exception as error:
        identity_hints = CardIdentity()
        front_evidence = _append_side_error(
            front_evidence,
            _bounded_stage_error("front", "identity_hint_failed", error),
        )

    try:
        combined_text = _all_text(observations)
    except Exception as error:
        combined_text = ""
        front_evidence = _append_side_error(
            front_evidence,
            _bounded_stage_error("front", "combined_text_failed", error),
        )

    apple_vision_available = False
    if ocr is not None:
        try:
            apple_vision_available = bool(ocr.supported)
        except Exception as error:
            front_evidence = _append_side_error(
                front_evidence,
                _bounded_stage_error("front", "apple_vision_health_failed", error),
            )

    return LocalVisionEvidence(
        schema_version="tcos.instacomp-ai.local-vision.v1",
        front=front_evidence,
        back=back_evidence,
        serial=serial,
        identity_hints=identity_hints,
        combined_text=combined_text,
        apple_vision_available=apple_vision_available,
        opencv_available=front_opencv_ok or back_opencv_ok,
    )


'''

text = text[:start] + replacement + text[end:]
TARGET.write_text(text, "utf-8")

TEST.write_text('''from __future__ import annotations

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
''', "utf-8")

print("Patched local vision into independently fail-closed witness stages.")
