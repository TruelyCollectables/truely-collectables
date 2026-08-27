from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .models import CardIdentity

MAX_PRINTED_EVIDENCE_CHARS = 12_000
MANUFACTURERS = [
    "Panini",
    "Upper Deck",
    "Topps",
    "Bowman",
    "Leaf",
    "Donruss",
    "Fleer",
    "Score",
    "SkyBox",
    "Pacific",
]


@dataclass(frozen=True)
class PrintedEvidence:
    provider: str | None
    text: str
    serial_number: str | None
    checked_images: int
    conflicts: tuple[str, ...]


def _text(value: object, limit: int) -> str | None:
    normalized = " ".join(str(value or "").replace("\x00", " ").split())
    return normalized[:limit] or None


def parse_printed_evidence(raw_json: str | None) -> PrintedEvidence | None:
    if not raw_json:
        return None
    if len(raw_json) > MAX_PRINTED_EVIDENCE_CHARS * 2:
        return None
    try:
        payload = json.loads(raw_json)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None

    text = _text(payload.get("text"), MAX_PRINTED_EVIDENCE_CHARS) or ""
    serial_number = _text(
        payload.get("serialNumber") or payload.get("serial_number"),
        80,
    )
    checked_images = payload.get("checkedImages") or payload.get("checked_images") or 0
    try:
        checked_images = max(0, min(int(checked_images), 64))
    except (TypeError, ValueError):
        checked_images = 0
    conflicts_value = payload.get("conflicts")
    conflicts = tuple(
        item
        for item in (
            _text(value, 160)
            for value in (conflicts_value if isinstance(conflicts_value, list) else [])
        )
        if item
    )[:20]
    return PrintedEvidence(
        provider=_text(payload.get("provider"), 120),
        text=text,
        serial_number=serial_number,
        checked_images=checked_images,
        conflicts=conflicts,
    )


def extract_card_number(text: str) -> str | None:
    normalized = " ".join(text.replace("｜", "/").split())
    patterns = [
        r"\b(?:card\s*(?:no\.?|number)?|no\.?|number)\s*[:#.-]?\s*([a-z]{0,5}-?\d{1,5}[a-z]{0,3})\b",
        r"#\s*([a-z]{0,5}-?\d{1,5}[a-z]{0,3})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.I)
        if match:
            candidate = match.group(1).strip().upper()
            if not re.fullmatch(r"(?:18|19|20)\d{2}", candidate):
                return candidate
    return None


def _extract_year(text: str) -> str | None:
    years = re.findall(r"\b((?:19|20)\d{2})\b", text)
    if not years:
        return None
    # Copyright text is commonly near the end of the back OCR. Prefer the most
    # recent plausible printed year; the Registry still verifies it exactly.
    plausible = [int(year) for year in years if 1980 <= int(year) <= 2100]
    return str(max(plausible)) if plausible else None


def _extract_manufacturer(text: str) -> str | None:
    normalized = text.casefold()
    matches = [name for name in MANUFACTURERS if name.casefold() in normalized]
    return matches[0] if len(matches) == 1 else None


def _serial_run(serial_number: str | None) -> int | None:
    normalized = str(serial_number or "").replace(" ", "")
    if normalized.lower() in {"1/1", "1of1"}:
        return 1
    match = re.search(r"/(\d{1,6})$", normalized)
    return int(match.group(1)) if match else None


def identity_from_printed_evidence(
    evidence: PrintedEvidence | None,
) -> CardIdentity:
    if evidence is None:
        return CardIdentity()
    return CardIdentity(
        year=_extract_year(evidence.text),
        manufacturer=_extract_manufacturer(evidence.text),
        brand=_extract_manufacturer(evidence.text),
        card_number=extract_card_number(evidence.text),
        serial_number=evidence.serial_number,
        serial_run=_serial_run(evidence.serial_number),
    )
