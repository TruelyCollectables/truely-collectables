from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np
import pytest

from app.local_vision import _analyze_side, _decode_image, analyze_pattern
from app.lora_candidate_runtime import (
    _candidate_response_to_suggestion,
    _guard_model_pattern_parallel,
)
from app.models import CardIdentity, LocalVisionEvidence, PatternEvidence, SideVisionEvidence


def _synthetic_cracked_surface() -> np.ndarray:
    """Create deterministic card-sized edge geometry without mocks."""
    image = np.full((1100, 800, 3), 32, dtype=np.uint8)
    rng = np.random.default_rng(20260814)
    points = [
        (int(x), int(y))
        for x, y in zip(
            rng.integers(35, 765, size=90),
            rng.integers(35, 1065, size=90),
        )
    ]
    for index in range(0, len(points) - 2, 3):
        polygon = np.array(points[index : index + 3], dtype=np.int32)
        cv2.polylines(image, [polygon], True, (235, 235, 235), 2, cv2.LINE_AA)
    for x in range(50, 760, 55):
        cv2.line(image, (x, 40), (max(0, x - 260), 1060), (190, 190, 190), 1, cv2.LINE_AA)
    return image


def _jpeg(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return encoded.tobytes()


def _frozen_image_dir() -> Path:
    raw = os.environ.get("INSTACOMP_FROZEN_IMAGE_DIR")
    if not raw:
        pytest.skip("immutable Frozen Five image artifact not mounted")
    path = Path(raw)
    assert path.is_dir(), path
    return path


def _rickea_failed_mac_receipt_vision() -> LocalVisionEvidence:
    """Reproduce the exact discriminating geometry from the failed Mac receipt."""
    return LocalVisionEvidence(
        front=SideVisionEvidence(
            side="front",
            width=800,
            height=1200,
            pattern=PatternEvidence(
                label="cracked_ice",
                confidence=0.82,
                scores={"cracked_ice": 0.82},
                geometry=[
                    "detected 300 long line segments",
                    "detected 359 irregular polygon candidates",
                    "non-directional multi-angle edge geometry",
                ],
                line_count=300,
                polygon_count=359,
                edge_density=0.18,
                angle_entropy=0.86,
            ),
        ),
        # This reproduces the second hole too: merge_local_vision_payload used to
        # put the bad deterministic hint back after the earlier model-only guard.
        identity_hints=CardIdentity(parallel="Cracked Ice Prizm"),
    )


def test_native_analyze_pattern_returns_measurements() -> None:
    pattern = analyze_pattern(_synthetic_cracked_surface())
    assert set(pattern.scores) == {"velocity", "cracked_ice", "checkerboard", "sparkle"}
    assert pattern.edge_density > 0
    assert pattern.line_count > 0
    assert pattern.polygon_count >= 0
    assert 0 <= pattern.angle_concentration <= 1
    assert 0 <= pattern.angle_entropy <= 1


def test_real_side_pipeline_does_not_hide_native_pattern_typeerror() -> None:
    side, opencv_ok = _analyze_side(
        _jpeg(_synthetic_cracked_surface()),
        side="front",
        ocr=None,
    )
    assert opencv_ok is True
    assert not any("opencv_pattern_failed" in error for error in side.errors), side.errors
    assert side.pattern.scores, side.pattern
    assert side.pattern.edge_density > 0
    assert side.pattern.line_count > 0


def test_failed_mac_rickea_geometry_cannot_authorize_ice() -> None:
    parsed = {"identity": {"parallel": "Cracked Ice Prizm"}}
    guarded = _guard_model_pattern_parallel(parsed, _rickea_failed_mac_receipt_vision())
    assert guarded["identity"]["parallel"] is None


def test_flat_rickea_sidecar_and_reinjected_hint_are_both_blocked() -> None:
    payload = {
        "ok": True,
        "validation_eligible": True,
        "model": "mlx-community/Qwen3-VL-2B-Instruct-4bit",
        "adapter_name": "fixture-adapter",
        "parsed": {
            "sport": "Basketball",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Panini Prizm",
            "set_name": "2025 Panini Prizm WNBA - Green Prizms",
            "player": "Rickea Jackson",
            "card_number": "118",
            "parallel": "Cracked Ice Prizm",
            "evidence": {"visible_text": ["RICKEA JACKSON", "118", "PRIZM"]},
        },
    }
    suggestion = _candidate_response_to_suggestion(
        payload,
        local_vision=_rickea_failed_mac_receipt_vision(),
    )
    assert suggestion.identity.player == "Rickea Jackson"
    assert suggestion.identity.card_number == "118"
    # The captured failed receipt is front-only. With no authoritative bold
    # black PRIZM mark on the back, the card must finish as regular Base.
    assert suggestion.identity.parallel == "Base"
    assert suggestion.raw["pattern_parallel_guard_stage"] == "post_normalization_post_local_merge"


@pytest.mark.parametrize(
    "filename",
    [
        "01-ef0e06a3-a6de-4242-8c52-52b420185850-front.jpg",
        "01-ef0e06a3-a6de-4242-8c52-52b420185850-back.jpg",
        "02-0916fe9d-2837-4d91-add4-73e7216705cd-front.jpg",
        "02-0916fe9d-2837-4d91-add4-73e7216705cd-back.jpg",
        "03-66f9ad9e-43fb-4b2b-b79c-ac99fa082de0-front.jpg",
        "03-66f9ad9e-43fb-4b2b-b79c-ac99fa082de0-back.jpg",
        "04-f7d73af4-7299-4ed6-b663-39206f2576ee-front.jpg",
        "04-f7d73af4-7299-4ed6-b663-39206f2576ee-back.jpg",
        "05-e9335a9d-3cc1-48d3-92db-7be7468714a9-front.jpg",
        "05-e9335a9d-3cc1-48d3-92db-7be7468714a9-back.jpg",
    ],
)
def test_exact_frozen_physical_images_run_pattern_stage_without_exception(filename: str) -> None:
    content = (_frozen_image_dir() / filename).read_bytes()
    pattern = analyze_pattern(_decode_image(content))
    assert set(pattern.scores) == {"velocity", "cracked_ice", "checkerboard", "sparkle"}
    assert pattern.edge_density > 0
    assert pattern.line_count > 0


@pytest.mark.parametrize(
    ("filename", "expected_label"),
    [
        ("02-0916fe9d-2837-4d91-add4-73e7216705cd-front.jpg", "cracked_ice"),
        ("04-f7d73af4-7299-4ed6-b663-39206f2576ee-front.jpg", "cracked_ice"),
    ],
)
def test_exact_frozen_ice_fronts_have_cracked_ice_geometry(
    filename: str,
    expected_label: str,
) -> None:
    content = (_frozen_image_dir() / filename).read_bytes()
    side, opencv_ok = _analyze_side(content, side="front", ocr=None)
    assert opencv_ok is True
    assert not any("opencv_pattern_failed" in error for error in side.errors), side.errors
    assert side.pattern.label == expected_label, side.pattern
    assert side.pattern.confidence >= 0.70, side.pattern
    assert side.pattern.scores.get("cracked_ice", 0) >= 0.70, side.pattern


@pytest.mark.parametrize(
    "filename",
    [
        "01-ef0e06a3-a6de-4242-8c52-52b420185850-front.jpg",
        "03-66f9ad9e-43fb-4b2b-b79c-ac99fa082de0-front.jpg",
        "05-e9335a9d-3cc1-48d3-92db-7be7468714a9-front.jpg",
    ],
)
def test_exact_frozen_non_ice_fronts_never_emit_cracked_ice_hint(filename: str) -> None:
    content = (_frozen_image_dir() / filename).read_bytes()
    side, opencv_ok = _analyze_side(content, side="front", ocr=None)
    assert opencv_ok is True
    assert side.pattern.label != "cracked_ice", side.pattern


@pytest.mark.parametrize(
    ("filename", "should_keep_cracked_ice"),
    [
        ("02-0916fe9d-2837-4d91-add4-73e7216705cd-front.jpg", True),
        ("04-f7d73af4-7299-4ed6-b663-39206f2576ee-front.jpg", True),
        ("05-e9335a9d-3cc1-48d3-92db-7be7468714a9-front.jpg", False),
    ],
)
def test_exact_physical_images_gate_lora_cracked_ice_claim(
    filename: str,
    should_keep_cracked_ice: bool,
) -> None:
    content = (_frozen_image_dir() / filename).read_bytes()
    side, opencv_ok = _analyze_side(content, side="front", ocr=None)
    assert opencv_ok is True
    parsed = {
        "identity": {
            "parallel": "Cracked Ice Prizm",
        }
    }
    guarded = _guard_model_pattern_parallel(
        parsed,
        SimpleNamespace(front=SimpleNamespace(pattern=side.pattern)),
    )
    if should_keep_cracked_ice:
        assert guarded["identity"]["parallel"] == "Cracked Ice Prizm", side.pattern
    else:
        assert guarded["identity"]["parallel"] is None, side.pattern
