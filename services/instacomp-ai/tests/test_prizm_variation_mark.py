from __future__ import annotations

from app.local_vision import build_identity_hints
from app.models import SerialEvidence, SideVisionEvidence


def _side(side: str, observations: list[dict]) -> SideVisionEvidence:
    return SideVisionEvidence.model_validate(
        {
            "side": side,
            "width": 800,
            "height": 1100,
            "ocr": observations,
        }
    )


def _obs(text: str, *, side: str, height: float, width: float = 0.08):
    return {
        "text": text,
        "confidence": 0.99,
        "box": {"x": 0.4, "y": 0.4, "width": width, "height": height},
        "side": side,
        "source": "test",
    }


def test_large_back_v_plus_front_rc_is_rookie_variation():
    front = _side(
        "front",
        [
            _obs("RC", side="front", height=0.05),
            _obs("SONIA CITRON", side="front", height=0.03, width=0.25),
        ],
    )
    back = _side(
        "back",
        [
            _obs("V", side="back", height=0.11, width=0.10),
            _obs("No. 148", side="back", height=0.03, width=0.16),
            _obs("PANINI PRIZM", side="back", height=0.025, width=0.20),
        ],
    )

    identity = build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(),
    )

    assert identity.rookie is True
    assert identity.variation == "Rookie Variation"


def test_large_back_v_without_front_rc_is_variation():
    front = _side(
        "front",
        [_obs("SONIA CITRON", side="front", height=0.03, width=0.25)],
    )
    back = _side(
        "back",
        [
            _obs("V", side="back", height=0.11, width=0.10),
            _obs("No. 148", side="back", height=0.03, width=0.16),
        ],
    )

    identity = build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(),
    )

    assert identity.variation == "Variation"


def test_small_back_v_does_not_create_variation():
    front = _side(
        "front",
        [_obs("RC", side="front", height=0.05)],
    )
    back = _side(
        "back",
        [
            _obs("V", side="back", height=0.018, width=0.015),
            _obs("No. 148", side="back", height=0.03, width=0.16),
        ],
    )

    identity = build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(),
    )

    assert identity.rookie is True
    assert identity.variation is None


def test_front_rc_without_back_v_is_not_variation():
    front = _side(
        "front",
        [_obs("RC", side="front", height=0.05)],
    )
    back = _side(
        "back",
        [_obs("No. 148", side="back", height=0.03, width=0.16)],
    )

    identity = build_identity_hints(
        front=front,
        back=back,
        serial=SerialEvidence(),
    )

    assert identity.rookie is True
    assert identity.variation is None
