#!/usr/bin/env python3
"""Extract private Beckett price-guide PDFs into KINGMAKER NDJSON staging bundles.

The output is intentionally validation-first. High-confidence rows may be marked
accepted; uncertain OCR stays in review and is never promoted automatically.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

try:
    import fitz  # PyMuPDF
    from PIL import Image, ImageEnhance, ImageOps
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "This extractor requires PyMuPDF and Pillow: python -m pip install pymupdf pillow"
    ) from exc

BUNDLE_SCHEMA = "tcos.kingmaker.beckettPriceGuideBundle.v1"
PARSER_VERSION = "1.1.0"
PRICE_RE = re.compile(r"^\$?\d{1,6}(?:,\d{3})*\.\d{2}$")
YEAR_HEADING_RE = re.compile(r"^((?:19|20)\d{2}(?:-\d{2})?)\s+(.+)$")
MULTIPLIER_RE = re.compile(
    r"^\*?(.+?)(?:/(\d+)(?:-\d+)?)?\s*:\s*([.\d]+)X\s+TO\s+([.\d]+)X",
    re.IGNORECASE,
)
SERIAL_RE = re.compile(r"/(\d{1,6})(?:\b|$)")

MANUFACTURERS = {
    "topps": "Topps",
    "panini": "Panini",
    "upper deck": "Upper Deck",
    "o-pee-chee": "O-Pee-Chee",
    "o pee chee": "O-Pee-Chee",
    "fleer": "Fleer",
    "bowman": "Bowman",
    "donruss": "Donruss",
    "leaf": "Leaf",
    "parkhurst": "Parkhurst",
    "pacific": "Pacific",
    "score": "Score",
    "skybox": "SkyBox",
    "star": "Star",
    "pro set": "Pro Set",
    "opc": "O-Pee-Chee",
}

BRAND_TO_MANUFACTURER = {
    "hoops": "Panini",
    "prizm": "Panini",
    "select": "Panini",
    "origins": "Panini",
    "impeccable": "Panini",
    "noir": "Panini",
    "obsidian": "Panini",
    "recon": "Panini",
    "crown royale": "Panini",
    "absolute memorabilia": "Panini",
    "national treasures": "Panini",
    "immaculate collection": "Panini",
    "the cup": "Upper Deck",
    "sp authentic": "Upper Deck",
    "spx": "Upper Deck",
    "artifacts": "Upper Deck",
    "allure": "Upper Deck",
    "black diamond": "Upper Deck",
    "credentials": "Upper Deck",
    "extended series": "Upper Deck",
    "young guns": "Upper Deck",
    "finest": "Topps",
    "chrome": "Topps",
    "heritage": "Topps",
    "stadium club": "Topps",
    "goudey": "Upper Deck",
}

PARALLEL_WORDS = {
    "red", "blue", "green", "gold", "silver", "purple", "orange", "pink",
    "black", "white", "teal", "bronze", "yellow", "aqua", "atomic", "ice",
    "shimmer", "pulsar", "seismic", "pandora", "power", "vinyl", "rainbow",
    "refractor", "refractors", "prizm", "prizms", "foil", "holo", "wave",
    "cracked ice", "superfractor", "x-fractor", "die-cut", "clear", "acetate",
}

AGGREGATE_KINDS = [
    (re.compile(r"^COMP(?:LETE)?\.?\s+SET\b", re.I), "complete_set"),
    (re.compile(r"^COMMON(?:\s+(?:CARD|CARDS|RC|ROOKIE|PANEL|NBA|ABA|TL))?\b", re.I), "common"),
    (re.compile(r"^(?:SEMISTARS?|SEMIS)\b", re.I), "semistar"),
    (re.compile(r"^UNLISTED(?:\s+STARS?|\s+RC|\s+ROOKIES?)\b", re.I), "unlisted_star"),
    (re.compile(r"^WRAPPER\b", re.I), "wrapper"),
    (re.compile(r"^(?:BAG\d*|SEALED\s+BAG|BOX|VENDING\s+BOX|PACK|CASE)\b", re.I), "other"),
]

NON_CARD_PREFIX_RE = re.compile(
    r"^(?:BAG\d*|BOX|PACK|CASE|WRAPPER|COMP(?:LETE)?|COMMON|SEMISTARS?|SEMIS|UNLISTED|"
    r"CONDITION|CARDS?\s+PRICED|CL|CHECKLIST)$",
    re.I,
)
NON_CARD_SUBJECT_RE = re.compile(
    r"\b(?:complete set|sealed bag|wax box|vending box|unopened|wrapper|common card|"
    r"semistars?|unlisted stars?|condition sensitive|price guide|cards priced)\b",
    re.I,
)
HEADING_BLOCK_RE = re.compile(
    r"^(?:COMP(?:LETE)?\.?\s+SET|COMMON|SEMISTARS?|SEMIS|UNLISTED|WRAPPER|BAG\d*|"
    r"BOX|PACK|CASE|CONDITION\s+SENSITIVE|CARDS?\s+PRICED)\b",
    re.I,
)

NOISE_PATTERNS = [
    re.compile(r"beckett\.com/price-guides", re.I),
    re.compile(r"can't find a price here", re.I),
    re.compile(r"price guide brought to you", re.I),
    re.compile(r"for updated daily pricing", re.I),
]


@dataclass(frozen=True)
class Word:
    text: str
    left: float
    top: float
    width: float
    height: float
    confidence: float
    block: int
    paragraph: int
    line: int


@dataclass
class ParsedState:
    release_year: str | None = None
    manufacturer: str | None = None
    brand: str | None = None
    product: str | None = None
    set_name: str | None = None
    parallel_name: str | None = None
    pending_heading: list[str] | None = None

    def __post_init__(self) -> None:
        if self.pending_heading is None:
            self.pending_heading = []


_OCR_PDF_PATH: str | None = None
_OCR_SCALE: float = 1.5
_OCR_COLUMNS: int = 5


def _ocr_initializer(pdf_path: str, scale: float, columns: int) -> None:
    global _OCR_PDF_PATH, _OCR_SCALE, _OCR_COLUMNS
    _OCR_PDF_PATH = pdf_path
    _OCR_SCALE = scale
    _OCR_COLUMNS = columns


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("–", "-").replace("—", "-")).strip()


def normalize_price_token(token: str) -> str:
    return token.replace("$", "").replace(",", "")


def parse_multiplier_value(token: str) -> float | None:
    token = clean(token).replace(",", ".")
    token = re.sub(r"\.{2,}", ".", token)
    if token.startswith("."):
        token = "0" + token
    try:
        value = float(token)
    except ValueError:
        return None
    return value if value >= 0 else None


def parse_price(token: str) -> float | None:
    token = clean(token)
    if not PRICE_RE.match(token):
        return None
    try:
        return round(float(normalize_price_token(token)), 2)
    except ValueError:
        return None


def infer_manufacturer(product: str) -> tuple[str | None, str | None]:
    normalized = clean(product).lower()
    for token, manufacturer in sorted(MANUFACTURERS.items(), key=lambda item: -len(item[0])):
        if normalized.startswith(token + " ") or normalized == token or f" {token} " in f" {normalized} ":
            remainder = re.sub(re.escape(token), "", product, count=1, flags=re.I).strip()
            brand = remainder.split()[0] if remainder else None
            return manufacturer, brand
    for token, manufacturer in sorted(BRAND_TO_MANUFACTURER.items(), key=lambda item: -len(item[0])):
        if normalized.startswith(token) or f" {token} " in f" {normalized} ":
            return manufacturer, clean(product).split()[0]
    return None, clean(product).split()[0] if product else None


def infer_parallel(heading: str | None) -> str | None:
    text = clean(heading)
    if not text:
        return None
    match = re.search(r"\b(?:Prizms?|Refractors?)\s+(.+)$", text, re.I)
    if match:
        return clean(match.group(1))
    lowered = text.lower()
    for word in sorted(PARALLEL_WORDS, key=len, reverse=True):
        if lowered == word or lowered.endswith(" " + word):
            return text.split()[-1] if " " not in word else word.title()
    return None


def image_to_tsv_words(png_bytes: bytes, psm: int = 6) -> list[Word]:
    env = dict(os.environ)
    env["OMP_THREAD_LIMIT"] = "1"
    process = subprocess.run(
        ["tesseract", "stdin", "stdout", "--psm", str(psm), "tsv"],
        input=png_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
        env=env,
        timeout=90,
    )
    rows: list[Word] = []
    text = process.stdout.decode("utf-8", errors="replace")
    # Tesseract TSV is tab-delimited but not RFC CSV. OCR text can contain
    # literal quote characters, so csv.DictReader may incorrectly join many
    # physical rows into one quoted field. Split each row explicitly.
    for raw_line in text.splitlines()[1:]:
        parts = raw_line.split("\t", 11)
        if len(parts) != 12 or parts[0] != "5":
            continue
        token = clean(parts[11])
        if not token:
            continue
        try:
            confidence = max(0.0, min(100.0, float(parts[10] or 0))) / 100.0
            rows.append(
                Word(
                    text=token,
                    left=float(parts[6]),
                    top=float(parts[7]),
                    width=float(parts[8]),
                    height=float(parts[9]),
                    confidence=confidence,
                    block=int(parts[2]),
                    paragraph=int(parts[3]),
                    line=int(parts[4]),
                )
            )
        except (ValueError, IndexError):
            continue
    return rows


def reconstruct_lines(words: list[Word], width: float, height: float, columns: int) -> list[dict[str, Any]]:
    usable = [
        word for word in words
        if word.top > height * 0.02
        and word.top + word.height < height * 0.965
        and word.left > width * 0.015
        and word.left + word.width < width * 0.985
    ]
    if not usable:
        return []

    # Beckett pages are fixed multi-column layouts. PDF block identifiers and
    # Tesseract blocks often span multiple visual columns, so column assignment
    # and line reconstruction must be geometric rather than block-based.
    heights = sorted(word.height for word in usable if word.height > 0)
    median_height = heights[len(heights) // 2] if heights else 8.0
    y_tolerance = max(1.8, median_height * 0.52)
    column_words: dict[int, list[Word]] = {column: [] for column in range(columns)}
    data_left = min(word.left for word in usable)
    data_right = max(word.left + word.width for word in usable)
    data_width = max(data_right - data_left, 1.0)
    for word in usable:
        center_x = word.left + word.width / 2
        column = min(
            columns - 1,
            max(0, int((center_x - data_left) / data_width * columns)),
        )
        column_words[column].append(word)

    lines: list[dict[str, Any]] = []
    for column in range(columns):
        ordered = sorted(
            column_words[column],
            key=lambda item: (item.top + item.height / 2, item.left),
        )
        geometric_lines: list[list[Word]] = []
        centers: list[float] = []
        for word in ordered:
            center_y = word.top + word.height / 2
            if geometric_lines and abs(center_y - centers[-1]) <= y_tolerance:
                geometric_lines[-1].append(word)
                centers[-1] = sum(
                    item.top + item.height / 2 for item in geometric_lines[-1]
                ) / len(geometric_lines[-1])
            else:
                geometric_lines.append([word])
                centers.append(center_y)

        for group in geometric_lines:
            group.sort(key=lambda item: item.left)
            text = clean(" ".join(item.text for item in group))
            if not text:
                continue
            left = min(item.left for item in group)
            right = max(item.left + item.width for item in group)
            top = min(item.top for item in group)
            bottom = max(item.top + item.height for item in group)
            confidence = sum(item.confidence for item in group) / len(group)
            lines.append({
                "text": text,
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "column": column,
                "confidence": confidence,
            })
    lines.sort(key=lambda item: (item["column"], item["top"], item["left"]))
    return lines


def ocr_page(page_number: int) -> dict[str, Any]:
    assert _OCR_PDF_PATH is not None
    document = fitz.open(_OCR_PDF_PATH)
    page = document[page_number - 1]
    pix = page.get_pixmap(matrix=fitz.Matrix(_OCR_SCALE, _OCR_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    image = ImageEnhance.Contrast(ImageOps.grayscale(image)).enhance(1.35)

    # Beckett price pages are fixed, narrow multi-column layouts. Running page
    # segmentation over the whole scan can take minutes or stall on dense pages.
    # OCR each visual column independently, then restore page coordinates.
    top = max(0, round(image.height * 0.035))
    bottom = min(image.height, round(image.height * 0.965))
    all_words: list[Word] = []
    lines: list[dict[str, Any]] = []
    digest = hashlib.sha256()
    overlap = max(2, round(image.width * 0.0015))
    for column in range(_OCR_COLUMNS):
        x0 = max(0, round(column * image.width / _OCR_COLUMNS) - overlap)
        x1 = min(image.width, round((column + 1) * image.width / _OCR_COLUMNS) + overlap)
        crop = image.crop((x0, top, x1, bottom))
        buffer = io.BytesIO()
        crop.save(buffer, format="PNG", optimize=False)
        png_bytes = buffer.getvalue()
        digest.update(column.to_bytes(2, "big"))
        digest.update(png_bytes)
        try:
            crop_words = image_to_tsv_words(png_bytes, psm=6)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            crop_words = image_to_tsv_words(png_bytes, psm=4)
        adjusted = [
            Word(
                text=word.text,
                left=word.left + x0,
                top=word.top + top,
                width=word.width,
                height=word.height,
                confidence=word.confidence,
                block=word.block + column * 10000,
                paragraph=word.paragraph,
                line=word.line,
            )
            for word in crop_words
        ]
        all_words.extend(adjusted)
        column_lines = reconstruct_lines(adjusted, image.width, image.height, 1)
        for line in column_lines:
            line["column"] = column
            lines.append(line)

    lines.sort(key=lambda item: (item["column"], item["top"], item["left"]))
    confidence = (
        sum(word.confidence for word in all_words) / len(all_words)
        if all_words else 0.0
    )
    return {
        "pageNumber": page_number,
        "imageSha256": digest.hexdigest(),
        "ocrEngine": f"tesseract-column-psm6-render-{_OCR_SCALE}x",
        "ocrConfidence": round(confidence, 5),
        "lines": lines,
        "columns": _OCR_COLUMNS,
    }


def text_page(document: fitz.Document, page_number: int, columns: int) -> dict[str, Any]:
    page = document[page_number - 1]
    raw_words = page.get_text("words")
    words: list[Word] = []
    for x0, y0, x1, y1, token, block, line, word_no in raw_words:
        token = clean(token)
        if not token:
            continue
        words.append(
            Word(token, x0, y0, x1 - x0, y1 - y0, 0.995, int(block), 0, int(line))
        )
    lines = reconstruct_lines(words, page.rect.width, page.rect.height, columns)
    text = "\n".join(item["text"] for item in lines)
    return {
        "pageNumber": page_number,
        "imageSha256": None,
        "ocrEngine": "pymupdf-text-layer",
        "ocrConfidence": 0.995 if text else 0.0,
        "lines": lines,
        "columns": columns,
    }


def has_usable_text(document: fitz.Document, start_page: int, end_page: int) -> bool:
    sample_pages = sorted({start_page, min(end_page, start_page + 10), end_page})
    counts = [len(document[number - 1].get_text("text").strip()) for number in sample_pages]
    return sum(count >= 500 for count in counts) >= 2


def is_noise(text: str) -> bool:
    return any(pattern.search(text) for pattern in NOISE_PATTERNS)


def contains_price_token(text: str) -> bool:
    return any(parse_price(token) is not None for token in text.split())


def extract_price_pairs(tokens: list[str]) -> list[tuple[int, int, float, float]]:
    pairs: list[tuple[int, int, float, float]] = []
    index = 0
    while index + 1 < len(tokens):
        low = parse_price(tokens[index])
        high = parse_price(tokens[index + 1])
        if low is not None and high is not None:
            pairs.append((index, index + 1, low, high))
            index += 2
        else:
            index += 1
    return pairs


def split_card_rows(text: str) -> list[tuple[str, str, float, float]]:
    tokens = text.split()
    pairs = extract_price_pairs(tokens)
    if not pairs:
        return []
    rows: list[tuple[str, str, float, float]] = []
    segment_start = 0
    for low_index, high_index, low, high in pairs:
        segment = tokens[segment_start:low_index]
        segment_start = high_index + 1
        if len(segment) < 2 or low > high:
            continue
        while segment and segment[0] in {"|", "}", ")", "-", ":"}:
            segment.pop(0)
        if len(segment) < 2:
            continue
        card_number = clean(segment[0]).lstrip("#")
        subject = clean(" ".join(segment[1:]))
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]{0,19}", card_number):
            continue
        if parse_price(card_number) is not None:
            continue
        if not any(character.isdigit() for character in card_number):
            if card_number.lower() != "xx" and card_number != card_number.upper():
                continue
        if NON_CARD_PREFIX_RE.match(card_number):
            continue
        if not re.search(r"[A-Za-z]", subject) or NON_CARD_SUBJECT_RE.search(subject):
            continue
        if len(subject) > 140 or len(subject.split()) > 18:
            continue
        rows.append((card_number, subject, low, high))
    return rows


def parse_aggregate(text: str) -> tuple[str, float, float] | None:
    for pattern, kind in AGGREGATE_KINDS:
        if not pattern.search(text):
            continue
        tokens = text.split()
        pairs = extract_price_pairs(tokens)
        if not pairs:
            return None
        _, _, low, high = pairs[0]
        if low > high:
            return None
        return kind, low, high
    return None


def flags_from_subject(subject: str) -> dict[str, Any]:
    tokens = set(re.findall(r"\b[A-Z]{2,5}\b", subject.upper()))
    serial = SERIAL_RE.search(subject)
    variation = None
    if "VAR" in tokens:
        variation = "Variation"
    elif "UER" in tokens:
        variation = "Uncorrected Error"
    elif "ERR" in tokens:
        variation = "Error"
    return {
        "rookieDesignation": bool(tokens & {"RC", "XRC"}),
        "autographDesignation": bool(tokens & {"AU", "AUTO"}),
        "memorabiliaDesignation": bool(tokens & {"JSY", "MEM", "PATCH", "RELIC"}),
        "shortPrintDesignation": bool(tokens & {"SP", "SSP"}),
        "errorDesignation": bool(tokens & {"ERR", "UER", "COR"}),
        "variation": variation,
        "serialRun": int(serial.group(1)) if serial else None,
    }


def source_row_key(source_sha: str, page: int, row_order: int, raw_text: str) -> str:
    payload = {
        "sourceSha256": source_sha,
        "pageNumber": page,
        "rowOrder": row_order,
        "rawText": clean(raw_text),
    }
    return hashlib.sha256(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def commit_pending_heading(state: ParsedState) -> None:
    assert state.pending_heading is not None
    if not state.pending_heading:
        return
    heading = clean(" ".join(state.pending_heading))
    state.pending_heading.clear()
    if (
        not heading
        or HEADING_BLOCK_RE.search(heading)
        or contains_price_token(heading)
    ):
        return

    parallel_match = re.match(
        r"^(.*?)(?:\s+)?(?:Prizms?|Refractors?)\s+(.+)$",
        heading,
        re.I,
    )
    if parallel_match:
        base_set = clean(parallel_match.group(1))
        parallel = clean(parallel_match.group(2))
        if base_set:
            state.set_name = base_set
        elif not state.set_name:
            state.set_name = "Base"
        state.parallel_name = parallel
        return

    parallel = infer_parallel(heading)
    if parallel and clean(heading).lower() in {word.lower() for word in PARALLEL_WORDS}:
        state.parallel_name = parallel
        return

    state.set_name = heading
    state.parallel_name = None


def looks_like_heading(text: str) -> bool:
    if len(text) > 90 or is_noise(text) or HEADING_BLOCK_RE.search(text):
        return False
    if contains_price_token(text) or MULTIPLIER_RE.search(text):
        return False
    if re.match(r"^[A-Za-z][A-Za-z0-9 '&/().-]{2,}$", text):
        return True
    return False


def parse_page_lines(
    page: dict[str, Any],
    state: ParsedState,
    source_sha: str,
    sport: str,
    source_engine: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    row_order = 0
    page_lines: list[str] = []
    previous_column: int | None = None
    for line in page["lines"]:
        current_column = int(line.get("column", 0))
        if previous_column is not None and current_column != previous_column:
            commit_pending_heading(state)
        previous_column = current_column
        text = clean(line["text"])
        if not text or is_noise(text):
            continue
        page_lines.append(text)
        heading_match = YEAR_HEADING_RE.match(text)
        if heading_match and not extract_price_pairs(text.split()):
            commit_pending_heading(state)
            state.release_year = heading_match.group(1)
            state.product = clean(heading_match.group(2))
            state.manufacturer, state.brand = infer_manufacturer(state.product)
            state.set_name = "Base"
            state.parallel_name = None
            continue

        multiplier = MULTIPLIER_RE.search(text)
        if multiplier:
            commit_pending_heading(state)
            row_order += 1
            parallel_name = re.sub(
                r"^(?:\$?\d[\d,]*\.\d{2}\s+)+",
                "",
                clean(multiplier.group(1)),
            ).lstrip("*").strip()
            serial_run = int(multiplier.group(2)) if multiplier.group(2) else None
            multiplier_low = parse_multiplier_value(multiplier.group(3))
            multiplier_high = parse_multiplier_value(multiplier.group(4))
            if multiplier_low is None or multiplier_high is None or not parallel_name:
                continue
            state.parallel_name = parallel_name
            confidence = min(float(line["confidence"]), 0.98)
            validation = "review"
            entries.append({
                "pageNumber": page["pageNumber"],
                "rowOrder": row_order,
                "sourceRowKey": source_row_key(source_sha, page["pageNumber"], row_order, text),
                "entryKind": "multiplier",
                "releaseYear": state.release_year,
                "season": state.release_year,
                "manufacturer": state.manufacturer,
                "brand": state.brand,
                "product": state.product,
                "setName": state.set_name,
                "parallelName": parallel_name,
                "cardNumber": None,
                "playerName": None,
                "teamName": None,
                "rookieDesignation": None,
                "autographDesignation": None,
                "memorabiliaDesignation": None,
                "shortPrintDesignation": None,
                "errorDesignation": None,
                "variation": None,
                "serialRun": serial_run,
                "conditionBasis": "Beckett BASIC multiplier",
                "valueLow": None,
                "valueHigh": None,
                "currency": "USD",
                "multiplierLow": multiplier_low,
                "multiplierHigh": multiplier_high,
                "rawText": text,
                "parseConfidence": round(confidence, 5),
                "validationStatus": validation,
                "validationReasons": ["requires_operator_review", f"source_engine:{source_engine}"],
                "entityKey": None,
                "metadata": {"sport": sport, "column": line["column"]},
            })
            continue

        aggregate = parse_aggregate(text)
        if aggregate:
            commit_pending_heading(state)
            kind, low, high = aggregate
            row_order += 1
            confidence = min(float(line["confidence"]), 0.995)
            validation = "review"
            entries.append({
                "pageNumber": page["pageNumber"],
                "rowOrder": row_order,
                "sourceRowKey": source_row_key(source_sha, page["pageNumber"], row_order, text),
                "entryKind": kind,
                "releaseYear": state.release_year,
                "season": state.release_year,
                "manufacturer": state.manufacturer,
                "brand": state.brand,
                "product": state.product,
                "setName": state.set_name,
                "parallelName": state.parallel_name,
                "cardNumber": None,
                "playerName": clean(re.sub(r"\s+\$?\d[\d,]*\.\d{2}\s+\$?\d[\d,]*\.\d{2}.*$", "", text)),
                "teamName": None,
                "rookieDesignation": None,
                "autographDesignation": None,
                "memorabiliaDesignation": None,
                "shortPrintDesignation": None,
                "errorDesignation": None,
                "variation": None,
                "serialRun": None,
                "conditionBasis": "Beckett guide basis",
                "valueLow": low,
                "valueHigh": high,
                "currency": "USD",
                "multiplierLow": None,
                "multiplierHigh": None,
                "rawText": text,
                "parseConfidence": round(confidence, 5),
                "validationStatus": validation,
                "validationReasons": ["aggregate_reference_requires_operator_review", f"source_engine:{source_engine}"],
                "entityKey": None,
                "metadata": {"sport": sport, "column": line["column"]},
            })
            continue

        card_rows = split_card_rows(text)
        if card_rows:
            commit_pending_heading(state)
            for card_number, subject, low, high in card_rows:
                row_order += 1
                confidence = min(float(line["confidence"]), 0.995)
                flags = flags_from_subject(subject)
                suspicious = bool(re.search(r"[^A-Za-z0-9 .,'’&()/#-]", subject))
                complete_context = bool(state.release_year and state.product and state.set_name)
                validation = "review"
                reasons: list[str] = ["requires_exact_registry_identity_match", f"source_engine:{source_engine}"]
                if confidence < 0.92:
                    reasons.append("low_ocr_confidence")
                if not complete_context:
                    reasons.append("incomplete_set_context")
                if not state.manufacturer:
                    reasons.append("manufacturer_unresolved")
                if suspicious:
                    reasons.append("suspicious_ocr_characters")
                entries.append({
                    "pageNumber": page["pageNumber"],
                    "rowOrder": row_order,
                    "sourceRowKey": source_row_key(source_sha, page["pageNumber"], row_order, f"{card_number} {subject} {low:.2f} {high:.2f}"),
                    "entryKind": "card",
                    "releaseYear": state.release_year,
                    "season": state.release_year,
                    "manufacturer": state.manufacturer,
                    "brand": state.brand,
                    "product": state.product,
                    "setName": state.set_name,
                    "parallelName": state.parallel_name,
                    "cardNumber": card_number,
                    "playerName": subject,
                    "teamName": None,
                    **flags,
                    "conditionBasis": "Beckett guide basis",
                    "valueLow": low,
                    "valueHigh": high,
                    "currency": "USD",
                    "multiplierLow": None,
                    "multiplierHigh": None,
                    "rawText": f"{card_number} {subject} {low:.2f} {high:.2f}",
                    "parseConfidence": round(confidence, 5),
                    "validationStatus": validation,
                    "validationReasons": reasons,
                    "entityKey": None,
                    "metadata": {"sport": sport, "column": line["column"], "sourceLine": text},
                })
            continue

        if looks_like_heading(text):
            assert state.pending_heading is not None
            if len(state.pending_heading) < 3:
                state.pending_heading.append(text)
            else:
                commit_pending_heading(state)
                state.pending_heading.append(text)

    ocr_text = "\n".join(page_lines)
    status = "parsed" if source_engine == "text" else "validation_required"
    page_record = {
        "pageNumber": page["pageNumber"],
        "printedPageNumber": None,
        "sectionName": state.product,
        "imageSha256": page["imageSha256"],
        "ocrEngine": page["ocrEngine"],
        "ocrConfidence": page["ocrConfidence"],
        "ocrText": ocr_text,
        "layout": {"columns": int(page.get("columns", 0)), "lineCount": len(page["lines"])},
        "status": status,
        "metadata": {"parsedEntryCount": len(entries), "sourceEngine": source_engine},
    }
    return entries, page_record


def write_ndjson(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def create_zip(output_dir: Path) -> Path:
    zip_path = output_dir.with_suffix(".zip")
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in ("manifest.json", "pages.ndjson", "entries.ndjson"):
            archive.write(output_dir / name, arcname=name)
    return zip_path


def run(args: argparse.Namespace) -> dict[str, Any]:
    pdf_path = Path(args.pdf).resolve()
    if not pdf_path.is_file():
        raise SystemExit(f"PDF not found: {pdf_path}")
    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    source_sha = sha256_file(pdf_path)
    document = fitz.open(pdf_path)
    page_count = len(document)
    if not (1 <= args.start_page <= args.end_page <= page_count):
        raise SystemExit("Invalid price-guide page range.")

    use_text = args.mode == "text" or (args.mode == "auto" and has_usable_text(document, args.start_page, args.end_page))
    if not use_text and shutil.which("tesseract") is None:
        raise SystemExit("tesseract is required for image-only PDFs.")
    page_numbers = list(range(args.start_page, args.end_page + 1))
    extracted_pages: dict[int, dict[str, Any]] = {}

    if use_text:
        for number in page_numbers:
            extracted_pages[number] = text_page(document, number, args.columns)
    else:
        with ProcessPoolExecutor(
            max_workers=args.workers,
            initializer=_ocr_initializer,
            initargs=(str(pdf_path), args.scale, args.columns),
        ) as executor:
            futures = {executor.submit(ocr_page, number): number for number in page_numbers}
            completed = 0
            for future in as_completed(futures):
                number = futures[future]
                extracted_pages[number] = future.result()
                completed += 1
                if completed % 10 == 0 or completed == len(page_numbers):
                    print(f"[{pdf_path.name}] extracted {completed}/{len(page_numbers)} pages", file=sys.stderr)

    state = ParsedState()
    all_pages: list[dict[str, Any]] = []
    all_entries: list[dict[str, Any]] = []
    for number in page_numbers:
        entries, page_record = parse_page_lines(
            extracted_pages[number],
            state,
            source_sha,
            args.sport,
            "text" if use_text else "ocr",
        )
        all_pages.append(page_record)
        all_entries.extend(entries)

    status_counts = {"accepted": 0, "review": 0, "rejected": 0}
    for entry in all_entries:
        status_counts[entry["validationStatus"]] += 1

    write_ndjson(output_dir / "pages.ndjson", all_pages)
    write_ndjson(output_dir / "entries.ndjson", all_entries)
    manifest = {
        "schema": BUNDLE_SCHEMA,
        "parserVersion": PARSER_VERSION,
        "guide": {
            "title": args.title,
            "sport": args.sport,
            "issueCode": args.issue_code,
            "editionDate": args.edition_date,
            "originalFilename": pdf_path.name,
            "sourceSha256": source_sha,
            "pageCount": page_count,
            "priceGuideStartPage": args.start_page,
            "priceGuideEndPage": args.end_page,
            "redistributionAllowed": False,
        },
        "files": {
            "pages": "pages.ndjson",
            "entries": "entries.ndjson",
            "originalPdf": str(pdf_path),
        },
        "counts": {
            "pages": len(all_pages),
            "entries": len(all_entries),
            **status_counts,
        },
        "extraction": {
            "engine": "pymupdf-text-layer" if use_text else f"tesseract-column-psm6-{args.scale}x",
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "command": " ".join(sys.argv),
        },
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    zip_path = create_zip(output_dir)
    return {"manifest": manifest, "zip": str(zip_path)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--sport", required=True)
    parser.add_argument("--issue-code")
    parser.add_argument("--edition-date", required=True)
    parser.add_argument("--start-page", type=int, required=True)
    parser.add_argument("--end-page", type=int, required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--mode", choices=("auto", "text", "ocr"), default="auto")
    parser.add_argument("--scale", type=float, default=1.5)
    parser.add_argument("--columns", type=int, default=5)
    parser.add_argument("--workers", type=int, default=max(1, min(8, os.cpu_count() or 2)))
    return parser


if __name__ == "__main__":
    result = run(build_parser().parse_args())
    print(json.dumps(result, indent=2))
