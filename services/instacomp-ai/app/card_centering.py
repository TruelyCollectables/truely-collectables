from __future__ import annotations

import io
from dataclasses import asdict, dataclass
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageOps


@dataclass(frozen=True)
class CenteringMeasurement:
    measurable: bool
    left_percent: float | None
    right_percent: float | None
    top_percent: float | None
    bottom_percent: float | None
    horizontal_ratio: str | None
    vertical_ratio: str | None
    confidence: float
    method: str
    warning: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _decode(content: bytes) -> np.ndarray:
    if not content:
        raise ValueError("empty image")
    with Image.open(io.BytesIO(content)) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        arr = np.array(image)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _order_quad(points: np.ndarray) -> np.ndarray:
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float32)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(-1)
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return ordered


def _quad_size(quad: np.ndarray) -> tuple[float, float]:
    tl, tr, br, bl = quad
    width = max(np.linalg.norm(tr-tl), np.linalg.norm(br-bl))
    height = max(np.linalg.norm(bl-tl), np.linalg.norm(br-tr))
    return float(width), float(height)


def _detect_outer_quad(bgr: np.ndarray) -> tuple[np.ndarray | None, float, str]:
    height, width = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 45, 135)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = float(width * height)
    best: tuple[float, np.ndarray, float] | None = None
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < image_area * 0.18:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * perimeter, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        quad = _order_quad(approx.reshape(4, 2))
        q_width, q_height = _quad_size(quad)
        if min(q_width, q_height) < 80:
            continue
        rectangularity = area / max(1.0, q_width * q_height)
        score = min(1.0, area / image_area) * min(1.0, rectangularity)
        if best is None or score > best[0]:
            best = (score, quad, rectangularity)
    if best is not None:
        area_score, quad, rectangularity = best
        confidence = min(1.0, 0.45 + 0.35 * area_score + 0.20 * min(1.0, rectangularity))
        return quad, confidence, "detected_outer_quad"
    ratio = min(width, height) / max(width, height)
    if 0.60 <= ratio <= 0.82:
        inset = max(1.0, min(width, height) * 0.004)
        quad = np.array([
            [inset, inset],
            [width - 1 - inset, inset],
            [width - 1 - inset, height - 1 - inset],
            [inset, height - 1 - inset],
        ], dtype=np.float32)
        return quad, 0.62, "full_frame_card_assumption"
    return None, 0.0, "outer_card_not_found"


