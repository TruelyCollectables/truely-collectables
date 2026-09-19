from __future__ import annotations

import cv2
import numpy as np

from app.card_centering import measure_card_centering


def _encode(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return encoded.tobytes()


def _bordered_card(
    *, left: int, right: int, top: int, bottom: int,
    perspective: bool = False,
) -> bytes:
    card_w, card_h = 600, 840
    canvas = np.full((1020, 780, 3), 25, dtype=np.uint8)
    card = np.full((card_h, card_w, 3), 235, dtype=np.uint8)
    cv2.rectangle(
        card, (left, top), (card_w - 1 - right, card_h - 1 - bottom),
        (25, 25, 25), 7,
    )
    cv2.rectangle(card, (left + 16, top + 18), (card_w-right-18, card_h-bottom-20), (150, 175, 200), -1)
    cv2.putText(card, "SPORTS CARD", (150, 390), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (80, 90, 100), 2)
    if not perspective:
        canvas[90:90+card_h, 90:90+card_w] = card
        return _encode(canvas)
    source = np.float32([[0, 0], [card_w-1, 0], [card_w-1, card_h-1], [0, card_h-1]])
    target = np.float32([[105, 70], [690, 115], [650, 950], [75, 900]])
    matrix = cv2.getPerspectiveTransform(source, target)
    warped = cv2.warpPerspective(card, matrix, (canvas.shape[1], canvas.shape[0]), borderValue=(25,25,25))
    return _encode(warped)


def _borderless_card() -> bytes:
    canvas = np.full((1020, 780, 3), 20, dtype=np.uint8)
    card = np.full((840, 600, 3), 210, dtype=np.uint8)
    for y in range(card.shape[0]):
        value = int(185 + 20 * y / card.shape[0])
        card[y, :, :] = (value, value + 4, value + 8)
    canvas[90:930, 90:690] = card
    return _encode(canvas)


def test_measures_directional_centering_ratio() -> None:
    result = measure_card_centering(_bordered_card(left=90, right=45, top=60, bottom=60))
    assert result.measurable is True
    assert result.horizontal_ratio is not None
    assert result.left_percent is not None and result.right_percent is not None
    assert abs(result.left_percent - 66.7) <= 4.0
    assert abs(result.right_percent - 33.3) <= 4.0
    assert result.top_percent is not None and abs(result.top_percent - 50.0) <= 4.0
    assert result.bottom_percent is not None and abs(result.bottom_percent - 50.0) <= 4.0


def test_centering_survives_perspective_rectification() -> None:
    result = measure_card_centering(
        _bordered_card(left=70, right=70, top=95, bottom=55, perspective=True)
    )
    assert result.measurable is True
    assert result.left_percent is not None and abs(result.left_percent - 50.0) <= 5.0
    assert result.right_percent is not None and abs(result.right_percent - 50.0) <= 5.0
    expected_top = 100.0 * 95 / (95 + 55)
    assert result.top_percent is not None and abs(result.top_percent - expected_top) <= 6.0


def test_borderless_card_fails_closed() -> None:
    result = measure_card_centering(_borderless_card())
    assert result.measurable is False
    assert result.horizontal_ratio is None
    assert result.vertical_ratio is None
    assert result.warning is not None


def test_unreadable_image_fails_closed() -> None:
    result = measure_card_centering(b"not-an-image")
    assert result.measurable is False
    assert result.method == "decode"
