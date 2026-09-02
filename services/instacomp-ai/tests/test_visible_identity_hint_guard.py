from __future__ import annotations

import json

import httpx
import pytest

from app import authoritative_registry_gateway as gateway_module
from app import local_vision
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import CardIdentity, OCRBox, OCRObservation, SerialEvidence, SideVisionEvidence
from app.visible_identity_hint_guard import (
    normalize_card_number_ocr_text,
    registry_product_line_hint_from_text,
    visible_product_line_hint,
    visible_subset_hint,
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


def test_visible_wnba_select_identity_hints_keep_set_soft_for_registry():
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
    assert identity.set_name is None
    assert identity.card_number == "91"
    assert registry_product_line_hint_from_text(
        "2025 PANINI - WNBA SELECT BASKETBALL"
    ) == "Panini Select WNBA"


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
    assert identity.set_name is None
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
    assert identity.set_name is None
    assert identity.card_number == "5"


def test_repeated_player_name_outranks_front_sponsor_text():
    front = side(
        "front",
        [
            obs("ROOKIE", "front", width=0.14, height=0.05),
            obs("UCLA Health", "front", confidence=1.0, width=0.62, height=0.12),
            obs("SARAH ASHLEE BARKER", "front", confidence=0.96, width=0.50, height=0.08),
        ],
    )
    back = side(
        "back",
        [
            obs("No. 66", "back", y=0.82, width=0.18),
            obs("SARAH ASHLEE BARKER", "back", width=0.46),
            obs("2025 PANINI - WNBA SELECT BASKETBALL", "back", width=0.80),
        ],
    )

    identity = local_vision.build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
    )

    assert identity.player == "SARAH ASHLEE BARKER"
    assert identity.card_number == "66"


def test_repeated_accented_player_name_is_promoted_with_ascii_front_variant():
    front = side(
        "front",
        [
            obs("AJSA SIVKA", "front", confidence=0.97, width=0.42, height=0.08),
            obs("CHICAGO SKY", "front", confidence=1.0, width=0.62, height=0.12),
        ],
    )
    back = side(
        "back",
        [
            obs("AJŠA SIVKA • CHICAGO", "back", width=0.50),
            obs("No. 93", "back", y=0.82, width=0.18),
            obs("2025 PANINI - WNBA DONRUSS BASKETBALL", "back", width=0.80),
        ],
    )

    identity = local_vision.build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(stamp_present=False),
    )

    assert identity.player == "AJSA SIVKA"
    assert identity.card_number == "93"


class _CaptureRegistryClient:
    last_json = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, *, headers, json):
        type(self).last_json = json
        request = httpx.Request("POST", url)
        return httpx.Response(
            200,
            content=globals()["json"].dumps(
                {
                    "ok": True,
                    "status": "set_present_no_exact_match",
                    "resolverStatus": "internal_set_present_no_exact_match",
                    "reasons": ["fixture_review"],
                    "candidateCount": 2,
                }
            ).encode("utf-8"),
            request=request,
        )


@pytest.mark.asyncio
async def test_registry_gateway_uses_product_line_as_request_hint_only(monkeypatch):
    _CaptureRegistryClient.last_json = None
    monkeypatch.setattr(gateway_module, "_registry_base_url", lambda: "https://registry.example")
    monkeypatch.setattr(gateway_module, "_registry_headers", lambda: {})
    monkeypatch.setattr(gateway_module.httpx, "AsyncClient", _CaptureRegistryClient)

    identity = CardIdentity(
        year="2025",
        manufacturer="Panini",
        player="KIKI IRIAFEN",
        card_number="91",
        set_name=None,
    )
    gateway = AuthoritativeRegistryChecklistGateway(retry_backoff_seconds=0)
    await gateway.match_with_diagnostics(
        identity,
        "KIKI IRIAFEN No. 91 2025 PANINI - WNBA SELECT BASKETBALL",
    )

    assert identity.set_name is None
    assert _CaptureRegistryClient.last_json["setName"] == "Panini Select WNBA"
    assert _CaptureRegistryClient.last_json["player"] == "KIKI IRIAFEN"


