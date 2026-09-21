from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
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
from .card_centering import measure_card_centering
from .config import Settings
from .models import (
    CardIdentity,
    CenteringEvidence,
    ColorEvidence,
    LocalVisionEvidence,
    OCRObservation,
    PatternEvidence,
    SerialEvidence,
    SideVisionEvidence,
)

# Bump whenever OCR/parsing/pattern semantics change. Exact-image cache entries
# without this precise engine marker are treated as stale and recomputed once.
LOCAL_VISION_ENGINE_VERSION = "2026-09-18.4"

MANUFACTURERS = {
    "panini": "Panini",
    "topps": "Topps",
    "upper deck": "Upper Deck",
    "leaf": "Leaf",
}

BRANDS = {
    "prizm": "Prizm",
    "prism": "Prizm",
    "przm": "Prizm",
    "przn": "Prizm",
    "select": "Select",
    "donruss": "Donruss",
    "optic": "Donruss Optic",
    "mosaic": "Mosaic",
    "bowman": "Bowman",
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
    "no",
    "basketball",
    "official",
    "trading",
    "copyright",
    "american",
    "mcdonald's",
    "mcdonalds",
    "all",
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

SUBSET_PHRASES = {
    "all american": "All American",
    "all-stars": "All-Stars",
    "all stars": "All-Stars",
    "all-sta": "All-Stars",
    "draft picks": "Draft Picks",
    "crunch time": "Crunch Time",
    "en fuego": "En Fuego",
    "fireworks": "Fireworks",
    "freworks": "Fireworks",
    "rated rookies": "Rated Rookies",
    "rated rookie": "Rated Rookies",
    "rated": "Rated Rookies",
    "tunnel vision": "Tunnel Vision",
    "snapshots": "Snapshots",
    "premier level": "Base Set - Premier Level",
    "concourse": "Base Set - Concourse",
    "cuncourse": "Base Set - Concourse",
    "cohcourse": "Base Set - Concourse",
    "courtside": "Base Set - Courtside",
}

SET_TITLE_STOPWORDS = {
    "panini", "topps", "bowman", "upper", "deck", "leaf", "donruss", "fleer", "score",
    "prizm", "prism", "select", "optic", "mosaic", "wnba", "nba", "nfl", "nhl", "mlb",
    "basketball", "baseball", "football", "hockey", "rookie", "official", "trading", "card",
    "cards", "copyright", "concourse", "premier", "courtside",
}


SERIAL_EXACT_RE = re.compile(r"(?<!\d)(\d{1,5})\s*/\s*(\d{1,6})(?!\d)")
SERIAL_OF_RE = re.compile(r"(?<!\d)(\d{1,5})\s+(?:OF|of)\s+(\d{1,6})(?!\d)")
SERIAL_DENOMINATOR_RE = re.compile(r"(?:^|\s)/\s*(\d{1,6})(?!\d)")
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
CARD_NUMBER_PATTERNS = [
    re.compile(r"\b(?:CARD\s+(?:NO(?:\.(?!\w)|\b)|NUMBER)|NO(?:\.(?!\w)|\b))\s*[:#-]?\s*([A-Z0-9-]{1,12})\b", re.I),
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


def analyze_treatment_colors(image: np.ndarray) -> ColorEvidence:
    """Measure likely foil/border treatment while suppressing player/photo center."""
    h, w = image.shape[:2]
    if h < 8 or w < 8:
        return analyze_colors(image)
    # Card treatments usually repeat around the perimeter. Exclude the central
    # portrait/jersey region so team colors cannot dominate parallel identity.
    border_y = max(1, int(h * 0.18)); border_x = max(1, int(w * 0.18))
    mask = np.ones((h, w), dtype=bool)
    mask[border_y:h-border_y, border_x:w-border_x] = False
    pixels = image[mask]
    if len(pixels) < 100:
        return analyze_colors(image)
    return analyze_colors(pixels.reshape((-1, 1, 3)))


def analyze_pattern(image: np.ndarray) -> PatternEvidence:
    # Surface finish lives primarily in the border/foil treatment. Running edge
    # geometry across the whole card makes player outlines, lettering and frame
    # design look like cracked ice. Suppress the portrait/text-heavy center.
    h, w = image.shape[:2]
    work = image.copy()
    if h >= 80 and w >= 80:
        y0, y1 = int(h * 0.18), int(h * 0.82)
        x0, x1 = int(w * 0.18), int(w * 0.82)
        border_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        neutral = int(np.median(border_gray))
        work[y0:y1, x0:x1] = neutral
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
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
    # Dense orthogonal borders/frames are ubiquitous in card design and made
    # the checkerboard heuristic saturate on ordinary Select cards. Do not emit
    # checkerboard from line geometry alone; it needs a future cell/repetition
    # detector that can prove an actual checkerboard treatment.
    if label == "checkerboard":
        label, confidence = "unknown", 0.0

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
    values = list(observations)
    clean_candidates: list[tuple[float, OCRObservation, re.Match[str]]] = []
    noisy_candidates: list[tuple[float, OCRObservation, re.Match[str]]] = []
    denominator_candidates: list[tuple[float, OCRObservation, int]] = []

    bare_serial_re = re.compile(
        r"^\s*[#(\[{]*\s*(?:\d{1,5}\s*/\s*\d{1,6}|\d{1,5}\s+(?:OF|of)\s+\d{1,6})\s*[)\]}.,;:!]*\s*$"
    )
    explicit_serial_cue_re = re.compile(r"\b(?:serial|numbered|copy)\b", re.I)

    for observation in values:
        text = str(observation.text or "").strip()
        exact_hits: list[re.Match[str]] = []
        for pattern in (SERIAL_EXACT_RE, SERIAL_OF_RE):
            exact_hits.extend(pattern.finditer(text))
        if exact_hits:
            for match in exact_hits:
                # A fraction embedded in biography/stat prose (for example
                # "game, 8/15...Finished fifth...") is not a stamped serial.
                # Treat only an isolated fraction or explicit SERIAL/NUMBERED/COPY
                # marking as authoritative from a single OCR channel.
                if bare_serial_re.match(text) or (explicit_serial_cue_re.search(text) and len(text.split()) <= 8):
                    clean_candidates.append((float(observation.confidence), observation, match))
                else:
                    noisy_candidates.append((float(observation.confidence), observation, match))
            # Do not also reinterpret the denominator inside a rejected noisy
            # x/N fraction as denominator-only evidence.
            continue
        for match in SERIAL_DENOMINATOR_RE.finditer(text):
            denominator_candidates.append((float(observation.confidence), observation, int(match.group(1))))

    def candidate_tuple(item: tuple[float, OCRObservation, re.Match[str]]) -> tuple[int, int]:
        return int(item[2].group(1)), int(item[2].group(2))

    def valid_candidates(items: list[tuple[float, OCRObservation, re.Match[str]]]):
        out = []
        for item in items:
            numerator, denominator = candidate_tuple(item)
            source_lower = str(item[1].text or "").lower()
            if numerator > denominator:
                continue
            if "©" in str(item[1].text or "") and ("panini" in source_lower or "america" in source_lower):
                continue
            out.append(item)
        return out

    clean_candidates = valid_candidates(clean_candidates)
    if clean_candidates:
        pairs = {candidate_tuple(item) for item in clean_candidates}
        if len(pairs) > 1:
            denoms = {pair[1] for pair in pairs}
            if len(denoms) == 1:
                return SerialEvidence(stamp_present=False, visible_denominator=next(iter(denoms)))
            return SerialEvidence(stamp_present=False)
        confidence, observation, match = max(clean_candidates, key=lambda value: value[0])
        numerator, denominator = candidate_tuple((confidence, observation, match))
        return SerialEvidence(stamp_present=True, exact_stamp=f"{numerator}/{denominator}", numerator=numerator,
            visible_denominator=denominator, side=observation.side, confidence=round(confidence, 4),
            source_text=observation.text, box=observation.box)

    noisy_candidates = valid_candidates(noisy_candidates)
    grouped: dict[tuple[int, int], list[tuple[float, OCRObservation, re.Match[str]]]] = {}
    for item in noisy_candidates:
        grouped.setdefault(candidate_tuple(item), []).append(item)
    corroborated = []
    for pair, items in grouped.items():
        channels = {(str(item[1].side), str(item[1].source)) for item in items}
        if len(channels) >= 2:
            corroborated.append((max(item[0] for item in items), pair, max(items, key=lambda item: item[0])))
    if corroborated:
        _, (numerator, denominator), best = max(corroborated, key=lambda item: item[0])
        confidence, observation, _ = best
        return SerialEvidence(stamp_present=True, exact_stamp=f"{numerator}/{denominator}", numerator=numerator,
            visible_denominator=denominator, side=observation.side, confidence=round(confidence, 4),
            source_text=observation.text, box=observation.box)

    if denominator_candidates:
        confidence, observation, denominator = max(denominator_candidates, key=lambda value: value[0])
        return SerialEvidence(stamp_present=False, exact_stamp=None, numerator=None, visible_denominator=denominator,
            side=observation.side, confidence=round(confidence, 4), source_text=observation.text, box=observation.box)
    return SerialEvidence(stamp_present=False)

def _all_text(observations: Iterable[OCRObservation]) -> str:
    return "\n".join(dict.fromkeys(value.text for value in observations if value.text))


def _year_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)
    # If a complete product/footer line prints a hobby season (2023-24,
    # 2025-26), that first year is the release year. Return it before the
    # copyright-year vote can swamp it with duplicate OCR passes. Historical
    # stat seasons do not qualify because they lack a product-line witness.
    product_tokens = (
        "o-pee-chee", "o pee chee", "sp authentic", "spx",
        "sp game used", "metal universe", "credentials", "synergy",
        "upper deck ice", "topps chrome", "bowman chrome",
        "donruss", "select", "prizm",
    )
    season_candidates: list[tuple[float, int]] = []
    for observation in values:
        raw = str(observation.text or "")
        match = re.search(r"\b(20\d{2})\s*[-–]\s*(\d{2})\b", raw)
        if not match:
            continue
        ox = observation.box.x + observation.box.width / 2
        oy = observation.box.y + observation.box.height / 2
        nearby = [raw]
        for candidate in values:
            if candidate is observation or candidate.side != observation.side:
                continue
            cx = candidate.box.x + candidate.box.width / 2
            cy = candidate.box.y + candidate.box.height / 2
            if abs(cy - oy) <= 0.085 and abs(cx - ox) <= 0.62:
                nearby.append(str(candidate.text or ""))
        season_context = " ".join(nearby).lower()
        # Hockey product footers often split the stylized brand logo into an
        # unreadable neighboring OCR box, while the plain word HOCKEY remains
        # clean. A season range + HOCKEY on the same footer row is itself strong
        # release evidence and cannot be a stats-table season row.
        if any(token in season_context for token in product_tokens) or "hockey" in season_context:
            season_candidates.append((float(observation.confidence), int(match.group(1))))
    if season_candidates:
        return str(max(season_candidates, key=lambda item: item[0])[1])
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
            # Multi-year sports releases use the FIRST year of the printed
            # season (e.g. 2023-24 O-Pee-Chee Platinum, 2025-26 SPx). When a
            # season range is printed on the actual product/footer line, it is
            # stronger release evidence than the following copyright year.
            season_match = re.search(r"\b(20\d{2})\s*[-–]\s*(\d{2})\b", context)
            product_footer = any(token in lowered for token in (
                "o-pee-chee", "o pee chee", "sp authentic", "spx",
                "sp game used", "metal universe", "credentials", "synergy",
                "upper deck ice", "topps chrome", "bowman chrome",
                "donruss", "select", "prizm",
            ))
            if season_match and int(season_match.group(1)) == year and product_footer:
                score += 8.0
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


def _brand_hint(text: str) -> str | None:
    lowered = text.lower()
    for needle, canonical in BRANDS.items():
        if re.search(rf"\b{re.escape(needle)}\b", lowered):
            return canonical
    return None


def _card_number_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = [
        value for value in observations
        if not (value.side == "back" and value.source in {"apple_vision:title_upper", "apple_vision:title_middle"})
    ]

    # Crop-local title OCR is a front-only text witness. Historical back title
    # crops have unremapped coordinates and must never influence card-number
    # layout; filter them defensively for archived/replayed evidence.

    # A dedicated top-left physical crop is scoped only to the printed
    # number corner. Its boxes are crop-local, so use the source contract rather
    # than pretending those coordinates are full-card coordinates.
    for observation in values:
        if observation.source != "apple_vision:number_corner_left":
            continue
        if observation.confidence < 0.45:
            continue
        match = re.fullmatch(
            r"[^A-Z0-9]*([A-Z]{0,4}\d+[A-Z0-9-]{0,8})[^A-Z0-9]*",
            str(observation.text or "").strip().upper(),
        )
        if not match:
            continue
        token = match.group(1)
        if token.isdigit() and 1900 <= int(token) <= 2035:
            continue
        return token

    # Score complete labeled hits instead of returning the first regex match.
    # Biographical copy can contain phrases such as "No. 1 overall pick"; that
    # is not the printed card number and must never outrank the short upper-back
    # card-number marking. Topps CMP# values are manufacturing/product codes,
    # never card numbers.
    labeled: list[tuple[float, str]] = []
    for observation in values:
        text = str(observation.text or "").strip()
        if re.search(r"\bCMP\s*#?\s*\d+", text, re.I):
            continue
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

    # Apple Vision can emit the printed card-number label and value as two
    # consecutive text observations with conservative 0.50 confidence even
    # though the reading itself is exact (for example "No." then "100").
    # Preserve that explicit print relationship before any geometric fallback.
    # Requiring adjacency, the same side/source, and a compact legal token keeps
    # statistics-table numbers from becoming card identity.
    for index, label in enumerate(values[:-1]):
        if not re.fullmatch(r"(?:no\.?|card(?:\s*(?:no\.?|number))?)", str(label.text or "").strip(), re.I):
            continue
        for candidate in values[index + 1:index + 3]:
            if candidate.side != label.side or candidate.source != label.source:
                continue
            token = str(candidate.text or "").strip().upper().lstrip("#").strip()
            if not re.fullmatch(r"[A-Z]{0,4}\d+[A-Z0-9-]{0,8}", token):
                continue
            if token.isdigit() and 1900 <= int(token) <= 2035:
                continue
            if float(candidate.confidence or 0.0) < 0.45:
                continue
            return token

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
            upper_back_label = label.side == "back" and ly >= 0.72
            max_dy = 0.34 if upper_back_label else 0.16
            if dx > 0.34 or dy > max_dy:
                continue
            # Real Prizm backs can place the printed number well below an upper
            # "No." label. Allow that bounded layout, but never reach down into
            # the statistics table or trust a weak OCR token as the card number.
            if upper_back_label and (cy < 0.50 or candidate.confidence < 0.60):
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
        # Native Apple Vision's fast witness path uses a conservative 0.50
        # confidence even for clean printed card numbers. This fallback is still
        # fail-closed because it accepts only ONE distinct legal token in the
        # upper back, away from the stats table.
        and value.confidence >= 0.45
        and (value.box.y + value.box.height / 2) >= 0.72
    }
    return next(iter(upper_back_tokens)) if len(upper_back_tokens) == 1 else None


