#!/usr/bin/env python3
from __future__ import annotations

import sys

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v7 as v7


SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v8"


def _install_contract_fix() -> None:
    # Preserve every v7 structured-sidecar recovery, v6 Settings reload, v5
    # image witness, and authoritative Registry fail-closed gate. The serial
    # parser is installed package-wide by app.__init__ before promotion starts.
    v7._install_contract_fix()
    v3.SCHEMA = SCHEMA


def _serial_guard_self_test() -> None:
    from app import local_vision
    from app.models import OCRBox, OCRObservation

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

    assert local_vision.parse_serial_evidence.__module__ == "app.serial_evidence_guard"

    # Exact regression from the physical A'ja Wilson #76 Mac fixture. The
    # fraction-shaped OCR fragment is embedded in a noisy front line and the
    # back did not independently show the same copy stamp. It must therefore
    # remain diagnostic-only and must not become Registry serialNumber=2/6.
    aja = local_vision.parse_serial_evidence([obs("2/6 0б 6")])
    assert aja.stamp_present is False
    assert aja.exact_stamp is None
    assert aja.visible_denominator == 6

    clean = local_vision.parse_serial_evidence([obs("017/299", side="back")])
    assert clean.stamp_present is True
    assert clean.exact_stamp == "17/299"
    assert clean.visible_denominator == 299

    corroborated = local_vision.parse_serial_evidence(
        [
            obs("stats 17/299 glare", side="front", confidence=0.91),
            obs("edge 17/299 foil", side="back", confidence=0.93),
        ]
    )
    assert corroborated.stamp_present is True
    assert corroborated.exact_stamp == "17/299"

    same_channel = local_vision.parse_serial_evidence(
        [
            obs("stats 17/299 glare"),
            obs("edge 17/299 foil"),
        ]
    )
    assert same_channel.stamp_present is False
    assert same_channel.exact_stamp is None

    print("PASS A'ja noisy front OCR fraction cannot become a Registry serial constraint")
    print("PASS clean physical copy stamps remain authoritative serial evidence")
    print("PASS noisy serial evidence requires an independent OCR channel")


def self_test() -> int:
    assert v7.self_test() == 0
    _install_contract_fix()
    _serial_guard_self_test()
    print("PASS Frozen 25 v8 preserves every v7/v6/v5 Registry and zero-fallback gate")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
