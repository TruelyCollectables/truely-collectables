#!/usr/bin/env python3
from __future__ import annotations

import sys

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v7 as v7


SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v9"
_PATTERN_SENSITIVE_VARIANTS = {"ice", "velocity"}


def _canonical_variant_hardened(value: object) -> str | None:
    """Keep pattern families distinct from generic color labels.

    The prior canonicalizer returned ``blue`` for ``Blue Velocity Prizm`` because
    generic colors were checked before Velocity. That allowed a pattern-sensitive
    fixture through preflight without proving the directional surface geometry
    required by the runtime candidate guard.
    """
    text = v5.base.norm(value)
    if not text:
        return None
    if text in {"base", "regular", "standard", "none", "n/a", "na"}:
        return "base"

    words = set(text.replace("-", " ").split())
    if "cracked ice" in text or "ice" in words:
        return "ice"
    if "velocity" in text:
        return "velocity"
    for token in (
        "groovy",
        "silver",
        "green",
        "red",
        "blue",
        "orange",
        "purple",
        "gold",
        "black",
        "wave",
        "mojo",
        "scope",
        "hyper",
        "pulsar",
    ):
        if token in text:
            return token
    return text[:80]


def _default_image_parallel_probe_hardened(item: dict) -> str | None:
    """Use the same pattern-support gate in preflight and runtime.

    Frozen 25 used to admit a Blue Velocity teacher/Registry lock from trusted
    metadata even when deterministic local geometry could not support Velocity.
    Runtime correctly stripped that unsupported parallel later, making the round
    fail after activation. Pattern-sensitive expansion fixtures now qualify only
    when the exact runtime pattern guard would preserve the same image hint.
    """
    from app.config import settings
    from app.local_vision import analyze_local_vision_sync
    from app.lora_candidate_runtime import _pattern_parallel_supported

    paths = item.get("images") or []
    if not paths:
        return None
    try:
        front = paths[0].read_bytes()
        back = paths[1].read_bytes() if len(paths) > 1 else None
        vision = analyze_local_vision_sync(front, back, settings)
    except Exception:
        return None

    hints = getattr(vision, "identity_hints", None)
    raw_parallel = str(getattr(hints, "parallel", None) or "").strip() if hints is not None else ""
    marker = _canonical_variant_hardened(raw_parallel)
    if marker in {None, "base"}:
        return None
    if marker in _PATTERN_SENSITIVE_VARIANTS and not _pattern_parallel_supported(
        raw_parallel,
        vision,
    ):
        return None
    return marker


def _image_witness_conflict_hardened(
    item: dict,
    registry,
) -> tuple[bool, str | None, str | None, str | None]:
    image_marker = v5._image_parallel_probe(item)
    teacher_marker = v5._teacher_variant_claim(item["identity"])
    registry_marker = v5._registry_variant_claim(registry)

    # Pattern-sensitive rows are unsuitable Frozen 25 fixtures unless the same
    # deterministic witness that protects the runtime candidate positively
    # supports that family. This does not reject the card as inventory truth; it
    # only refuses to use an unprovable row as a promotion certification fixture.
    if teacher_marker in _PATTERN_SENSITIVE_VARIANTS and image_marker is None:
        return True, None, teacher_marker, registry_marker
    if not image_marker:
        return False, None, teacher_marker, registry_marker

    teacher_conflict = teacher_marker is not None and teacher_marker != image_marker
    registry_conflict = registry_marker is None or registry_marker != image_marker
    return teacher_conflict or registry_conflict, image_marker, teacher_marker, registry_marker


def _install_contract_fix() -> None:
    # Preserve every v7 structured-sidecar recovery, v6 Settings reload, v5
    # image witness, and authoritative Registry fail-closed gate. The hardened
    # serial parser and candidate identity-shape guard are installed package-wide
    # by app.__init__ before promotion.
    v7._install_contract_fix()
    v5._canonical_variant = _canonical_variant_hardened
    v5._default_image_parallel_probe = _default_image_parallel_probe_hardened
    v5._image_witness_conflict = _image_witness_conflict_hardened
    v3.SCHEMA = SCHEMA