def _warp_card(bgr: np.ndarray, quad: np.ndarray) -> np.ndarray:
    ordered = _order_quad(quad)
    source_width, source_height = _quad_size(ordered)
    portrait = source_height >= source_width
    target_width, target_height = (700, 1000) if portrait else (1000, 700)
    target = np.array([
        [0, 0],
        [target_width - 1, 0],
        [target_width - 1, target_height - 1],
        [0, target_height - 1],
    ], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(ordered, target)
    return cv2.warpPerspective(
        bgr, matrix, (target_width, target_height),
        flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE,
    )


def _smooth_profile(values: np.ndarray, width: int = 9) -> np.ndarray:
    width = max(3, int(width) | 1)
    kernel = np.ones(width, dtype=np.float32) / float(width)
    return np.convolve(values.astype(np.float32), kernel, mode="same")


def _axis_candidate(
    gradient: np.ndarray,
    canny: np.ndarray,
    *,
    axis: str,
    start: int,
    stop: int,
    prefer_outer: str,
) -> tuple[int | None, float, float, float]:
    height, width = gradient.shape
    if axis == "vertical":
        orth_lo, orth_hi = int(height * 0.12), int(height * 0.88)
        section = gradient[orth_lo:orth_hi, :]
        profile = _smooth_profile(section.mean(axis=0))
        lo, hi = max(2, start), min(width - 2, stop)
    else:
        orth_lo, orth_hi = int(width * 0.12), int(width * 0.88)
        section = gradient[:, orth_lo:orth_hi]
        profile = _smooth_profile(section.mean(axis=1))
        lo, hi = max(2, start), min(height - 2, stop)
    if hi <= lo + 4:
        return None, 0.0, 0.0, 0.0
    window = profile[lo:hi]
    baseline = float(np.median(window))
    mad = float(np.median(np.abs(window - baseline))) + 1e-6
    scale = 1.4826 * mad
    threshold = baseline + 2.3 * scale
    active = np.flatnonzero(window >= threshold)
    if active.size == 0:
        return None, 0.0, 0.0, 0.0
    groups: list[np.ndarray] = []
    split_at = np.where(np.diff(active) > 1)[0] + 1
    for group in np.split(active, split_at):
        if group.size:
            groups.append(group)
    coordinates: list[int] = []
    for group in groups:
        local = group[np.argmax(window[group])]
        coordinates.append(lo + int(local))
    coordinates.sort(reverse=prefer_outer == "high")
    best = (0.0, 0.0, 0.0)
    for coordinate in coordinates:
        peak = float(profile[coordinate])
        robust_z = max(0.0, (peak - baseline) / scale)
        if axis == "vertical":
            strip = canny[orth_lo:orth_hi, max(0, coordinate-3):min(width, coordinate+4)]
            continuity = float(np.mean(np.max(strip, axis=1) > 0)) if strip.size else 0.0
        else:
            strip = canny[max(0, coordinate-3):min(height, coordinate+4), orth_lo:orth_hi]
            continuity = float(np.mean(np.max(strip, axis=0) > 0)) if strip.size else 0.0
        score = 0.58 * min(1.0, robust_z / 7.0) + 0.42 * min(1.0, continuity / 0.70)
        if score > best[0]:
            best = (score, robust_z, continuity)
        if robust_z >= 2.3 and continuity >= 0.22:
            return coordinate, score, robust_z, continuity
    return None, best[0], best[1], best[2]


def _ratio(first: float, second: float) -> tuple[float, float, str]:
    total = first + second
    if total <= 0:
        raise ValueError("centering border total must be positive")
    a = 100.0 * first / total
    b = 100.0 - a
    return round(a, 1), round(b, 1), f"{round(a):d}/{round(b):d}"


def _not_measurable(method: str, warning: str, confidence: float = 0.0) -> CenteringMeasurement:
    return CenteringMeasurement(
        measurable=False,
        left_percent=None,
        right_percent=None,
        top_percent=None,
        bottom_percent=None,
        horizontal_ratio=None,
        vertical_ratio=None,
        confidence=round(max(0.0, min(1.0, confidence)), 3),
        method=method,
        warning=warning,
    )


def measure_card_centering(content: bytes) -> CenteringMeasurement:
    """Measure printed-frame centering without guessing on borderless/ambiguous cards."""
    try:
        bgr = _decode(content)
    except (OSError, ValueError) as exc:
        return _not_measurable("decode", f"image_not_readable:{exc}")
    quad, outer_confidence, outer_method = _detect_outer_quad(bgr)
    if quad is None:
        return _not_measurable(outer_method, "outer_card_boundary_not_confident")
    card = _warp_card(bgr, quad)
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    grad_x = np.abs(cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3))
    grad_y = np.abs(cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3))
    canny = cv2.Canny(gray, 45, 135)
    height, width = gray.shape
    # Perspective rectification creates a strong interpolation edge a few
    # pixels inside the warped card boundary. Ignore the outermost 2% so that
    # edge cannot masquerade as the printed frame we are trying to measure.
    left = _axis_candidate(grad_x, canny, axis="vertical", start=int(width*0.02), stop=int(width*0.25), prefer_outer="low")
    right = _axis_candidate(grad_x, canny, axis="vertical", start=int(width*0.75), stop=int(width*0.98), prefer_outer="high")
    top = _axis_candidate(grad_y, canny, axis="horizontal", start=int(height*0.02), stop=int(height*0.25), prefer_outer="low")
    bottom = _axis_candidate(grad_y, canny, axis="horizontal", start=int(height*0.75), stop=int(height*0.98), prefer_outer="high")
    candidates = {"left": left, "right": right, "top": top, "bottom": bottom}
    missing = [name for name, value in candidates.items() if value[0] is None]
    if missing:
        candidate_confidence = min(value[1] for value in candidates.values())
        return _not_measurable(
            f"{outer_method}+gradient_frame",
            "printed_frame_not_confident:" + ",".join(missing),
            outer_confidence * candidate_confidence,
        )
    left_x, right_x = int(left[0]), int(right[0])
    top_y, bottom_y = int(top[0]), int(bottom[0])
    left_border = float(left_x)
    right_border = float((width - 1) - right_x)
    top_border = float(top_y)
    bottom_border = float((height - 1) - bottom_y)
    if right_x <= left_x or bottom_y <= top_y:
        return _not_measurable(
            f"{outer_method}+gradient_frame", "inner_frame_geometry_invalid", outer_confidence * 0.25
        )
    inner_width = right_x - left_x
    inner_height = bottom_y - top_y
    if inner_width < width * 0.42 or inner_height < height * 0.42:
        return _not_measurable(
            f"{outer_method}+gradient_frame", "inner_frame_implausibly_small", outer_confidence * 0.30
        )
    if min(left_border, right_border, top_border, bottom_border) < 3.0:
        return _not_measurable(
            f"{outer_method}+gradient_frame", "printed_frame_too_close_to_card_edge", outer_confidence * 0.30
        )
    left_pct, right_pct, horizontal = _ratio(left_border, right_border)
    top_pct, bottom_pct, vertical = _ratio(top_border, bottom_border)
    edge_scores = [left[1], right[1], top[1], bottom[1]]
    confidence = outer_confidence * float(np.mean(edge_scores))
    if confidence < 0.42:
        return _not_measurable(
            f"{outer_method}+gradient_frame", "centering_evidence_below_confidence_floor", confidence
        )
    return CenteringMeasurement(
        measurable=True,
        left_percent=left_pct,
        right_percent=right_pct,
        top_percent=top_pct,
        bottom_percent=bottom_pct,
        horizontal_ratio=horizontal,
        vertical_ratio=vertical,
        confidence=round(min(1.0, confidence), 3),
        method=f"{outer_method}+gradient_frame",
        warning=None,
    )
