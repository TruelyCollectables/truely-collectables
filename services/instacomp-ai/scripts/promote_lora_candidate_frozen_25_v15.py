#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from typing import Any, Callable

import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v14 as v14

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v15"
_INHERITED_IMAGE_WITNESS_CONFLICT = v9._image_witness_conflict_hardened
PrizmBackMarkProbe = Callable[[dict[str, Any]], bool | None]
_prizm_back_mark_probe_override: PrizmBackMarkProbe | None = None


def _fixture_is_prizm(item: dict[str, Any], registry: Any) -> bool:
    identity = item.get("identity") or {}
    locked = getattr(registry, "identity", None)
    if hasattr(locked, "model_dump"):
        registry_identity = locked.model_dump(mode="json")
    elif isinstance(locked, dict):
        registry_identity = locked
    else:
        registry_identity = {}
    context = " ".join(
        str(payload.get(key) or "")
        for payload in (identity, registry_identity)
        for key in ("brand", "set_name", "subset", "parallel", "variation")
    )
    return bool(re.search(r"\bprizm\b", context, re.I))


def _default_prizm_back_mark_probe(item: dict[str, Any]) -> bool | None:
    from app.config import settings
    from app.local_vision import analyze_local_vision_sync
    from app.prizm_back_mark_guard import bold_black_prizm_back_mark

    paths = item.get("images") or []
    if len(paths) < 2:
        return None
    try:
        front = paths[0].read_bytes()
        back = paths[1].read_bytes()
        vision = analyze_local_vision_sync(front, back, settings)
        return bold_black_prizm_back_mark(vision, back)
    except Exception:
        return None


def _prizm_back_mark_probe(item: dict[str, Any]) -> bool | None:
    probe = _prizm_back_mark_probe_override or _default_prizm_back_mark_probe
    try:
        return probe(item)
    except Exception:
        return None


def _authoritative_prizm_back_mark_conflict(
    item: dict[str, Any],
    registry: Any,
) -> tuple[bool, str | None, str | None, str | None]:
    """Use the printed back PRIZM mark as the Base/non-Base authority.

    The production failure was not a Registry error. DeWanna Bonner #32 was
    admitted as Silver even though the runtime later resolved the physical card
    as Base. For Panini Prizm, the owner-supplied physical rule is decisive:
    without the prominent bold black PRIZM word on the back, the card is Base.

    The back mark decides only Base versus Prizm parallel. Once that mark is
    present, v9's inherited deterministic surface gate still distinguishes
    pattern-sensitive families such as Velocity and Cracked Ice and still rejects
    contradictory physical evidence. Ordinary Silver no longer needs a made-up
    front-surface Silver detector; it needs the actual back PRIZM mark.
    """
    teacher_marker = v5._teacher_variant_claim(item["identity"])
    registry_marker = v5._registry_variant_claim(registry)

    if _fixture_is_prizm(item, registry):
        back_mark = _prizm_back_mark_probe(item)
        if back_mark is not True:
            if teacher_marker not in {None, "base"} or registry_marker not in {None, "base"}:
                return True, "base" if back_mark is False else None, teacher_marker, registry_marker
            # Explicit/unspecified Base is consistent with an absent back mark.
            return False, None, teacher_marker, registry_marker

        # A present PRIZM mark proves this is not regular Base. Do not admit an
        # explicit Base teacher or Registry lock over that physical evidence.
        if teacher_marker == "base" or registry_marker == "base":
            return True, "prizm_back_mark", teacher_marker, registry_marker

    return _INHERITED_IMAGE_WITNESS_CONFLICT(item, registry)


def _install_contract() -> None:
    # Install v14's pinned backfill plus every inherited throttle, Registry,
    # serial, candidate-shape, and pattern-sensitive safety gate first.
    v14._install_contract()

    # v12 installs v11 -> v10 -> v9 again after argument parsing. Patch both the
    # v9 source hook and the currently-installed v5 hook so a later re-install
    # cannot restore the old Silver fail-neutral Base/non-Base behavior.
    v9._image_witness_conflict_hardened = _authoritative_prizm_back_mark_conflict
    v5._image_witness_conflict = _authoritative_prizm_back_mark_conflict

    # Stamp staged receipts with this incident-specific runner.
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


