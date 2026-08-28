from __future__ import annotations

import re
import unicodedata
from typing import Iterable

from . import local_vision as module
from .models import CardIdentity, OCRObservation, SerialEvidence, SideVisionEvidence


# Apple Vision occasionally returns Cyrillic lookalikes inside otherwise Latin
# card-number prefixes (for example ВСР-79 instead of BCP-79). Normalize only
# the bounded card-number witness; never rewrite the full OCR transcript.
_CARD_NUMBER_CONFUSABLES = str.maketrans(
    {
        "А": "A",
        "В": "B",
        "С": "C",
        "Е": "E",
        "Н": "H",
        "К": "K",
        "М": "M",
        "О": "O",
        "Р": "P",
        "Т": "T",
        "Х": "X",
        "У": "Y",
        "а": "A",
        "в": "B",
        "с": "C",
        "е": "E",
        "н": "H",
        "к": "K",
        "м": "M",
        "о": "O",
        "р": "P",
        "т": "T",
        "х": "X",
        "у": "Y",
    }
)


def normalize_card_number_ocr_text(value: object) -> str:
    return str(value or "").translate(_CARD_NUMBER_CONFUSABLES)


def _normalized_observations(
    observations: Iterable[OCRObservation],
) -> list[OCRObservation]:
    return [
        observation.model_copy(
            update={"text": normalize_card_number_ocr_text(observation.text)}
        )
        for observation in observations
    ]


def _normalized_words(value: object) -> str:
    ascii_text = (
        unicodedata.normalize("NFKD", str(value or ""))
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.lower()).strip()


def _front_player_candidates(
    observations: Iterable[OCRObservation],
) -> list[tuple[float, str, str]]:
    candidates: list[tuple[float, str, str]] = []
    for observation in observations:
        if observation.side != "front":
            continue
        cleaned = re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ .'-]+", " ", observation.text)
        cleaned = " ".join(cleaned.split()).strip(" .-")
        words = cleaned.split()
        if not 2 <= len(words) <= 5:
            continue
        lowered_words = {word.lower().strip(".'-") for word in words}
        if lowered_words & module.PLAYER_STOPWORDS:
            continue
        if any(len(word) < 2 for word in words):
            continue
        normalized = _normalized_words(cleaned)
        if not normalized:
            continue
        score = observation.confidence * (0.7 + min(0.3, observation.box.height * 5))
        candidates.append((score, cleaned, normalized))
    return candidates


def registry_product_line_hint_from_text(value: object) -> str | None:
    """Return a conservative Registry query hint from bounded visible text.

    This is deliberately NOT written into CardIdentity.set_name. Product-line OCR
    is candidate evidence only; the central Registry must still resolve one exact
    current UUID + fingerprint before identity or pricing becomes trusted.
    """
    text = _normalized_words(value)
    if not text:
        return None

    monopoly = re.compile(
        r"(?:\bprizm\b.*\bmonopoly\b|\bmonopoly\b.*\bprizm\b)"
    )
    if monopoly.search(text):
        return "Prizm Monopoly"
    if "wnba" in text.split():
        if re.search(r"\bdonruss\b", text):
            return "Panini Donruss WNBA"
        if re.search(r"\bselect\b", text):
            return "Panini Select WNBA"
        if re.search(r"\bpriz(?:m|ms|sm|sms)\b|\bprism\b", text):
            return "Panini Prizm WNBA"

    patterns: tuple[tuple[re.Pattern[str], str], ...] = (
        (re.compile(r"\bbowman\s+chrome\b"), "Bowman Chrome"),
        (re.compile(r"\btopps\s+chrome\b"), "Topps Chrome"),
        (re.compile(r"\bselect\b"), "Select"),
        (re.compile(r"\bpriz(?:m|ms|sm|sms)\b"), "Prizm"),
        (re.compile(r"\bpanini\s+instant\b|\binstant\s+wnba\b"), "Panini Instant"),
        (re.compile(r"\bdonruss\b"), "Donruss"),
        (re.compile(r"\borigins\b"), "Origins"),
        (re.compile(r"\bimpeccable\b"), "Impeccable"),
        (re.compile(r"\bone\s+and\s+one\b"), "One and One"),
        (re.compile(r"\bscore\b"), "Score"),
        (re.compile(r"\boptic\b"), "Optic"),
        (re.compile(r"\bmosaic\b"), "Mosaic"),
        (re.compile(r"\bupper\s+deck\s+ice\b"), "Upper Deck Ice"),
        (re.compile(r"\bo\s*pee\s*chee\s+platinum\b"), "O-Pee-Chee Platinum"),
    )
    for pattern, label in patterns:
        if pattern.search(text):
            return label
    return None


def visible_product_line_hint(observations: Iterable[OCRObservation]) -> str | None:
    text = " ".join(
        str(observation.text or "")
        for observation in observations
        if observation.text
    )
    return registry_product_line_hint_from_text(text)


def visible_subset_hint(observations: Iterable[OCRObservation]) -> str | None:
    text = _normalized_words(" ".join(
        str(observation.text or "")
        for observation in observations
        if observation.text
    ))
    if not text:
        return None
    patterns: tuple[tuple[re.Pattern[str], str], ...] = (
        (re.compile(r"\ball american\b"), "All American"),
        (re.compile(r"\bcrunch time\b"), "Crunch Time"),
        (re.compile(r"\bbase\b"), "Base"),
    )
    for pattern, label in patterns:
        if pattern.search(text):
            return label
    return None


def visible_player_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)

    # When a back image exists, require the same name to be visibly repeated on
    # the back. This rejects common front-only team/slogan typography while still
    # recovering normal card layouts where the player name is printed both sides.
    # Do this before choosing the highest-score candidate so sponsor text such as
    # "UCLA Health" cannot outrank the real player and make us throw away a good
    # repeated name.
    back_text = _normalized_words(
        " ".join(value.text for value in values if value.side == "back")
    )
    candidates = _front_player_candidates(values)
    if back_text:
        repeated = [
            (score + 2.0, candidate)
            for score, candidate, normalized in candidates
            if f" {normalized} " in f" {back_text} "
        ]
        if repeated:
            return max(repeated, key=lambda value: value[0])[1]
        return None

    candidate = module._player_hint(values)
    return candidate


def install_visible_identity_hint_guard() -> None:
    if getattr(module, "_visible_identity_hint_guard_installed", False):
        return

    original = module.build_identity_hints

    def guarded_build_identity_hints(
        *,
        front: SideVisionEvidence,
        back: SideVisionEvidence | None,
        serial: SerialEvidence,
    ) -> CardIdentity:
        base = original(front=front, back=back, serial=serial)
        observations = [*front.ocr, *(back.ocr if back else [])]
        values = base.model_dump()

        player = visible_player_hint(observations)
        subset = visible_subset_hint(observations)
        card_number = module._card_number_hint(_normalized_observations(observations))

        if not values.get("player") and player:
            values["player"] = player
        if not values.get("subset") and subset:
            values["subset"] = subset
        # Keep local set_name untouched. Product-line OCR is passed separately as
        # a Registry-only query hint by AuthoritativeRegistryChecklistGateway.
        if not values.get("card_number") and card_number:
            values["card_number"] = card_number

        return CardIdentity.model_validate(values)

    module.build_identity_hints = guarded_build_identity_hints
    module._visible_identity_hint_guard_installed = True
    module._instacomp_pre_visible_identity_build_identity_hints = original
