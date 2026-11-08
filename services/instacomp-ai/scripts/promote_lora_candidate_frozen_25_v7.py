#!/usr/bin/env python3
from __future__ import annotations

import base64
import io
import json
import sys
from types import SimpleNamespace
from typing import Any

import httpx
from PIL import Image

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v6 as v6
import promote_lora_candidate_frozen_five_v2 as frozen_five_v2


_original_case_evidence = frozen_five_v2.case_evidence


def _candidate_fallback_fields(suggestion: Any) -> dict[str, Any]:
    raw = getattr(suggestion, "raw", None)
    raw = raw if isinstance(raw, dict) else {}
    return {
        "candidate_fallback_error": raw.get("lora_candidate_error"),
        "candidate_fallback_error_type": raw.get("lora_candidate_error_type"),
        "candidate_runtime_transport": raw.get("transport"),
    }


def _case_evidence(
    item: dict[str, Any],
    suggestion: Any,
    registry: Any,
    case: tuple,
    registry_diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record = _original_case_evidence(
        item,
        suggestion,
        registry,
        case,
        registry_diagnostics,
    )
    record.update(_candidate_fallback_fields(suggestion))
    return record


def _install_contract_fix() -> None:
    # Preserve every v6 Settings reload, v5 image witness, and Registry gate.
    # Only add actionable candidate-fallback diagnostics to round evidence.
    v6._install_contract_fix()
    frozen_five_v2.case_evidence = _case_evidence
    v3.SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v7"


def _transport_self_test() -> None:
    from app import lora_candidate_runtime as legacy_runtime
    from app import lora_candidate_runtime_v2 as runtime_v2
    from app.models import (
        CardIdentity,
        LocalVisionEvidence,
        OCRBox,
        OCRObservation,
        PatternEvidence,
        SerialEvidence,
        SideVisionEvidence,
    )

    # App initialization must install the hardened transport globally, not only
    # inside this promotion process.
    assert legacy_runtime._analyze_candidate is runtime_v2._analyze_candidate_hardened

    image = Image.new("RGB", (2600, 1800), (220, 220, 220))
    source = io.BytesIO()
    image.save(source, format="PNG")
    source_bytes = source.getvalue()

    observations = [
        OCRObservation(
            text=("AJA WILSON SERIAL 2/6 CARD 76 " + ("VISIBLE " * 8) + str(index)),
            confidence=0.99,
            box=OCRBox(x=0.1, y=0.1, width=0.2, height=0.05),
            side="front" if index % 2 == 0 else "back",
            source="self-test",
        )
        for index in range(120)
    ]
    front = SideVisionEvidence(
        side="front",
        width=2600,
        height=1800,
        ocr=[row for row in observations if row.side == "front"],
        pattern=PatternEvidence(
            label="cracked_ice",
            confidence=0.95,
            geometry=["non-directional multi-angle edge geometry"],
            line_count=300,
            polygon_count=200,
            angle_entropy=0.9,
        ),
    )
    back = SideVisionEvidence(
        side="back",
        width=2600,
        height=1800,
        ocr=[row for row in observations if row.side == "back"],
    )
    vision = LocalVisionEvidence(
        front=front,
        back=back,
        serial=SerialEvidence(
            stamp_present=True,
            exact_stamp="2/6",
            numerator=2,
            visible_denominator=6,
            side="front",
            confidence=0.99,
            source_text="2/6",
            box=OCRBox(x=0.2, y=0.2, width=0.1, height=0.05),
        ),
        identity_hints=CardIdentity(
            year="2025",
            manufacturer="Panini",
            player="A'ja Wilson",
            card_number="76",
            parallel="Cracked Ice Prizm",
            serial_number="2/6",
            serial_run=6,
        ),
        combined_text="AJA WILSON " * 30000,
        apple_vision_available=True,
        opencv_available=True,
    )

    raw_evidence_bytes = len(
        json.dumps(vision.model_dump(mode="json"), separators=(",", ":")).encode("utf-8")
    )
    body = runtime_v2._candidate_request_body(
        source_bytes,
        source_bytes,
        local_vision=vision,
    )
    compact_evidence_bytes = len(
        json.dumps(body["deterministic_evidence"], separators=(",", ":")).encode("utf-8")
    )
    assert raw_evidence_bytes > 250000
    assert compact_evidence_bytes < 30000
    assert "combined_text" not in body["deterministic_evidence"]
    assert body["transport_schema"] == runtime_v2.CANDIDATE_TRANSPORT_SCHEMA

    prepared = base64.b64decode(body["front_base64"], validate=True)
    with Image.open(io.BytesIO(prepared)) as opened:
        assert max(opened.size) <= 1280
        assert opened.format == "JPEG"

    response = httpx.Response(
        422,
        json={"ok": False, "error": "ValueError", "detail": "candidate parse failed"},
    )
    failure = runtime_v2._sidecar_failure(response)
    assert "HTTP 422" in str(failure)
    assert "ValueError" in str(failure)
    assert "candidate parse failed" in str(failure)

    print("PASS expansion candidate images are bounded to decode-safe 1280px JPEG")
    print("PASS A'ja-scale deterministic evidence is compacted before sidecar transport")
    print("PASS full LocalVisionEvidence remains outside the bounded prompt for post-response merge")
    print("PASS sidecar HTTP failures retain bounded status/error/detail diagnostics")


def _fallback_diagnostic_self_test() -> None:
    suggestion = SimpleNamespace(
        raw={
            "lora_candidate_fallback": True,
            "lora_candidate_error": "LoRA candidate sidecar HTTP 422 error=ValueError",
            "lora_candidate_error_type": "RuntimeError",
            "transport": "localhost_mlx_vlm_sidecar",
        }
    )
    fields = _candidate_fallback_fields(suggestion)
    assert fields["candidate_fallback_error"] == (
        "LoRA candidate sidecar HTTP 422 error=ValueError"
    )
    assert fields["candidate_fallback_error_type"] == "RuntimeError"
    assert fields["candidate_runtime_transport"] == "localhost_mlx_vlm_sidecar"
    print("PASS Frozen 25 fallback evidence preserves the actual candidate runtime error")


def self_test() -> int:
    assert v6.self_test() == 0
    _install_contract_fix()
    _transport_self_test()
    _fallback_diagnostic_self_test()
    print("PASS Frozen 25 v7 preserves every v6/v5 Registry and image fail-closed gate")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