def test_repeated_name_replaces_legacy_front_ocr_garbage():
    front = side("front", [obs("OTS PN", "front", confidence=1.0, height=0.12), obs("BRANDON COMPTON", "front", confidence=1.0)])
    back = side("back", [obs("BRANDON COMPTON", "back", confidence=1.0), obs("CPA-BCO", "back", y=0.82)])
    identity = local_vision.build_identity_hints(front=front, back=back, serial=SerialEvidence(stamp_present=False))
    assert identity.player == "BRANDON COMPTON"
    assert identity.card_number == "CPA-BCO"


def test_guarded_unlabeled_prefixed_card_code_is_recovered():
    front = side("front", [obs("BRANDON COMPTON", "front")])
    back = side("back", [obs("BRANDON COMPTON", "back"), obs("CPA-BCO", "back", y=0.82, width=0.20)])
    identity = local_vision.build_identity_hints(front=front, back=back, serial=SerialEvidence(stamp_present=False))
    assert identity.card_number == "CPA-BCO"


def test_cyrillic_lookalike_checklist_code_is_normalized():
    front = side("front", [obs("GEORGE LOMBARD JR", "front", confidence=1.0)])
    back = side("back", [obs("GEORGE LOMBARD JR", "back", confidence=1.0), obs("ВСР-79", "back", y=0.82, confidence=0.9)])
    identity = local_vision.build_identity_hints(front=front, back=back, serial=SerialEvidence(stamp_present=False))
    assert identity.card_number == "BCP-79"

def test_registry_product_line_reads_real_wnba_footer_variants():
    assert registry_product_line_hint_from_text("2025 PANINI - WNBA SELECT BASKETBALL") == "Panini Select WNBA"
    assert registry_product_line_hint_from_text("2025 PANINI - WNBA PRIZM BASKETBALL") == "Panini Prizm WNBA"
    assert registry_product_line_hint_from_text("2024 PANINI - WNBA PRIZM BASKETBALL") == "Panini Prizm WNBA"


def test_registry_product_line_reads_bowman_chrome_trademark_footer():
    assert registry_product_line_hint_from_text("TOPPS AND BOWMAN CHROME ARE REGISTERED TRADEMARKS") == "Bowman Chrome"


def test_visible_subset_recovers_fractal_with_cyrillic_lookalike():
    from app.visible_identity_hint_guard import visible_subset_hint
    observations = [obs("FRAСТАL", "front", confidence=1.0)]
    assert visible_subset_hint(observations) == "Fractal"

def test_visible_subset_recovers_real_sonia_fireworks_ocr_corruption():
    observations = [obs("FREWORKS", "back", confidence=0.97), obs("2025 PANINI - WNBA PRIZM BASKETBALL", "back", confidence=0.96)]
    assert visible_subset_hint(observations) == "Fireworks"


def test_visible_subset_reads_real_fireworks_ocr_corruption():
    observations = [obs("FIRELFORKS", "front"), obs("HREMORKS", "back")]
    assert visible_subset_hint(observations) == "Fireworks"


def test_visible_subset_reads_select_levels_and_en_fuego():
    assert visible_subset_hint([obs("EN FUEGO", "front")]) == "En Fuego"
    assert visible_subset_hint([obs("PREMIER LEVEL", "back")]) == "Base Set - Premier Level"
    assert visible_subset_hint([obs("COURTSIDE", "back")]) == "Base Set - Courtside"
    assert visible_subset_hint([obs("CONCOURSE", "back")]) == "Base Set - Concourse"


def test_visible_subset_reads_snapshots_before_guessing_en_fuego():
    assert visible_subset_hint([obs("SNAPSHOTS", "front")]) == "Snapshots"