def _self_test_prizm_back_mark_gate() -> None:
    from types import SimpleNamespace

    global _prizm_back_mark_probe_override

    def item(parallel: str | None) -> dict[str, Any]:
        return {
            "identity": {
                "year": "2025",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "DeWanna Bonner",
                "card_number": "32",
                "parallel": parallel,
            }
        }

    def registry(parallel: str | None):
        return SimpleNamespace(
            identity={
                "year": "2025",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "DeWanna Bonner",
                "card_number": "32",
                "parallel": parallel,
            }
        )

    previous_image = v5._image_parallel_probe_override
    previous_back = _prizm_back_mark_probe_override
    try:
        # Exact production regression: teacher + Registry said Silver, but the
        # authoritative back did not carry the PRIZM mark. This is Base and must
        # be rejected before candidate activation.
        _prizm_back_mark_probe_override = lambda _item: False
        v5._image_parallel_probe_override = lambda _item: None
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is True
        assert image_marker == "base"
        assert teacher_marker == registry_marker == "silver"

        # The same absent back mark is affirmative support for regular Base.
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Base"),
                registry("Base"),
            )
        )
        assert conflict is False
        assert image_marker is None
        assert teacher_marker == registry_marker == "base"

        # A real back PRIZM mark is enough to preserve an ordinary Silver
        # teacher/Registry lock even though front geometry has no Silver label.
        _prizm_back_mark_probe_override = lambda _item: True
        v5._image_parallel_probe_override = lambda _item: None
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is False
        assert image_marker is None
        assert teacher_marker == registry_marker == "silver"

        # A visible back PRIZM mark means explicit Base is physically wrong.
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Base"),
                registry("Base"),
            )
        )
        assert conflict is True
        assert image_marker == "prizm_back_mark"
        assert teacher_marker == registry_marker == "base"

        # The back mark does not weaken existing pattern-sensitive gates.
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Blue Velocity Prizm"),
                registry("Prizms Blue Velocity"),
            )
        )
        assert conflict is True
        assert image_marker is None
        assert teacher_marker == registry_marker == "velocity"

        v5._image_parallel_probe_override = lambda _item: "velocity"
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Blue Velocity Prizm"),
                registry("Prizms Blue Velocity"),
            )
        )
        assert conflict is False
        assert image_marker == teacher_marker == registry_marker == "velocity"

        # If the back cannot be read at all, non-Base promotion fails closed.
        _prizm_back_mark_probe_override = lambda _item: None
        v5._image_parallel_probe_override = lambda _item: None
        conflict, image_marker, teacher_marker, registry_marker = (
            _authoritative_prizm_back_mark_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is True
        assert image_marker is None
        assert teacher_marker == registry_marker == "silver"
    finally:
        v5._image_parallel_probe_override = previous_image
        _prizm_back_mark_probe_override = previous_back

    # Frozen 15 has 15 expansion candidates for 10 required additions. The
    # captured production run already rejected Ajsa and Brianna; rejecting the
    # newly-proven Base DeWanna fixture still leaves twelve candidates for ten
    # slots, so v14 backfill can continue instead of activating a known loser.
    assert v14.PINNED_BACKFILL_POOL_SIZES[15] == 15
    assert v14.REQUIRED_NEW_FIXTURES[15] == 10
    assert v14.PINNED_BACKFILL_POOL_SIZES[15] - 3 >= v14.REQUIRED_NEW_FIXTURES[15]

    print("PASS v15 rejects Silver when the authoritative back PRIZM mark is absent")
    print("PASS v15 treats absent back PRIZM mark as regular Base")
    print("PASS v15 allows ordinary Silver only when the back PRIZM mark is present")
    print("PASS v15 rejects explicit Base when the back PRIZM mark is present")
    print("PASS v15 preserves Velocity/Ice deterministic surface gates after the back-mark gate")
    print("PASS v15 fails non-Base promotion closed when the back mark cannot be read")
    print("PASS v15 Frozen 15 backfill capacity survives the two prior rejects plus DeWanna")


def self_test() -> int:
    assert v14.self_test() == 0
    _install_contract()
    _self_test_prizm_back_mark_gate()
    assert v9._image_witness_conflict_hardened is _authoritative_prizm_back_mark_conflict
    assert v5._image_witness_conflict is _authoritative_prizm_back_mark_conflict
    print("PASS v15 preserves every v14/v13/v12/v11/v10/v9 inherited fail-closed gate")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    _install_contract()
    try:
        return v12.main()
    except v14.v13.RegistryThrottleAbort as error:
        print(f"REGISTRY THROTTLE ABORT: {error}", file=sys.stderr, flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
