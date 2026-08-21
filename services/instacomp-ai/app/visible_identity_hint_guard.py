from __future__ import annotations

import re
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
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def visible_product_line_hint(observations: Iterable[OCRObservation]) -> str | None:
    """Return a conservative product-line witness from text printed on the card.

    This value is only a Registry query hint. It never authorizes identity or
    pricing by itself; the central Registry must still return one exact UUID and
    fingerprint across player, card number, product/set, parallel and serial
    evidence.
    """
    text = " ".join(
        _normalized_words(observation.text)
        for observation in observations
        if observation.text
    )
    if not text:
        return None

    patterns: tuple[tuple[re.Pattern[str], str], ...] = (
        (re.compile(r"\bbowman\s+chrome\b"), "Bowman Chrome"),
        (re.compile(r"\btopps\s+chrome\b"), "Topps Chrome"),
        (
            re.compile(r"(?:\bprizm\b.*\bmonopoly\b|\bmonopoly\b.*\bprizm\b)"),
            "Prizm Monopoly",
        ),
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


def visible_player_hint(observations: Iterable[OCRObservation]) -> str | None:
    values = list(observations)
    candidate = module._player_hint(values)
    if not candidate:
        return None

    # When a back image exists, require the same name to be visibly repeated on
    # the back. This rejects common front-only team/slogan typography while still
    # recovering normal card layouts where the player name is printed both sides.
    back_text = _normalized_words(
        " ".join(value.text for value in values if value.side == "back")
    )
    if back_text:
        player = _normalized_words(candidate)
        if not player or f" {player} " not in f" {back_text} ":
            return None
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
        product_line = visible_product_line_hint(observations)
        card_number = module._card_number_hint(_normalized_observations(observations))

        if not values.get("player") and player:
            values["player"] = player
        if not values.get("set_name") and product_line:
            values["set_name"] = product_line
        if not values.get("card_number") and card_number:
            values["card_number"] = card_number

        return CardIdentity.model_validate(values)

    module.build_identity_hints = guarded_build_identity_hints
    module._visible_identity_hint_guard_installed = True
    module._instacomp_pre_visible_identity_build_identity_hints = original
