from __future__ import annotations

from app.local_vision import build_identity_hints, parse_serial_evidence
from app.lora_candidate_runtime import _candidate_response_to_suggestion
from app.models import (
    LocalVisionEvidence,
    OCRBox,
    OCRObservation,
    SideVisionEvidence,
)
from app.ollama import local_vision_prompt_payload


def _obs(
    text: str,
    *,
    side: str = "front",
    source: str = "apple-vision",
    confidence: float = 0.99,
) -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=confidence,
        box=OCRBox(x=0.1, y=0.1, width=0.4, height=0.05),
        side=side,
        source=source,
    )


def _vision(observations: list[OCRObservation]) -> LocalVisionEvidence:
    front_observations = [value for value in observations if value.side != "back"]
    back_observations = [value for value in observations if value.side == "back"]
    front = SideVisionEvidence(
        side="front",
        width=1200,
        height=1800,
        ocr=front_observations,
    )
    back = (
        SideVisionEvidence(
            side="back",
            width=1200,
            height=1800,
            ocr=back_observations,
        )
        if back_observations
        else None
    )
    serial = parse_serial_evidence(observations)
    identity_hints = build_identity_hints(front=front, back=back, serial=serial)
    return LocalVisionEvidence(
        front=front,
        back=back,
        serial=serial,
        identity_hints=identity_hints,
        combined_text="\n".join(value.text for value in observations),
        apple_vision_available=True,
        opencv_available=True,
    )


def _candidate_payload(*, serial_number: str | None, serial_run: int | None) -> dict:
    return {
        "ok": True,
        "validation_eligible": True,
        "model": "self-test-model",
        "adapter_name": "self-test-adapter",
        "adapter_weights_sha256": "0" * 64,
        "validation_receipt": "self-test",
        "parsed": {
            "identity": {
                "year": "2025",
                "manufacturer": "Panini",
                "player": "A'ja Wilson",
                "card_number": "76",
                "serial_number": serial_number,
                "serial_run": serial_run,
            },
            "evidence": {},
            "confidence": 0.9,
            "explanation": "self-test candidate",
        },
    }


def test_aja_noisy_front_fraction_is_not_any_serial_constraint() -> None:
    evidence = parse_serial_evidence([_obs("2/6 0б 6")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.numerator is None
    assert evidence.visible_denominator is None


def test_noisy_fraction_inside_stats_is_not_a_serial_constraint() -> None:
    evidence = parse_serial_evidence([_obs("STATS 2/6 FG")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.visible_denominator is None


def test_clean_bare_serial_stamp_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("017/299", side="back")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"
    assert evidence.numerator == 17
    assert evidence.visible_denominator == 299


def test_clean_front_serial_stamp_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("017/299", side="front")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_explicit_serial_cue_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("SERIAL 017/299", side="front")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_clean_of_stamp_remains_authoritative() -> None:
    evidence = parse_serial_evidence([_obs("17 OF 299", side="back")])
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_clean_denominator_only_stamp_remains_visible_evidence() -> None:
    evidence = parse_serial_evidence([_obs("/299", side="back")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.visible_denominator == 299


def test_explicit_print_run_context_preserves_denominator_without_copy_stamp() -> None:
    evidence = parse_serial_evidence([_obs("Parallel print run /99")])
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.numerator is None
    assert evidence.visible_denominator == 99


def test_noisy_denominator_only_requires_independent_corroboration() -> None:
    evidence = parse_serial_evidence([_obs("PRINT RUN /299 MAYBE")])
    assert evidence.stamp_present is False
    assert evidence.visible_denominator == 299

    corroborated = parse_serial_evidence(
        [
            _obs("FOIL /299 READ", side="front", source="apple-vision"),
            _obs("PARALLEL /299 READ", side="back", source="apple-vision"),
        ]
    )
    assert corroborated.stamp_present is False
    assert corroborated.visible_denominator == 299


def test_repeated_noisy_fraction_same_channel_is_not_corroboration() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare"),
            _obs("edge 17/299 foil"),
        ]
    )
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    assert evidence.visible_denominator is None


def test_noisy_fraction_requires_independent_channel_corroboration() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare", side="front", source="apple-vision", confidence=0.91),
            _obs("edge 17/299 foil", side="back", source="apple-vision", confidence=0.93),
        ]
    )
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"
    assert evidence.visible_denominator == 299


def test_different_ocr_sources_can_corroborate_same_side() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("stats 17/299 glare", source="apple-vision", confidence=0.90),
            _obs("edge 17/299 foil", source="secondary-ocr", confidence=0.94),
        ]
    )
    assert evidence.stamp_present is True
    assert evidence.exact_stamp == "17/299"


def test_conflicting_clean_copy_stamps_fail_neutral() -> None:
    evidence = parse_serial_evidence(
        [
            _obs("17/299", side="front"),
            _obs("18/299", side="back"),
        ]
    )
    assert evidence.stamp_present is False
    assert evidence.exact_stamp is None
    # The two independent observations still agree on the configuration-level
    # print run even though the physical copy numerator is conflicted.
    assert evidence.visible_denominator == 299


def test_full_aja_style_line_cannot_poison_prompt_or_identity_hints() -> None:
    vision = _vision([_obs("A'JA WILSON 2/6 0б 6 CARD 76", side="front")])
    assert vision.serial.stamp_present is False
    assert vision.serial.exact_stamp is None
    assert vision.serial.visible_denominator is None
    assert vision.identity_hints.serial_number is None
    assert vision.identity_hints.serial_run is None

    prompt = local_vision_prompt_payload(vision)
    assert prompt is not None
    assert prompt["serial"]["exact_stamp"] is None
    assert prompt["serial"]["visible_denominator"] is None
    assert prompt["identity_hints"]["serial_number"] is None
    assert prompt["identity_hints"]["serial_run"] is None


def test_lora_candidate_cannot_reinject_aja_false_serial_into_registry_identity() -> None:
    vision = _vision([_obs("A'JA WILSON 2/6 0б 6 CARD 76", side="front")])
    suggestion = _candidate_response_to_suggestion(
        _candidate_payload(serial_number="2/6", serial_run=6),
        local_vision=vision,
    )
    assert suggestion.provider == "instacomp_lora_candidate"
    assert suggestion.identity.serial_number is None
    assert suggestion.identity.serial_run is None


def test_real_physical_serial_overrides_candidate_noise_before_registry() -> None:
    vision = _vision(
        [
            _obs("A'JA WILSON CARD 76", side="front"),
            _obs("017/299", side="back"),
        ]
    )
    suggestion = _candidate_response_to_suggestion(
        _candidate_payload(serial_number="2/6", serial_run=6),
        local_vision=vision,
    )
    assert suggestion.identity.serial_number == "17/299"
    assert suggestion.identity.serial_run == 299
