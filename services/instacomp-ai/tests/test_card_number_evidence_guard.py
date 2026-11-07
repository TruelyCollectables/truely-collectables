from __future__ import annotations

from app import lora_candidate_runtime
from app.models import CardIdentity, LocalVisionEvidence, OCRBox, OCRObservation, SideVisionEvidence
from app.ollama import merge_local_vision_payload


def _observation(text: str, *, side: str) -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=0.99,
        box=OCRBox(x=0.1, y=0.1, width=0.3, height=0.05),
        side=side,
        source="regression-test",
    )


def _vision(card_number_hint: str | None) -> LocalVisionEvidence:
    visible_number = card_number_hint or "22"
    front = SideVisionEvidence(
        side="front",
        width=1200,
        height=1800,
        ocr=[_observation("SONIA CITRON", side="front")],
    )
    back = SideVisionEvidence(
        side="back",
        width=1200,
        height=1800,
        ocr=[_observation(visible_number, side="back")],
    )
    return LocalVisionEvidence(
        front=front,
        back=back,
        identity_hints=CardIdentity(
            year="2025",
            manufacturer="Panini",
            player="Sonia Citron",
            card_number=card_number_hint,
        ),
        combined_text=f"SONIA CITRON\n{visible_number}",
        apple_vision_available=True,
        opencv_available=True,
    )


def _identity(card_number: str | None) -> dict:
    return {
        "sport": "Basketball",
        "year": "2025",
        "manufacturer": "Panini",
        "brand": "Panini Prizm WNBA",
        "set_name": "Base",
        "player": "Sonia Citron",
        "team": "Washington Mystics",
        "card_number": card_number,
        "parallel": None,
    }


def test_leading_truncated_ocr_does_not_overwrite_fuller_candidate_card_number() -> None:
    merged = merge_local_vision_payload(
        {"identity": _identity("122"), "evidence": {}},
        _vision("22"),
    )

    assert merged["identity"]["card_number"] == "122"
    assert "22" in merged["evidence"]["back_visible_text"]
    assert "22" in merged["evidence"]["visible_text"]
    assert any(
        "fuller explicit candidate '122' preserved" in value
        and "OCR hint '22'" in value
        for value in merged["evidence"]["uncertainty"]
    )


def test_non_truncation_conflict_keeps_existing_hard_ocr_authority() -> None:
    merged = merge_local_vision_payload(
        {"identity": _identity("1"), "evidence": {}},
        _vision("118"),
    )

    assert merged["identity"]["card_number"] == "118"
    assert "118" in merged["evidence"]["back_visible_text"]
    assert not any(
        "fuller explicit candidate" in value
        for value in merged["evidence"].get("uncertainty", [])
    )


def test_ocr_can_still_fill_card_number_when_candidate_is_missing() -> None:
    merged = merge_local_vision_payload(
        {"identity": _identity(None), "evidence": {}},
        _vision("22"),
    )

    assert merged["identity"]["card_number"] == "22"
    assert "22" in merged["evidence"]["back_visible_text"]


def test_exact_lora_candidate_path_preserves_sonia_122_and_raw_ocr_22() -> None:
    payload = {
        "ok": True,
        "validation_eligible": True,
        "model": "regression-model",
        "adapter_name": "regression-adapter",
        "adapter_weights_sha256": "0" * 64,
        "validation_receipt": "regression-receipt",
        "parsed": {
            "identity": _identity("122"),
            "evidence": {},
            "confidence": 0.9,
            "explanation": "regression candidate",
        },
    }

    suggestion = lora_candidate_runtime._candidate_response_to_suggestion(
        payload,
        local_vision=_vision("22"),
    )

    assert suggestion.provider == "instacomp_lora_candidate"
    assert suggestion.identity.player == "Sonia Citron"
    assert suggestion.identity.card_number == "122"
    assert "22" in suggestion.evidence.back_visible_text
    assert "22" in suggestion.evidence.visible_text
    assert any(
        "fuller explicit candidate '122' preserved" in value
        and "OCR hint '22'" in value
        for value in suggestion.evidence.uncertainty
    )