def _player_hint(observations: Iterable[OCRObservation]) -> str | None:
    observations = list(observations)
    # A real player name commonly appears more than once across front/back crops.
    # Repetition is strong evidence and prevents a large team/logo crop from
    # stealing the player slot on foil-heavy cards.
    repeated: dict[str, tuple[float, str, int]] = {}
    for observation in observations:
        cleaned = "".join(ch if (ch.isalpha() or ch in " .'-") else " " for ch in observation.text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        if not 2 <= len(words) <= 5:
            continue
        lowered_words = {word.lower().strip(".'-") for word in words}
        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
        if lowered_words & PLAYER_STOPWORDS or normalized in SUBSET_PHRASES:
            continue
        score, label, count = repeated.get(normalized, (0.0, cleaned, 0))
        repeated[normalized] = (max(score, float(observation.confidence)), label, count + 1)
    repeated_names = [(score + min(0.5, count * 0.12), label) for score, label, count in repeated.values() if count >= 2]
    # Do not let repeated foil/logo garbage outrank an exact all-caps back name.
    # The back label is the strongest compact printed player witness and is
    # evaluated first below; repeated OCR remains the next fallback.

    # A single exact high-confidence back name is still hard printed evidence.
    # Prefer it when it is a compact all-caps label; biography sentences are
    # excluded by the compact-name and stopword guards below.
    exact_back_names = []
    for observation in observations:
        text = str(observation.text or "").strip()
        cleaned = "".join(ch if (ch.isalpha() or ch in " .'-") else " " for ch in text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
        if observation.side == "back" and observation.confidence >= 0.97 and 2 <= len(words) <= 4 and text == text.upper() and normalized not in SUBSET_PHRASES and not ({w.lower().strip(".\'-") for w in words} & PLAYER_STOPWORDS):
            # Names are alphabetic labels; reject stat/header tokens while keeping
            # ordinary two-to-four-word player names. A sufficiently wide exact
            # all-caps label is stronger than small table headings/logos.
            if all(re.fullmatch(r"[A-Za-z][A-Za-z.'-]*", w) for w in words) and observation.box.width >= 0.18:
                exact_back_names.append((observation.box.width * observation.box.height, cleaned))
    if exact_back_names:
        return max(exact_back_names, key=lambda value: value[0])[1]
    if repeated_names:
        return max(repeated_names, key=lambda value: value[0])[1]

    # If front artwork does not repeat the name, a high-confidence back label
    # is still authoritative printed evidence. Prefer a compact back name near
    # the upper/title area before falling back to front-only heuristics.
    back_candidates: list[tuple[float, str]] = []
    for observation in observations:
        if observation.side != "back" or observation.confidence < 0.90:
            continue
        cleaned = "".join(ch if (ch.isalpha() or ch in " .'-") else " " for ch in observation.text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        if not 2 <= len(words) <= 4:
            continue
        lowered_words = {word.lower().strip(".'-") for word in words}
        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
        if lowered_words & PLAYER_STOPWORDS or normalized in SUBSET_PHRASES:
            continue
        if any(len(word) < 2 for word in words):
            continue
        cy = observation.box.y + observation.box.height / 2
        position_bonus = 0.12 if cy >= 0.55 else 0.0
        score = observation.confidence + position_bonus + min(0.4, observation.box.height * 4) + min(0.2, observation.box.width)
        back_candidates.append((score, cleaned))
    if back_candidates:
        return max(back_candidates, key=lambda value: value[0])[1]

    candidates: list[tuple[float, str]] = []
    for observation in observations:
        if observation.side != "front":
            continue
        cleaned = "".join(ch if (ch.isalpha() or ch in " .'-") else " " for ch in observation.text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        if not 2 <= len(words) <= 5:
            continue
        lowered_words = {word.lower().strip(".'-") for word in words}
        if lowered_words & PLAYER_STOPWORDS:
            continue
        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
        if normalized in SUBSET_PHRASES:
            continue
        if any(len(word) < 2 for word in words):
            continue
        score = observation.confidence * (0.7 + min(0.3, observation.box.height * 5))
        candidates.append((score, cleaned))
    return max(candidates, default=(0.0, None), key=lambda value: value[0])[1]


def _subset_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)
    # Subset evidence normally must exist in a single printed OCR observation.
    # Never synthesize phrases by joining unrelated biography lines.
    for observation in values:
        text = re.sub(r"\s+", " ", str(observation.text or "").lower()).strip()
        for phrase, label in SUBSET_PHRASES.items():
            # Short clipped aliases are valid only as compact title observations,
            # not as substrings inside biography text such as "All-Star nods".
            if phrase in {"all-sta"} and len(text.split()) > 3:
                continue
            if phrase in text:
                return label
        # Foil/title OCR often clips one end of ALL-STARS. Accept only a compact
        # standalone title fragment, never narrative prose.
        compact = re.sub(r"[^a-z-]+", "", text)
        if compact in {"ald-sta", "all-sta", "i-sta", "-stars", "stars"}:
            return "All-Stars"

    # The Donruss Rated Rookie logo is often printed as two stacked words.
    # Fast Apple Vision can independently clip/corrupt them (for example ATEO
    # over OOHIE). Permit this one two-line reconstruction only when both lines
    # are compact, come from the same OCR variant, occupy the lower-left logo
    # region, and are spatially adjacent. This is physical logo evidence, not a
    # free-form join across card prose.
    front_logo = [
        value for value in values
        if value.side == "front"
        and value.box.x < 0.35
        and value.box.y < 0.22
        and len(re.sub(r"[^a-z]+", "", str(value.text or "").lower())) in range(3, 9)
    ]
    for first in front_logo:
        first_text = re.sub(r"[^a-z]+", "", str(first.text or "").lower())
        for second in front_logo:
            if second is first or str(first.source or "") != str(second.source or ""):
                continue
            if abs(first.box.x - second.box.x) > 0.08:
                continue
            if abs(first.box.y - second.box.y) > 0.10:
                continue
            second_text = re.sub(r"[^a-z]+", "", str(second.text or "").lower())
            for rated_text, rookie_text in ((first_text, second_text), (second_text, first_text)):
                if (
                    SequenceMatcher(None, rated_text, "rated").ratio() >= 0.60
                    and SequenceMatcher(None, rookie_text, "rookie").ratio() >= 0.60
                ):
                    return "Rated Rookies"
    return None


def _set_name_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = [value for value in observations if value.side == "front"]
    player = _player_hint(values)
    player_key = re.sub(r"[^a-z0-9]+", " ", str(player or "").lower()).strip()
    candidates: list[tuple[float, str]] = []
    for observation in values:
        if observation.confidence < 0.82:
            continue
        cleaned = re.sub(r"[^A-Za-z0-9 &'\-]+", " ", str(observation.text or ""))
        cleaned = " ".join(cleaned.split()).strip(" -")
        words = cleaned.split()
        if not 1 <= len(words) <= 4:
            continue
        normalized = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
        if not normalized or normalized == player_key:
            continue
        tokens = [token for token in normalized.split() if token]
        if not tokens or all(token in SET_TITLE_STOPWORDS for token in tokens):
            continue
        if any(needle == normalized for needle in MANUFACTURERS):
            continue
        if normalized.isdigit() or YEAR_RE.fullmatch(normalized):
            continue
        width = float(observation.box.width or 0)
        height = float(observation.box.height or 0)
        if width < 0.14 or height < 0.045:
            continue
        cy = observation.box.y + observation.box.height / 2
        score = float(observation.confidence) + min(0.8, height * 6.0) + min(0.45, width * 0.5)
        if cleaned.upper() == cleaned and any(char.isalpha() for char in cleaned):
            score += 0.15
        if 0.12 <= cy <= 0.75:
            score += 0.10
        candidates.append((score, cleaned))
    if not candidates:
        return None
    score, value = max(candidates, key=lambda item: item[0])
    return value if score >= 1.45 else None


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
    # Raw surface geometry is advisory evidence, not card identity. Generic foil,
    # borders, photography, and scanner reflections repeatedly resemble named
    # patterns (especially Cracked Ice). The Registry candidate family must be
    # established from hard printed evidence before a named parallel can lock.
    # Keep these scores in PatternEvidence for downstream checklist-constrained
    # discrimination, but never inject a named parallel into identity hints here.
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
        # Product/release and insert/subset are independent dimensions. Brand
        # logos such as PRIZM/SELECT/DONRUSS establish the release family while
        # FIREWORKS/ALL AMERICAN/PREMIER LEVEL establish the subset. Previously
        # we copied subset into set_name, which discarded visible product-line
        # evidence and left dozens of legal Registry parallels unresolved.
        brand=_brand_hint(text),
        player=_player_hint(observations),
        # Product-line/brand text is retrieval evidence, not a set-name lock.
        # The authoritative Registry resolves the release/set family later.
        set_name=None,
        subset=_subset_hint(observations),
        card_number=_card_number_hint(observations),
        parallel=_parallel_hint(front=front, back=back),
        serial_number=exact_serial,
        serial_run=serial.visible_denominator,
        autograph=True if re.search(r"\b(?:autograph|authentic signature|signatures?)\b", text, re.I) else None,
        memorabilia=True if re.search(r"\b(?:game-used|player-worn|memorabilia|relic|patch)\b", text, re.I) else None,
        rookie=True if re.search(r"\b(?:rookie|rc)\b", text, re.I) else None,
    )


def _bounded_stage_error(side: str, stage: str, error: Exception) -> str:
    return f"{side}:{stage}:{type(error).__name__.lower()}"


def _analyze_side(
    content: bytes,
    *,
    side: str,
    ocr: AppleVisionOCR | None,
    ocr_init_error: Exception | None = None,
    fast_ocr: bool = False,
    precomputed_ocr: list[OCRObservation] | None = None,
) -> tuple[SideVisionEvidence, bool]:
    """Analyze one side without allowing any witness stage to erase the rest.

    Apple Vision OCR and OpenCV are independent evidence sources. Decode, color,
    pattern, or OCR failures are recorded as bounded errors and never suppress a
    surviving stage. The outer package fail-safe remains only for truly
    unexpected orchestration failures outside these bounded stages.
    """
    errors: list[str] = []
    observations: list[OCRObservation] = []

    if precomputed_ocr is not None:
        observations = [
            observation.model_copy(deep=True)
            for observation in precomputed_ocr
        ]
    elif ocr is None:
        if ocr_init_error is not None:
            errors.append(_bounded_stage_error(side, "apple_vision_init_failed", ocr_init_error))
        else:
            errors.append(f"{side}:apple_vision_unavailable")
    else:
        try:
            if fast_ocr:
                observations, ocr_errors = ocr.recognize_identity_witness(
                    content, side=side
                )
            else:
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
    *,
    fast_ocr: bool = False,
    precomputed_ocr: dict[str, list[OCRObservation]] | None = None,
) -> LocalVisionEvidence:
    data_root = settings.resolve_local_path(settings.database_path).parent

    ocr: AppleVisionOCR | None = None
    ocr_init_error: Exception | None = None
    try:
        ocr = AppleVisionOCR(Path(settings.service_root), data_root)
    except Exception as error:
        ocr_init_error = error

    # Front and back are independent physical witnesses. Apple Vision previously
    # processed every OCR variant for the front and only then started the back,
    # making a two-sided card pay both OCR latencies serially. Run the two side
    # analyses concurrently while preserving front/back ordering in the result.
    if back:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="instacomp-local-vision") as pool:
            front_future = pool.submit(
                _analyze_side,
                front,
                side="front",
                ocr=ocr,
                ocr_init_error=ocr_init_error,
                fast_ocr=fast_ocr,
                precomputed_ocr=(
                    precomputed_ocr.get("front")
                    if precomputed_ocr is not None
                    else None
                ),
            )
            back_future = pool.submit(
                _analyze_side,
                back,
                side="back",
                ocr=ocr,
                ocr_init_error=ocr_init_error,
                fast_ocr=fast_ocr,
                precomputed_ocr=(
                    precomputed_ocr.get("back")
                    if precomputed_ocr is not None
                    else None
                ),
            )
            front_evidence, front_opencv_ok = front_future.result()
            back_evidence, back_opencv_ok = back_future.result()
    else:
        front_evidence, front_opencv_ok = _analyze_side(
            front,
            side="front",
            ocr=ocr,
            ocr_init_error=ocr_init_error,
            fast_ocr=fast_ocr,
            precomputed_ocr=(
                precomputed_ocr.get("front")
                if precomputed_ocr is not None
                else None
            ),
        )
        back_evidence = None
        back_opencv_ok = False

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

    front_centering = None
    back_centering = None

    # Seller-facing fast identification is IDENTITY ONLY.
    # Centering is condition/grading evidence and must never consume latency
    # before an exact card identity is returned.
    if not fast_ocr and precomputed_ocr is None:
        with ThreadPoolExecutor(
            max_workers=2 if back else 1,
            thread_name_prefix="instacomp-centering",
        ) as centering_pool:
            front_centering_future = centering_pool.submit(
                measure_card_centering, front
            )
            back_centering_future = (
                centering_pool.submit(measure_card_centering, back)
                if back else None
            )
            try:
                front_centering = CenteringEvidence.model_validate(
                    front_centering_future.result().as_dict()
                )
            except Exception as error:
                front_evidence = _append_side_error(
                    front_evidence,
                    _bounded_stage_error(
                        "front", "centering_measurement_failed", error
                    ),
                )

            if back_centering_future is not None:
                try:
                    back_centering = CenteringEvidence.model_validate(
                        back_centering_future.result().as_dict()
                    )
                except Exception as error:
                    if back_evidence is not None:
                        back_evidence = _append_side_error(
                            back_evidence,
                            _bounded_stage_error(
                                "back",
                                "centering_measurement_failed",
                                error,
                            ),
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
        engine_version=(
            f"{LOCAL_VISION_ENGINE_VERSION}.fast"
            if fast_ocr or precomputed_ocr is not None
            else LOCAL_VISION_ENGINE_VERSION
        ),
        front=front_evidence,
        back=back_evidence,
        front_centering=front_centering,
        back_centering=back_centering,
        serial=serial,
        identity_hints=identity_hints,
        combined_text=combined_text,
        apple_vision_available=apple_vision_available,
        opencv_available=front_opencv_ok or back_opencv_ok,
    )


async def analyze_local_vision(
    front: bytes,
    back: bytes | None,
    settings: Settings,
    *,
    fast_ocr: bool = False,
    precomputed_ocr: dict[str, list[OCRObservation]] | None = None,
) -> LocalVisionEvidence:
    return await asyncio.to_thread(
        analyze_local_vision_sync,
        front,
        back,
        settings,
        fast_ocr=fast_ocr,
        precomputed_ocr=precomputed_ocr,
    )


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
