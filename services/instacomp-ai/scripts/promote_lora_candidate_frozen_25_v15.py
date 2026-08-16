#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import Any

import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v14 as v14

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v15"


def _strict_non_base_image_witness_conflict(
    item: dict[str, Any],
    registry: Any,
) -> tuple[bool, str | None, str | None, str | None]:
    """Require physical image support for every non-Base expansion variant.

    v9 correctly made Ice/Velocity fail closed when the deterministic image
    witness was absent, but deliberately left ordinary color/foil parallels
    such as Silver fail-neutral.  That allowed the DeWanna Bonner #32 Silver
    teacher/Registry lock into Frozen 15 even though the production candidate
    saw the same images as Base.  The round then resolved the legitimate Base
    Registry UUID and failed only after candidate activation.

    Promotion fixtures are certification witnesses, not inventory truth.  A
    non-Base fixture therefore qualifies only when local vision positively
    supports the same canonical variant family as both teacher and Registry.
    Unknown evidence is still fail-neutral for Base/unspecified fixtures.
    """
    image_marker = v5._image_parallel_probe(item)
    teacher_marker = v5._teacher_variant_claim(item["identity"])
    registry_marker = v5._registry_variant_claim(registry)

    if teacher_marker not in {None, "base"} and image_marker is None:
        return True, None, teacher_marker, registry_marker

    if not image_marker:
        return False, None, teacher_marker, registry_marker

    teacher_conflict = teacher_marker is not None and teacher_marker != image_marker
    registry_conflict = registry_marker is None or registry_marker != image_marker
    return teacher_conflict or registry_conflict, image_marker, teacher_marker, registry_marker


def _install_contract() -> None:
    # Install v14's pinned backfill plus every inherited throttle, Registry,
    # serial, candidate-shape, and pattern-sensitive safety gate first.
    v14._install_contract()

    # v12 installs v11 -> v10 -> v9 again after argument parsing.  Patch both
    # the v9 source hook and the currently-installed v5 hook so that re-install
    # cannot restore the old Silver fail-neutral behavior.
    v9._image_witness_conflict_hardened = _strict_non_base_image_witness_conflict
    v5._image_witness_conflict = _strict_non_base_image_witness_conflict

    # Stamp staged receipts with this incident-specific runner.
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


def _self_test_non_base_witness_gate() -> None:
    from types import SimpleNamespace

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

    previous = v5._image_parallel_probe_override
    try:
        # Exact production regression: teacher + Registry say Silver, but the
        # image/runtime has no positive Silver witness.  v9 accepted this;
        # v15 must reject it before candidate activation.
        v5._image_parallel_probe_override = lambda _item: None
        conflict, image_marker, teacher_marker, registry_marker = (
            _strict_non_base_image_witness_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is True
        assert image_marker is None
        assert teacher_marker == registry_marker == "silver"

        # Base remains fail-neutral when local vision has no named parallel.
        conflict, image_marker, teacher_marker, registry_marker = (
            _strict_non_base_image_witness_conflict(
                item("Base"),
                registry("Base"),
            )
        )
        assert conflict is False
        assert image_marker is None
        assert teacher_marker == registry_marker == "base"

        # A positive Silver witness preserves the proven Silver fixture.
        v5._image_parallel_probe_override = lambda _item: "silver"
        conflict, image_marker, teacher_marker, registry_marker = (
            _strict_non_base_image_witness_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is False
        assert image_marker == teacher_marker == registry_marker == "silver"

        # A physically contradictory witness stays fail closed.
        v5._image_parallel_probe_override = lambda _item: "green"
        conflict, image_marker, teacher_marker, registry_marker = (
            _strict_non_base_image_witness_conflict(
                item("Silver Prizm"),
                registry("Prizms Silver"),
            )
        )
        assert conflict is True
        assert image_marker == "green"
        assert teacher_marker == registry_marker == "silver"
    finally:
        v5._image_parallel_probe_override = previous

    # Frozen 15 has 15 expansion candidates for 10 required additions.  The
    # captured production run already rejected Ajsa and Brianna; rejecting the
    # newly-proven unsafe DeWanna fixture still leaves twelve candidates for ten
    # slots, so v14 backfill can continue instead of activating a known loser.
    assert v14.PINNED_BACKFILL_POOL_SIZES[15] == 15
    assert v14.REQUIRED_NEW_FIXTURES[15] == 10
    assert v14.PINNED_BACKFILL_POOL_SIZES[15] - 3 >= v14.REQUIRED_NEW_FIXTURES[15]

    print("PASS v15 rejects DeWanna-style Silver fixtures with no positive image variant witness")
    print("PASS v15 preserves Base fail-neutral behavior when no named parallel is visible")
    print("PASS v15 preserves Silver fixtures when local vision positively supports Silver")
    print("PASS v15 keeps contradictory non-Base teacher/image/Registry evidence fail-closed")
    print("PASS v15 Frozen 15 backfill capacity survives the two prior rejects plus DeWanna")


def self_test() -> int:
    assert v14.self_test() == 0
    _install_contract()
    _self_test_non_base_witness_gate()
    assert v9._image_witness_conflict_hardened is _strict_non_base_image_witness_conflict
    assert v5._image_witness_conflict is _strict_non_base_image_witness_conflict
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
