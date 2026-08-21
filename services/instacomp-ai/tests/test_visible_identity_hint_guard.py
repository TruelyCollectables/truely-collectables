from __future__ import annotations

from app import local_vision
from app.models import OCRBox, OCRObservation, SerialEvidence, SideVisionEvidence
from app.visible_identity_hint_guard import (
    normalize_card_number_ocr_text,
    visible_product_line_hint,
)


def obs(
    text: str,
    side: str,
    *,
    confidence: float = 0.96,
    x: float = 0.1,
    y: float = 0.1,
    width: float = 0.5,
    height: float = 0.08,
) -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=confidence,
        box=OCRBox(x=x, y=y, width=width, height=height),
        side=side,
        source="test",
    )


def side(name: str, observations: list[OCRObservation]) -> SideVisionEvidence:
    return SideVisionEvidence(side=name, width=1100, height=1500, ocr=observations)


def test_visible_wnba_select_identity_hints_feed_registry_without_authorizing_it():
    front = side(
        "front",
        [
            obs("SELECT", "front", width=0.30),
            obs("KIKI IRIAFEN", "front", width=0.52, height=0.10),
            obs("RC", "front", width=0.10),
        ],
    )
    back = side(
        "back",
        [
            obs("KIKI IRIAFEN", "back", width=0.40),
            obs("2025 PANINI - WNBA SELECT BASKETBALL", "back", width=0.80),
            obs("No. 91", "back", y=0.82, width=0.18),
        ],
    )

    identity = local_vision.build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
    )

    assert identity.player == "KIKI IRIAFEN"
    assert identity.year == "2025"
    assert identity.manufacturer == "Panini"
    assert identity.set_name == "Select"
    assert identity.card_number == "91"


def test_visible_monopoly_prizm_product_line_keeps_both_release_tokens():
    observations = [
        obs("CAITLIN CLARK", "front"),
        obs("2024 PANINI - WNBA MONOPOLY PRIZM BASKETBALL", "back"),
    ]
    assert visible_product_line_hint(observations) == "Prizm Monopoly"


def test_bowman_chrome_product_line_is_recovered_from_visible_text():
    observations = [
        obs("BOWMAN CHROME", "front"),
        obs("GEORGE LOMBARD JR.", "front"),
        obs("GEORGE LOMBARD JR.", "back"),
    ]
    assert visible_product_line_hint(observations) == "Bowman Chrome"


def test_cyrillic_card_number_lookalikes_are_normalized_only_for_number_evidence():
    assert normalize_card_number_ocr_text("No. ВСР-79") == "No. BCP-79"

    front = side(
        "front",
        [obs("GEORGE LOMBARD JR.", "front"), obs("BOWMAN CHROME", "front")],
    )
    back = side(
        "back",
        [
            obs("GEORGE LOMBARD JR.", "back"),
            obs("No. ВСР-79", "back", y=0.82, width=0.24),
            obs("2024 TOPPS BOWMAN CHROME BASEBALL", "back", width=0.80),
        ],
    )
    identity = local_vision.build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
    )
    assert identity.player == "GEORGE LOMBARD JR"
    assert identity.set_name == "Bowman Chrome"
    assert identity.card_number == "BCP-79"


def test_front_only_player_like_text_is_not_promoted_when_back_disagrees():
    front = side("front", [obs("DALLAS WINGS", "front", width=0.65, height=0.12)])
    back = side(
        "back",
        [
            obs("PAIGE BUECKERS", "back"),
            obs("2025 PANINI - WNBA SELECT BASKETBALL", "back"),
            obs("No. 5", "back", y=0.82),
        ],
    )
    identity = local_vision.build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
    )
    assert identity.player is None
    assert identity.set_name == "Select"
    assert identity.card_number == "5"
