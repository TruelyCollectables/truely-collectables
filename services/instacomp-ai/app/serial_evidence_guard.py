from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable

from .models import OCRObservation, SerialEvidence


# A physical copy stamp is a hard Registry fact. Accept a single OCR observation
# only when the whole OCR line is itself a clean stamp (optionally with an
# explicit serial cue). A fraction embedded in unrelated/noisy OCR remains
# non-authoritative unless an independent OCR channel corroborates the same
# numerator/denominator pair.
SERIAL_STAMP_LINE_RE = re.compile(
    r"^\s*(?:(?:SERIAL(?:\s+(?:NUMBER|NO))?|SER\.?|SN|S/N|NUMBERED|COPY)\s*[:=\-]?\s*)?"
    r"(\d{1,5})\s*(?:/|OF)\s*(\d{1,6})"
    r"(?:\s*(?:SERIAL|NUMBERED|COPY))?\s*$",
    re.I,
)
SERIAL_EXACT_RE = re.compile(r"(?<!\d)(\d{1,5})\s*/\s*(\d{1,6})(?!\d)")
SERIAL_OF_RE = re.compile(r"(?<!\d)(\d{1,5})\s+(?:OF|of)\s+(\d{1,6})(?!\d)")
SERIAL_DENOMINATOR_RE = re.compile(r"(?:^|\s)/\s*(\d{1,6})(?!\d)")


def _channel(observation: OCRObservation) -> tuple[str, str]:
    return (str(observation.side or "unknown"), str(observation.source or "unknown"))


def _serial_evidence(
    observation: OCRObservation,
    numerator: int,
    denominator: int,
) -> SerialEvidence:
    return SerialEvidence(
        stamp_present=True,
        exact_stamp=f"{numerator}/{denominator}",
        numerator=numerator,
        visible_denominator=denominator,
        side=observation.side,
        confidence=round(float(observation.confidence), 4),
        source_text=observation.text,
        box=observation.box,
    )


def parse_serial_evidence_hardened(
    observations: Iterable[OCRObservation],
) -> SerialEvidence:
    values = list(observations)
    clean_candidates: list[tuple[float, OCRObservation, int, int]] = []
    noisy_by_stamp: dict[
        tuple[int, int], dict[tuple[str, str], OCRObservation]
    ] = defaultdict(dict)
    denominator_candidates: list[tuple[float, OCRObservation, int]] = []

    for observation in values:
        text = str(observation.text or "").strip()
        if not text:
            continue

        clean_match = SERIAL_STAMP_LINE_RE.fullmatch(text)
        if clean_match:
            numerator = int(clean_match.group(1))
            denominator = int(clean_match.group(2))
            if denominator >= 1:
                clean_candidates.append(
                    (float(observation.confidence), observation, numerator, denominator)
                )
            continue

        # Embedded fraction-shaped text is not a hard serial fact by itself.
        # Retain it only as a possible corroboration candidate keyed by an
        # independent (side, OCR source) channel.
        seen_pairs: set[tuple[int, int]] = set()
        for pattern in (SERIAL_EXACT_RE, SERIAL_OF_RE):
            for match in pattern.finditer(text):
                numerator = int(match.group(1))
                denominator = int(match.group(2))
                if denominator < 1:
                    continue
                pair = (numerator, denominator)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                channel = _channel(observation)
                previous = noisy_by_stamp[pair].get(channel)
                if previous is None or observation.confidence > previous.confidence:
                    noisy_by_stamp[pair][channel] = observation
                denominator_candidates.append(
                    (float(observation.confidence), observation, denominator)
                )

        for match in SERIAL_DENOMINATOR_RE.finditer(text):
            denominator = int(match.group(1))
            if denominator >= 1:
                denominator_candidates.append(
                    (float(observation.confidence), observation, denominator)
                )

    if clean_candidates:
        _, observation, numerator, denominator = max(
            clean_candidates,
            key=lambda value: (
                value[0],
                1 if value[1].side == "back" else 0,
            ),
        )
        return _serial_evidence(observation, numerator, denominator)

    corroborated: list[tuple[float, OCRObservation, int, int]] = []
    for (numerator, denominator), channels in noisy_by_stamp.items():
        # Repeated OCR boxes from the same engine on the same card side are not
        # independent corroboration. A different side or OCR source is.
        if len(channels) < 2:
            continue
        best = max(channels.values(), key=lambda value: float(value.confidence))
        confidence = max(float(value.confidence) for value in channels.values())
        corroborated.append((confidence, best, numerator, denominator))

    if corroborated:
        _, observation, numerator, denominator = max(
            corroborated,
            key=lambda value: (
                value[0],
                1 if value[1].side == "back" else 0,
            ),
        )
        return _serial_evidence(observation, numerator, denominator)

    if denominator_candidates:
        confidence, observation, denominator = max(
            denominator_candidates,
            key=lambda value: (
                value[0],
                1 if value[1].side == "back" else 0,
            ),
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


def install_serial_evidence_guard() -> None:
    # Import lazily so app.local_vision can finish loading before its parser is
    # replaced. analyze_local_vision resolves this module global at call time.
    from . import local_vision

    local_vision.parse_serial_evidence = parse_serial_evidence_hardened
