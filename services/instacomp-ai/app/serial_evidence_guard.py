from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable

from .models import OCRObservation, SerialEvidence


# Serial evidence is allowed to constrain the Registry only when the physical
# copy stamp itself is trustworthy. A clean isolated stamp is strong enough on
# either side of the card. A fraction embedded in unrelated/noisy OCR is only a
# candidate and must be independently corroborated by another side or OCR source.
# This keeps real 17/299-style stamps readable without letting stats/noise such as
# the A'ja Wilson front OCR fragment "2/6 0б 6" become a fake serial constraint.
SERIAL_CUE = r"(?:SERIAL(?:\s+(?:NUMBER|NO))?|SER\.?|SN|S/N|NUMBERED|COPY)"
SERIAL_STAMP_LINE_RE = re.compile(
    rf"^\s*(?:{SERIAL_CUE}\s*[:=\-]?\s*)?"
    r"(\d{1,5})\s*(?:/|OF)\s*(\d{1,6})"
    rf"(?:\s*{SERIAL_CUE})?\s*$",
    re.I,
)
SERIAL_DENOMINATOR_STAMP_LINE_RE = re.compile(
    rf"^\s*(?:{SERIAL_CUE}\s*[:=\-]?\s*)?"
    r"/\s*(\d{1,6})"
    rf"(?:\s*{SERIAL_CUE})?\s*$",
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


def _denominator_evidence(
    observation: OCRObservation,
    denominator: int,
) -> SerialEvidence:
    return SerialEvidence(
        stamp_present=False,
        exact_stamp=None,
        numerator=None,
        visible_denominator=denominator,
        side=observation.side,
        confidence=round(float(observation.confidence), 4),
        source_text=observation.text,
        box=observation.box,
    )


def _best_observation(values: Iterable[OCRObservation]) -> OCRObservation:
    return max(
        values,
        key=lambda value: (
            float(value.confidence),
            1 if value.side == "back" else 0,
        ),
    )


def _unique_clean_exact(
    candidates: dict[tuple[int, int], list[OCRObservation]],
) -> tuple[OCRObservation, int, int] | None:
    if len(candidates) != 1:
        return None
    (numerator, denominator), observations = next(iter(candidates.items()))
    return _best_observation(observations), numerator, denominator


def _unique_corroborated_exact(
    candidates: dict[tuple[int, int], dict[tuple[str, str], OCRObservation]],
) -> tuple[OCRObservation, int, int] | None:
    corroborated = [
        (pair, channels)
        for pair, channels in candidates.items()
        if len(channels) >= 2
    ]
    if len(corroborated) != 1:
        return None
    (numerator, denominator), channels = corroborated[0]
    return _best_observation(channels.values()), numerator, denominator


def _unique_clean_denominator(
    candidates: dict[int, list[OCRObservation]],
) -> tuple[OCRObservation, int] | None:
    if len(candidates) != 1:
        return None
    denominator, observations = next(iter(candidates.items()))
    return _best_observation(observations), denominator


def _unique_corroborated_denominator(
    candidates: dict[int, dict[tuple[str, str], OCRObservation]],
) -> tuple[OCRObservation, int] | None:
    corroborated = [
        (denominator, channels)
        for denominator, channels in candidates.items()
        if len(channels) >= 2
    ]
    if len(corroborated) != 1:
        return None
    denominator, channels = corroborated[0]
    return _best_observation(channels.values()), denominator


def parse_serial_evidence_hardened(
    observations: Iterable[OCRObservation],
) -> SerialEvidence:
    values = list(observations)
    clean_exact: dict[tuple[int, int], list[OCRObservation]] = defaultdict(list)
    noisy_exact: dict[
        tuple[int, int], dict[tuple[str, str], OCRObservation]
    ] = defaultdict(dict)
    clean_denominator: dict[int, list[OCRObservation]] = defaultdict(list)
    noisy_denominator: dict[
        int, dict[tuple[str, str], OCRObservation]
    ] = defaultdict(dict)

    for observation in values:
        text = str(observation.text or "").strip()
        if not text:
            continue
        channel = _channel(observation)

        clean_match = SERIAL_STAMP_LINE_RE.fullmatch(text)
        if clean_match:
            numerator = int(clean_match.group(1))
            denominator = int(clean_match.group(2))
            if denominator >= 1:
                clean_exact[(numerator, denominator)].append(observation)
                previous = noisy_denominator[denominator].get(channel)
                if previous is None or observation.confidence > previous.confidence:
                    noisy_denominator[denominator][channel] = observation
            continue

        clean_denominator_match = SERIAL_DENOMINATOR_STAMP_LINE_RE.fullmatch(text)
        if clean_denominator_match:
            denominator = int(clean_denominator_match.group(1))
            if denominator >= 1:
                clean_denominator[denominator].append(observation)
            continue

        exact_spans: list[tuple[int, int]] = []
        seen_pairs: set[tuple[int, int]] = set()
        for pattern in (SERIAL_EXACT_RE, SERIAL_OF_RE):
            for match in pattern.finditer(text):
                exact_spans.append(match.span())
                numerator = int(match.group(1))
                denominator = int(match.group(2))
                if denominator < 1:
                    continue
                pair = (numerator, denominator)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                previous = noisy_exact[pair].get(channel)
                if previous is None or observation.confidence > previous.confidence:
                    noisy_exact[pair][channel] = observation
                previous_denominator = noisy_denominator[denominator].get(channel)
                if (
                    previous_denominator is None
                    or observation.confidence > previous_denominator.confidence
                ):
                    noisy_denominator[denominator][channel] = observation

        # A denominator embedded inside the exact fraction above is the same OCR
        # claim, not a second witness. Only independent denominator-shaped text is
        # tracked here, and it still requires cross-channel corroboration.
        for match in SERIAL_DENOMINATOR_RE.finditer(text):
            if any(start <= match.start() < end for start, end in exact_spans):
                continue
            denominator = int(match.group(1))
            if denominator < 1:
                continue
            previous = noisy_denominator[denominator].get(channel)
            if previous is None or observation.confidence > previous.confidence:
                noisy_denominator[denominator][channel] = observation

    exact = _unique_clean_exact(clean_exact)
    if exact is not None:
        observation, numerator, denominator = exact
        return _serial_evidence(observation, numerator, denominator)

    exact = _unique_corroborated_exact(noisy_exact)
    if exact is not None:
        observation, numerator, denominator = exact
        return _serial_evidence(observation, numerator, denominator)

    denominator_only = _unique_clean_denominator(clean_denominator)
    if denominator_only is not None:
        observation, denominator = denominator_only
        return _denominator_evidence(observation, denominator)

    denominator_only = _unique_corroborated_denominator(noisy_denominator)
    if denominator_only is not None:
        observation, denominator = denominator_only
        return _denominator_evidence(observation, denominator)

    # Conflicting or one-channel noisy fraction evidence is intentionally
    # fail-neutral. It remains in the raw OCR record but contributes no serial
    # number and no print-run constraint to identity hints or Registry queries.
    return SerialEvidence(stamp_present=False)


def install_serial_evidence_guard() -> None:
    # Import lazily so app.local_vision can finish loading before its parser is
    # replaced. analyze_local_vision resolves this module global at call time.
    from . import local_vision

    local_vision.parse_serial_evidence = parse_serial_evidence_hardened
