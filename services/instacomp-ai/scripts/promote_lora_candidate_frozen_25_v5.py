#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import Any, Callable

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v4 as v4
import promote_lora_candidate_frozen_five as base


_original_locked_expansion = v3._locked_expansion
ImageParallelProbe = Callable[[dict[str, Any]], str | None]
_image_parallel_probe_override: ImageParallelProbe | None = None


def _canonical_variant(value: object) -> str | None:
    text = base.norm(value)
    if not text:
        return None
    if text in {"base", "regular", "standard", "none", "n/a", "na"}:
        return "base"

    words = set(text.replace("-", " ").split())
    if "cracked ice" in text or "ice" in words:
        return "ice"
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
        "velocity",
        "wave",
        "mojo",
        "scope",
        "hyper",
        "pulsar",
    ):
        if token in text:
            return token
    return text[:80]


def _teacher_variant_claim(identity: dict[str, Any]) -> str | None:
    for key in ("parallel", "variation", "subset"):
        raw = base.norm(identity.get(key))
        if raw:
            return _canonical_variant(raw)
    return None


def _registry_variant_claim(registry: Any) -> str | None:
    locked = getattr(registry, "identity", None)
    if locked is None:
        return None
    payload = (
        locked.model_dump(mode="json")
        if hasattr(locked, "model_dump")
        else dict(locked)
    )
    for key in ("parallel", "variation", "subset"):
        raw = base.norm(payload.get(key))
        if raw:
            return _canonical_variant(raw)
    return None


def _default_image_parallel_probe(item: dict[str, Any]) -> str | None:
    """Return only a positive deterministic image-surface parallel witness.

    The local vision stack intentionally emits named parallel hints only for
    measured high-confidence surface geometry. Unknown/ambiguous image evidence
    returns None and never invents a variant. This is an independent witness used
    only to reject contradictory teacher/Registry locks before activation.
    """
    from app.config import settings
    from app.local_vision import analyze_local_vision_sync

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
    marker = _canonical_variant(getattr(hints, "parallel", None)) if hints is not None else None
    return None if marker in {None, "base"} else marker


def _image_parallel_probe(item: dict[str, Any]) -> str | None:
    probe = _image_parallel_probe_override or _default_image_parallel_probe
    try:
        return probe(item)
    except Exception:
        return None


def _image_witness_conflict(
    item: dict[str, Any],
    registry: Any,
) -> tuple[bool, str | None, str | None, str | None]:
    image_marker = _image_parallel_probe(item)
    if not image_marker:
        return False, None, _teacher_variant_claim(item["identity"]), _registry_variant_claim(registry)

    teacher_marker = _teacher_variant_claim(item["identity"])
    registry_marker = _registry_variant_claim(registry)

    teacher_conflict = teacher_marker is not None and teacher_marker != image_marker
    registry_conflict = registry_marker is None or registry_marker != image_marker
    return teacher_conflict or registry_conflict, image_marker, teacher_marker, registry_marker


def _locked_expansion(item: dict[str, Any], registry: Any) -> dict[str, Any] | None:
    conflict, image_marker, teacher_marker, registry_marker = _image_witness_conflict(item, registry)
    if conflict:
        identity = item.get("identity") or {}
        print(
            f"FROZEN 25 IMAGE WITNESS REJECT {identity.get('player')} "
            f"#{identity.get('card_number')}: teacher_variant={teacher_marker!r} "
            f"image_variant={image_marker!r} registry_variant={registry_marker!r}",
            flush=True,
        )
        return None

    locked = _original_locked_expansion(item, registry)
    if locked is not None and image_marker:
        locked["image_parallel_witness"] = image_marker
        locked["registry_lock_source"] = (
            "live_authoritative_registry_preflight_plus_local_image_variant_witness"
        )
    return locked


def _install_contract_fix() -> None:
    # Keep every v4 correction, then add only the independent image witness gate.
    v4._install_contract_fix()
    v3._locked_expansion = _locked_expansion
    v3.SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v4"


def self_test() -> int:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    global _image_parallel_probe_override

    _install_contract_fix()

    # Preserve the complete v3/v4 real-dataset contract while making its fake
    # image bytes intentionally witness-neutral.
    previous = _image_parallel_probe_override
    _image_parallel_probe_override = lambda _item: None
    try:
        assert v3.self_test() == 0
    finally:
        _image_parallel_probe_override = previous

    registry_id = "00000000-0000-0000-0006-000000000092"
    fingerprint = "9" * 64

    def registry(parallel: str) -> ChecklistResult:
        return ChecklistResult(
            outcome=ChecklistOutcome.EXACT_MATCH,
            identity_id=registry_id,
            identity=CardIdentity(
                year="2025",
                brand="Prizm",
                set_name="Base",
                player="Angel Reese",
                card_number="92",
                parallel=parallel,
            ),
            candidate_count=1,
            source_receipts=[
                f"registry_identity:{registry_id}",
                f"registry_fingerprint:{fingerprint}",
            ],
        )

    def item(parallel: str | None) -> dict[str, Any]:
        identity = {
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "Angel Reese",
            "card_number": "92",
            "parallel": parallel,
        }
        return {
            "row_id": "angel-92",
            "split": "validation",
            "images": [],
            "identity": identity,
            "marker": v4._meaningful_variant_marker(identity),
            "metadata_registry_id": None,
            "metadata_fingerprint": None,
        }

    try:
        _image_parallel_probe_override = lambda _item: "ice"

        assert _locked_expansion(item("Silver"), registry("Silver")) is None
        assert _locked_expansion(item("Base"), registry("Base")) is None

        accepted = _locked_expansion(item("Cracked Ice Prizm"), registry("Prizms Ice"))
        assert accepted is not None
        assert accepted.get("image_parallel_witness") == "ice"
        assert accepted.get("registry_lock_source") == (
            "live_authoritative_registry_preflight_plus_local_image_variant_witness"
        )

        _image_parallel_probe_override = lambda _item: None
        unknown = _locked_expansion(item("Silver"), registry("Silver"))
        assert unknown is not None
    finally:
        _image_parallel_probe_override = previous

    print("PASS image witness rejects Silver teacher over Cracked Ice surface evidence")
    print("PASS image witness rejects explicit Base teacher over Cracked Ice surface evidence")
    print("PASS Cracked Ice teacher and Prizms Ice Registry canonicalize to one ice witness")
    print("PASS unknown image pattern remains fail-neutral and does not invent a variant")
    return 0


def main() -> int:
    _install_contract_fix()
    if "--self-test" in sys.argv[1:]:
        return self_test()
    return v3.main()


if __name__ == "__main__":
    raise SystemExit(main())
