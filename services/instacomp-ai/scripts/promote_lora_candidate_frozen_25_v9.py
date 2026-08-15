#!/usr/bin/env python3
from __future__ import annotations

import sys

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v7 as v7


SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v9"


def _install_contract_fix() -> None:
    # Preserve every v7 structured-sidecar recovery, v6 Settings reload, v5
    # image witness, and authoritative Registry fail-closed gate. The hardened
    # serial parser is installed package-wide by app.__init__ before promotion.
    v7._install_contract_fix()
    v3.SCHEMA = SCHEMA


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
    _serial_guard_self_test()
    print("PASS Frozen 25 v9 preserves every v7/v6/v5 Registry and zero-fallback gate")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
