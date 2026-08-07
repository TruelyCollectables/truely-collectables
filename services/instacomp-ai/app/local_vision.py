from __future__ import annotations

import asyncio
import io
import math
import re
from collections import Counter
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from PIL import Image, ImageOps

from .apple_vision import AppleVisionOCR
from .config import Settings
from .models import (
    CardIdentity,
    ColorEvidence,
    LocalVisionEvidence,
    OCRObservation,
    PatternEvidence,
    SerialEvidence,
    SideVisionEvidence,
)

MANUFACTURERS = {
    "panini": "Panini",
    "topps": "Topps",
    "bowman": "Bowman",
    "upper deck": "Upper Deck",
    "leaf": "Leaf",
    "donruss": "Donruss",
    "fleer": "Fleer",
    "score": "Score",
    "o-pee-chee": "O-Pee-Chee",
    "o pee chee": "O-Pee-Chee",
}

PLAYER_STOPWORDS = {
    "panini",
    "prizm",
    "select",
    "wnba",
    "nba",
    "rookie",
    "card",
    "cards",
    "basketball",
    "official",
    "trading",
    "copyright",
    "concourse",
    "premier",
    "courtside",
    "silver",
    "green",
    "blue",
    "red",
    "gold",
    "velocity",
    "cracked",
    "ice",
}

SERIAL_EXACT_RE = re.compile(r"(?<!\d)(\d{1,5})\s*/\s*(\d{1,6})(?!\d)")
SERIAL_OF_RE = re.compile(r"(?<!\d)(\d{1,5})\s+(?:OF|of)\s+(\d{1,6})(?!\d)")
SERIAL_DENOMINATOR_RE = re.compile(r"(?:^|\s)/\s*(\d{1,6})(?!\d)")
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
CARD_NUMBER_PATTERNS = [
    re.compile(r"\b(?:CARD\s*(?:NO\.?|NUMBER)?|NO\.?)\s*[:#-]?\s*([A-Z0-9-]{1,12})\b", re.I),
    re.compile(r"#\s*([A-Z0-9-]{1,12})\b", re.I),
]


