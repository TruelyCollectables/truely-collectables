from __future__ import annotations

import cv2
import numpy as np

from app.local_vision import _analyze_side, analyze_pattern


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