def _candidate_shape_self_test() -> None:
    from app import lora_candidate_runtime
    from app.candidate_identity_guard import normalize_candidate_identity_payload

    payload = {
        "parsed": {
            "identity": {
                "sport": "Basketball",
                "year": "2025",
                "manufacturer": "Panini",
                "brand": "Panini Prizm",
                "set_name": "2025 Panini Prizm WNBA - Blue Velocity Prizms",
                "player": "Ajsa Sivka",
                "card_number": "85",
                "parallel": None,
            },
            "evidence": {},
        }
    }
    normalized, repaired = normalize_candidate_identity_payload(payload)
    identity = normalized["parsed"]["identity"]
    assert repaired is True
    assert identity["brand"] == "Panini Prizm WNBA"
    assert identity["set_name"] == "Base"
    assert identity["parallel"] == "Blue Velocity Prizm"

    contradictory = {
        "parsed": {
            "identity": {
                **payload["parsed"]["identity"],
                "parallel": "Silver Prizm",
            }
        }
    }
    unchanged, repaired = normalize_candidate_identity_payload(contradictory)
    assert repaired is False
    assert unchanged["parsed"]["identity"]["set_name"].endswith("Blue Velocity Prizms")
    assert unchanged["parsed"]["identity"]["parallel"] == "Silver Prizm"

    assert getattr(lora_candidate_runtime, "_instacomp_candidate_identity_guard_installed", False)
    assert lora_candidate_runtime._candidate_response_to_suggestion.__module__ == (
        "app.candidate_identity_guard"
    )
    print("PASS Ajsa-style Prizm parallel-in-set-name drift is normalized before Registry")
    print("PASS contradictory explicit parallel remains fail-closed and is not rewritten")