def _decode_image(content: bytes) -> np.ndarray:
    array = np.frombuffer(content, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("OpenCV could not decode image")
    height, width = image.shape[:2]
    max_edge = max(height, width)
    if max_edge > 1200:
        scale = 1200 / max_edge
        image = cv2.resize(
            image,
            (max(1, int(width * scale)), max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return image


def _color_name(hue: float, saturation: float, value: float) -> str:
    if value < 42:
        return "black"
    if saturation < 28:
        if value > 225:
            return "white"
        if value > 135:
            return "silver"
        return "gray"
    if hue < 10 or hue >= 170:
        return "red"
    if hue < 22:
        return "orange"
    if hue < 36:
        return "yellow"
    if hue < 83:
        return "green"
    if hue < 100:
        return "cyan"
    if hue < 132:
        return "blue"
    if hue < 155:
        return "purple"
    return "pink"


def analyze_colors(image: np.ndarray) -> ColorEvidence:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    pixels = hsv.reshape(-1, 3)
    if len(pixels) > 80_000:
        stride = max(1, len(pixels) // 80_000)
        pixels = pixels[::stride]

    counts: Counter[str] = Counter()
    saturation_values: list[float] = []
    brightness_values: list[float] = []
    for hue, saturation, value in pixels:
        name = _color_name(float(hue), float(saturation), float(value))
        counts[name] += 1
        saturation_values.append(float(saturation) / 255.0)
        brightness_values.append(float(value) / 255.0)

    total = max(1, sum(counts.values()))
    proportions = {
        name: round(count / total, 4)
        for name, count in counts.most_common()
        if count / total >= 0.015
    }
    dominant = list(proportions)[:4]
    metallic_score = float(
        np.mean(
            (hsv[:, :, 1] < 58)
            & (hsv[:, :, 2] > 105)
            & (hsv[:, :, 2] < 245)
        )
    )
    return ColorEvidence(
        dominant_colors=dominant,
        proportions=proportions,
        mean_saturation=round(float(np.mean(saturation_values)), 4),
        mean_brightness=round(float(np.mean(brightness_values)), 4),
        metallic_score=round(metallic_score, 4),
    )


def _angle_entropy(angles: list[float]) -> float:
    if not angles:
        return 0.0
    histogram, _ = np.histogram(angles, bins=12, range=(0, 180))
    probabilities = histogram / max(1, histogram.sum())
    nonzero = probabilities[probabilities > 0]
    entropy = -float(np.sum(nonzero * np.log2(nonzero)))
    return min(1.0, entropy / math.log2(12))


def analyze_pattern(image: np.ndarray) -> PatternEvidence:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 60, 165)
    edge_density = float(np.mean(edges > 0))

    min_length = max(20, min(image.shape[:2]) // 14)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=max(22, min(image.shape[:2]) // 20),
        minLineLength=min_length,
        maxLineGap=max(6, min_length // 3),
    )
    angles: list[float] = []
    lengths: list[float] = []
    if lines is not None:
        for line in lines[:300]:
            x1, y1, x2, y2 = [int(value) for value in line[0]]
            dx = x2 - x1
            dy = y2 - y1
            length = math.hypot(dx, dy)
            if length < min_length:
                continue
            angle = math.degrees(math.atan2(dy, dx)) % 180
            angles.append(angle)
            lengths.append(length)

    dominant_angle: float | None = None
    angle_concentration = 0.0
    diagonal_ratio = 0.0
    orthogonal_ratio = 0.0
    if angles:
        histogram, boundaries = np.histogram(angles, bins=18, range=(0, 180), weights=lengths)
        winner = int(np.argmax(histogram))
        dominant_angle = round(float((boundaries[winner] + boundaries[winner + 1]) / 2), 2)
        angle_concentration = float(histogram[winner] / max(1.0, histogram.sum()))
        diagonal_ratio = float(
            sum(length for angle, length in zip(angles, lengths) if 20 <= angle <= 70 or 110 <= angle <= 160)
            / max(1.0, sum(lengths))
        )
        orthogonal_ratio = float(
            sum(
                length
                for angle, length in zip(angles, lengths)
                if angle <= 12 or angle >= 168 or 78 <= angle <= 102
            )
            / max(1.0, sum(lengths))
        )

    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    polygon_count = 0
    small_bright_components = 0
    image_area = image.shape[0] * image.shape[1]
    for contour in contours[:3000]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.00004 or area > image_area * 0.035:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        vertices = len(cv2.approxPolyDP(contour, 0.025 * perimeter, True))
        if 4 <= vertices <= 12:
            polygon_count += 1
        x, y, width, height = cv2.boundingRect(contour)
        if max(width, height) <= max(18, min(image.shape[:2]) * 0.035):
            patch = gray[y : y + height, x : x + width]
            if patch.size and float(np.mean(patch)) > 188:
                small_bright_components += 1

    entropy = _angle_entropy(angles)
    velocity_score = min(
        1.0,
        0.48 * min(1.0, len(angles) / 40)
        + 0.30 * diagonal_ratio
        + 0.22 * min(1.0, angle_concentration * 3.0),
    )
    cracked_ice_score = min(
        1.0,
        0.52 * min(1.0, polygon_count / 48)
        + 0.24 * entropy
        + 0.24 * min(1.0, edge_density / 0.22),
    )
    checkerboard_score = min(
        1.0,
        0.55 * orthogonal_ratio
        + 0.25 * min(1.0, len(angles) / 70)
        + 0.20 * min(1.0, polygon_count / 60),
    )
    sparkle_score = min(
        1.0,
        0.65 * min(1.0, small_bright_components / 75)
        + 0.35 * min(1.0, edge_density / 0.18),
    )

    scores = {
        "velocity": round(velocity_score, 4),
        "cracked_ice": round(cracked_ice_score, 4),
        "checkerboard": round(checkerboard_score, 4),
        "sparkle": round(sparkle_score, 4),
    }
    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    label = "unknown"
    confidence = 0.0
    if ordered[0][1] >= 0.62 and ordered[0][1] - ordered[1][1] >= 0.08:
        label, confidence = ordered[0]

    geometry: list[str] = []
    if len(angles) >= 8:
        geometry.append(f"detected {len(angles)} long line segments")
    if diagonal_ratio >= 0.45:
        geometry.append("directional diagonal line geometry")
    if angle_concentration >= 0.30 and dominant_angle is not None:
        geometry.append(f"dominant line angle about {dominant_angle} degrees")
    if polygon_count >= 12:
        geometry.append(f"detected {polygon_count} irregular polygon candidates")
    if entropy >= 0.72:
        geometry.append("non-directional multi-angle edge geometry")
    if small_bright_components >= 12:
        geometry.append(f"detected {small_bright_components} small bright components")

    return PatternEvidence(
        label=label,
        confidence=round(confidence, 4),
        scores=scores,
        geometry=geometry,
        line_count=len(angles),
        polygon_count=polygon_count,
        edge_density=round(edge_density, 4),
        dominant_angle=dominant_angle,
        angle_concentration=round(angle_concentration, 4),
        angle_entropy=round(entropy, 4),
    )


def parse_serial_evidence(observations: Iterable[OCRObservation]) -> SerialEvidence:
    exact_candidates: list[tuple[float, OCRObservation, re.Match[str]]] = []
    denominator_candidates: list[tuple[float, OCRObservation, int]] = []
    for observation in observations:
        for pattern in (SERIAL_EXACT_RE, SERIAL_OF_RE):
            match = pattern.search(observation.text)
            if match:
                exact_candidates.append((observation.confidence, observation, match))
        for match in SERIAL_DENOMINATOR_RE.finditer(observation.text):
            denominator_candidates.append(
                (observation.confidence, observation, int(match.group(1)))
            )

    if exact_candidates:
        confidence, observation, match = max(exact_candidates, key=lambda value: value[0])
        numerator = int(match.group(1))
        denominator = int(match.group(2))
        return SerialEvidence(
            stamp_present=True,
            exact_stamp=f"{numerator}/{denominator}",
            numerator=numerator,
            visible_denominator=denominator,
            side=observation.side,
            confidence=round(confidence, 4),
            source_text=observation.text,
            box=observation.box,
        )

    if denominator_candidates:
        confidence, observation, denominator = max(
            denominator_candidates, key=lambda value: value[0]
        )
        return SerialEvidence(
            stamp_present=False,
            exact_stamp=None,
            numerator=None,
            visible_denominator=denominator,
            side=observation.side,
            confidence=round(confidence, 4),
            source_text=observation.text,
            box=observation.box,
        )

    return SerialEvidence(stamp_present=False)


def _all_text(observations: Iterable[OCRObservation]) -> str:
    return "\n".join(dict.fromkeys(value.text for value in observations if value.text))


def _year_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)
    scores: dict[int, float] = {}
    for observation in values:
        text = str(observation.text or "")
        ox = observation.box.x + observation.box.width / 2
        oy = observation.box.y + observation.box.height / 2
        nearby = [text]
        # Apple Vision can split a footer such as "2025 PANINI" into separate
        # boxes. Recover same-row context so the release/copyright year still
        # outranks a season/stat year elsewhere on the back.
        for candidate in values:
            if candidate is observation or candidate.side != observation.side:
                continue
            cx = candidate.box.x + candidate.box.width / 2
            cy = candidate.box.y + candidate.box.height / 2
            if abs(cy - oy) <= 0.075 and abs(cx - ox) <= 0.58:
                nearby.append(str(candidate.text or ""))
        context = " ".join(nearby)
        lowered = context.lower()
        for raw in YEAR_RE.findall(text):
            year = int(raw)
            if not 1900 <= year <= 2035:
                continue
            score = max(0.05, float(observation.confidence))
            if observation.side == "back":
                score += 0.15
            # Product/copyright lines describe the card's release year and must
            # outrank historical season/stat rows such as "2024 WNBA TOTALS".
            if any(name in lowered for name in MANUFACTURERS):
                score += 5.0
            if any(token in lowered for token in ("prizm", "select", "basketball", "baseball", "hockey", "football")):
                score += 2.0
            if "licensed product" in lowered or "©" in context:
                score += 2.0
            if any(token in lowered for token in ("totals", "season", "ncaa", "stats")):
                score -= 1.5
            scores[year] = scores.get(year, 0.0) + score
    if not scores:
        return None
    return str(max(scores, key=lambda value: (scores[value], value)))


def _manufacturer_hint(text: str) -> str | None:
    lowered = text.lower()
    for needle, canonical in MANUFACTURERS.items():
        if needle in lowered:
            return canonical
    return None


def _card_number_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)

    # Score complete labeled hits instead of returning the first regex match.
    # Biographical copy can contain phrases such as "No. 1 overall pick"; that
    # is not the printed card number and must never outrank the short upper-back
    # card-number marking.
    labeled: list[tuple[float, str]] = []
    for observation in values:
        text = str(observation.text or "").strip()
        for pattern in CARD_NUMBER_PATTERNS:
            match = pattern.search(text)
            if not match:
                continue
            token = match.group(1).strip().upper()
            if token.isdigit() and 1900 <= int(token) <= 2035:
                continue
            cy = observation.box.y + observation.box.height / 2
            word_count = len(text.split())
            score = max(0.05, float(observation.confidence))
            if observation.side == "back":
                score += 1.0
            if cy >= 0.72:
                score += 3.0
            if word_count <= 3:
                score += 2.0
            elif word_count >= 6:
                score -= 2.5
            lowered = text.lower()
            if any(phrase in lowered for phrase in ("overall pick", "draft pick", "season", "totals", "stats")):
                score -= 4.0
            trailing = text[match.end():].strip()
            if len(trailing) > 12:
                score -= 1.5
            labeled.append((score, token))
    if labeled:
        best_score, best_token = max(labeled, key=lambda value: value[0])
        if best_score >= 2.5:
            return best_token

    # Apple Vision frequently separates the printed "No." label and the value
    # into adjacent OCR boxes. Pair those boxes geometrically instead of asking
    # Qwen to guess the number from the image again.
    label_re = re.compile(r"^(?:no\.?|card(?:\s*(?:no\.?|number))?)$", re.I)
    value_re = re.compile(r"^[A-Z]{0,4}\d+[A-Z0-9-]{0,8}$", re.I)
    labels = [value for value in values if label_re.match(value.text.strip())]
    candidates = [
        value
        for value in values
        if value_re.match(value.text.strip())
        and not (value.text.strip().isdigit() and 1900 <= int(value.text.strip()) <= 2035)
    ]
    best: tuple[float, str] | None = None
    for label in labels:
        lx = label.box.x + label.box.width / 2
        ly = label.box.y + label.box.height / 2
        for candidate in candidates:
            if candidate.side != label.side:
                continue
            cx = candidate.box.x + candidate.box.width / 2
            cy = candidate.box.y + candidate.box.height / 2
            dx = abs(cx - lx)
            dy = abs(cy - ly)
            if dx > 0.34 or dy > 0.16:
                continue
            score = (2.0 - 2.5 * dy - 1.2 * dx) + candidate.confidence
            if cx >= lx - 0.05:
                score += 0.35
            if cy >= 0.72:
                score += 1.0
            token = candidate.text.strip().upper()
            if best is None or score > best[0]:
                best = (score, token)
    if best:
        return best[1]

    # Final fail-closed rescue for a dropped "No." label: accept a standalone
    # token only when exactly one distinct non-year candidate appears in the
    # upper portion of the back. Multiple candidates remain unresolved.
    upper_back_tokens = {
        value.text.strip().upper()
        for value in candidates
        if value.side == "back"
        and value.confidence >= 0.72
        and (value.box.y + value.box.height / 2) >= 0.72
    }
    return next(iter(upper_back_tokens)) if len(upper_back_tokens) == 1 else None


def _player_hint(observations: Iterable[OCRObservation]) -> str | None:
    candidates: list[tuple[float, str]] = []
    for observation in observations:
        if observation.side != "front":
            continue
        cleaned = re.sub(r"[^A-Za-z .'-]+", " ", observation.text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        if not 2 <= len(words) <= 5:
            continue
        lowered_words = {word.lower().strip(".'-") for word in words}
        if lowered_words & PLAYER_STOPWORDS:
            continue
        if any(len(word) < 2 for word in words):
            continue
        score = observation.confidence * (0.7 + min(0.3, observation.box.height * 5))
        candidates.append((score, cleaned))
    return max(candidates, default=(0.0, None), key=lambda value: value[0])[1]


def _parallel_hint(
    *,
    front: SideVisionEvidence,
    back: SideVisionEvidence | None,
) -> str | None:
    # Dominant image colors describe jerseys, borders, backgrounds, and photos;
    # they are not sufficient evidence for a named parallel. Only emit a local
    # parallel hint when measured surface geometry itself is confident.
    label = front.pattern.label
    confidence = float(front.pattern.confidence or 0)
    if confidence < 0.70:
        return None
    if label == "velocity":
        return "Velocity Prizm"
    if label == "cracked_ice":
        return "Cracked Ice Prizm"
    return None


def build_identity_hints(
    *,
    front: SideVisionEvidence,
    back: SideVisionEvidence | None,
    serial: SerialEvidence,
) -> CardIdentity:
    observations = [*front.ocr, *(back.ocr if back else [])]
    text = _all_text(observations)
    exact_serial = serial.exact_stamp if serial.stamp_present else None
    return CardIdentity(
        year=_year_hint(observations),
        manufacturer=_manufacturer_hint(text),
        player=_player_hint(observations),
        card_number=_card_number_hint(observations),
        parallel=_parallel_hint(front=front, back=back),
        serial_number=exact_serial,
        serial_run=serial.visible_denominator,
        autograph=True if re.search(r"\b(?:autograph|authentic signature)\b", text, re.I) else None,
        memorabilia=True if re.search(r"\b(?:game-used|player-worn|memorabilia|relic|jersey|patch)\b", text, re.I) else None,
        rookie=True if re.search(r"\b(?:rookie|rc)\b", text, re.I) else None,
    )


def _analyze_side(
    content: bytes,
    *,
    side: str,
    ocr: AppleVisionOCR,
) -> SideVisionEvidence:
    image = _decode_image(content)
    observations, errors = ocr.recognize(content, side=side)
    return SideVisionEvidence(
        side=side,
        width=int(image.shape[1]),
        height=int(image.shape[0]),
        ocr=observations,
        colors=analyze_colors(image),
        pattern=analyze_pattern(image),
        errors=errors,
    )


def analyze_local_vision_sync(
    front: bytes,
    back: bytes | None,
    settings: Settings,
) -> LocalVisionEvidence:
    data_root = settings.resolve_local_path(settings.database_path).parent
    ocr = AppleVisionOCR(Path(settings.service_root), data_root)
    front_evidence = _analyze_side(front, side="front", ocr=ocr)
    back_evidence = _analyze_side(back, side="back", ocr=ocr) if back else None
    observations = [
        *front_evidence.ocr,
        *(back_evidence.ocr if back_evidence else []),
    ]
    serial = parse_serial_evidence(observations)
    identity_hints = build_identity_hints(
        front=front_evidence,
        back=back_evidence,
        serial=serial,
    )
    return LocalVisionEvidence(
        schema_version="tcos.instacomp-ai.local-vision.v1",
        front=front_evidence,
        back=back_evidence,
        serial=serial,
        identity_hints=identity_hints,
        combined_text=_all_text(observations),
        apple_vision_available=ocr.supported,
        opencv_available=True,
    )


async def analyze_local_vision(
    front: bytes,
    back: bytes | None,
    settings: Settings,
) -> LocalVisionEvidence:
    return await asyncio.to_thread(analyze_local_vision_sync, front, back, settings)


def synthetic_text_image(text: str, *, width: int = 800, height: int = 1100) -> bytes:
    """Small test helper used by the macOS native OCR acceptance test."""
    image = Image.new("RGB", (width, height), "white")
    from PIL import ImageDraw, ImageFont

    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 42)
    except OSError:
        font = ImageFont.load_default()
    draw.text((60, 100), text, fill="black", font=font)
    output = io.BytesIO()
    image.save(output, format="JPEG", quality=94, progressive=False)
    return output.getvalue()