def _promotion_variant_contract_self_test() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    registry_id = "00000000-0000-0000-0005-000000000085"
    fingerprint = "8" * 64

    def registry(parallel: str | None) -> ChecklistResult:
        return ChecklistResult(
            outcome=ChecklistOutcome.EXACT_MATCH,
            identity_id=registry_id,
            identity=CardIdentity(
                year="2025",
                brand="Prizm",
                set_name="Base",
                player="Ajsa Sivka",
                card_number="85",
                parallel=parallel,
            ),
            candidate_count=1,
            source_receipts=[
                f"registry_identity:{registry_id}",
                f"registry_fingerprint:{fingerprint}",
            ],
        )

    def item(parallel: str | None) -> dict:
        return {
            "identity": {
                "year": "2025",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "Ajsa Sivka",
                "card_number": "85",
                "parallel": parallel,
            }
        }

    assert _canonical_variant_hardened("Blue Velocity Prizm") == "velocity"
    assert _canonical_variant_hardened("Prizms Blue Velocity") == "velocity"
    assert _canonical_variant_hardened("Blue Prizm") == "blue"

    previous = v5._image_parallel_probe_override
    try:
        v5._image_parallel_probe_override = lambda _item: None
        conflict, image_marker, teacher_marker, registry_marker = (
            _image_witness_conflict_hardened(
                item("Blue Velocity Prizm"),
                registry("Prizms Blue Velocity"),
            )
        )
        assert conflict is True
        assert image_marker is None
        assert teacher_marker == "velocity"
        assert registry_marker == "velocity"

        v5._image_parallel_probe_override = lambda _item: "velocity"
        conflict, image_marker, teacher_marker, registry_marker = (
            _image_witness_conflict_hardened(
                item("Blue Velocity Prizm"),
                registry("Prizms Blue Velocity"),
            )
        )
        assert conflict is False
        assert image_marker == teacher_marker == registry_marker == "velocity"

        v5._image_parallel_probe_override = lambda _item: None
        conflict, _image_marker, teacher_marker, registry_marker = (
            _image_witness_conflict_hardened(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is False
        assert teacher_marker == registry_marker == "silver"
    finally:
        v5._image_parallel_probe_override = previous

    print("PASS Blue Velocity remains a Velocity family instead of collapsing to generic blue")
    print("PASS unsupported pattern-sensitive expansion rows are skipped before activation")
    print("PASS ordinary Silver/Base rows retain fail-neutral image-witness behavior")


def _serial_guard_self_test() -> None:
    from app import local_vision
    from app.lora_candidate_runtime import _candidate_response_to_suggestion
    from app.models import LocalVisionEvidence, OCRBox, OCRObservation, SideVisionEvidence
    from app.ollama import local_vision_prompt_payload

    def obs(
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

    def vision(rows: list[OCRObservation]) -> LocalVisionEvidence:
        front_rows = [value for value in rows if value.side != "back"]
        back_rows = [value for value in rows if value.side == "back"]
        front = SideVisionEvidence(
            side="front",
            width=1200,
            height=1800,
            ocr=front_rows,
        )
        back = (
            SideVisionEvidence(
                side="back",
                width=1200,
                height=1800,
                ocr=back_rows,
            )
            if back_rows
            else None
        )
        serial = local_vision.parse_serial_evidence(rows)
        hints = local_vision.build_identity_hints(front=front, back=back, serial=serial)
        return LocalVisionEvidence(
            front=front,
            back=back,
            serial=serial,
            identity_hints=hints,
            combined_text="\n".join(value.text for value in rows),
            apple_vision_available=True,
            opencv_available=True,
        )

    def candidate_payload(serial_number: str | None, serial_run: int | None) -> dict:
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

    assert local_vision.parse_serial_evidence.__module__ == "app.serial_evidence_guard"

    # Exact regression from the physical A'ja Wilson #76 Mac fixture. A noisy
    # fraction may remain in raw OCR, but neither the local hints, sidecar prompt,
    # merged candidate, nor Registry-bound identity may treat it as a serial.
    aja_vision = vision([obs("A'JA WILSON 2/6 0б 6 CARD 76")])
    assert aja_vision.serial.stamp_present is False
    assert aja_vision.serial.exact_stamp is None
    assert aja_vision.serial.visible_denominator is None
    assert aja_vision.identity_hints.serial_number is None
    assert aja_vision.identity_hints.serial_run is None
    prompt = local_vision_prompt_payload(aja_vision)
    assert prompt is not None
    assert prompt["serial"]["exact_stamp"] is None
    assert prompt["serial"]["visible_denominator"] is None
    assert prompt["identity_hints"]["serial_number"] is None
    assert prompt["identity_hints"]["serial_run"] is None

    aja_candidate = _candidate_response_to_suggestion(
        candidate_payload("2/6", 6),
        local_vision=aja_vision,
    )
    assert aja_candidate.provider == "instacomp_lora_candidate"
    assert aja_candidate.identity.serial_number is None
    assert aja_candidate.identity.serial_run is None

    # Do not regress the feature while fixing the false positive. A genuine
    # isolated physical copy stamp remains authoritative evidence and overrides a
    # conflicting free-form model guess before Registry.
    real_vision = vision(
        [
            obs("A'JA WILSON CARD 76", side="front"),
            obs("017/299", side="back"),
        ]
    )
    assert real_vision.serial.stamp_present is True
    assert real_vision.serial.exact_stamp == "17/299"
    assert real_vision.serial.visible_denominator == 299
    real_candidate = _candidate_response_to_suggestion(
        candidate_payload("2/6", 6),
        local_vision=real_vision,
    )
    assert real_candidate.identity.serial_number == "17/299"
    assert real_candidate.identity.serial_run == 299

    print("PASS A'ja noisy OCR contributes zero Registry serial constraints")
    print("PASS LoRA candidate cannot re-inject an unsupported serial after local merge")
    print("PASS genuine clean front/back physical serial stamps remain readable")
    print("PASS genuine physical serial evidence overrides a conflicting model serial")


def self_test() -> int:
    assert v7.self_test() == 0
    _install_contract_fix()
    _candidate_shape_self_test()
    _promotion_variant_contract_self_test()
    _serial_guard_self_test()
    print("PASS Frozen 25 v9 preserves every v7/v6/v5 Registry and zero-fallback gate")
    print("PASS Frozen 25 preflight and runtime now share the same pattern-sensitive admission contract")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
