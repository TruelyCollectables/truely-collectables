#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v14 as v14
import promote_lora_candidate_frozen_25_v15 as v15

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v16"
_BASE_PINNED_BUILD = v12.build_staged_pinned_live

# Keep every previously reviewed pin first, but do not let a stale 20-row pin
# universe make a stage impossible. Replacement rows are drawn deterministically
# from the same trusted, image-backed supervised dataset and STILL must survive
# the complete v15 live Registry + physical-card preflight before admission.
# These are availability ceilings, not pass quotas and not relaxed acceptance.
DYNAMIC_BACKFILL_POOL_SIZES = {15: 60, 25: 120}


def _ordered_backfill_ids(
    pinned: tuple[str, ...],
    eligible: list[str],
    seed_ids: set[str],
    desired_size: int,
) -> tuple[str, ...]:
    if desired_size < len(pinned):
        raise RuntimeError("Dynamic backfill size cannot truncate the reviewed pinned prefix")

    ordered = list(pinned)
    seen = set(ordered)
    for row_id in eligible:
        if not row_id or row_id in seen or row_id in seed_ids:
            continue
        ordered.append(row_id)
        seen.add(row_id)
        if len(ordered) >= desired_size:
            break
    return tuple(ordered)


def _dynamic_row_ids(
    dataset: Path,
    *,
    require_images: bool,
    target: int,
) -> tuple[str, ...]:
    pinned = tuple(v12.PINNED_EXPANSION_ROW_IDS)
    desired_size = DYNAMIC_BACKFILL_POOL_SIZES[target]

    seeds = v12.base.fixtures(dataset, require_images=require_images)
    seed_ids = {str(item.get("row_id") or "") for item in seeds}

    candidates: list[dict[str, Any]] = []
    for row in v12.base.load_rows(dataset):
        item = v12._ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is None:
            continue
        candidates.append(item)
    candidates.sort(key=v12._ORIGINAL_EXPANSION_SORT_KEY)
    eligible_ids = [str(item.get("row_id") or "") for item in candidates]

    ordered = _ordered_backfill_ids(pinned, eligible_ids, seed_ids, desired_size)
    if len(ordered) < desired_size:
        raise RuntimeError(
            f"Frozen {target} dynamic backfill could only assemble {len(ordered)} "
            f"eligible rows; required bounded pool size={desired_size}"
        )
    if ordered[: len(pinned)] != pinned:
        raise RuntimeError("Dynamic backfill changed the reviewed pinned priority prefix")
    return ordered


async def build_staged_pinned_live_v16(
    dataset: Path,
    *,
    require_images: bool = True,
    registry_match=None,
) -> list[dict[str, Any]]:
    target = int(v12.v3.TARGET)
    if target not in DYNAMIC_BACKFILL_POOL_SIZES:
        return await _BASE_PINNED_BUILD(
            dataset,
            require_images=require_images,
            registry_match=registry_match,
        )

    row_ids = _dynamic_row_ids(
        dataset,
        require_images=require_images,
        target=target,
    )
    pool_size = len(row_ids)

    # v12's builder is intentionally reused rather than bypassed. It still owns
    # the live Registry exact-lock requirement, duplicate UUID protection, player
    # caps, image requirements, v10 evidence-aligned retries, and v15's physical
    # Prizm/pattern witness gate. Only the deterministic candidate availability is
    # widened before that fail-closed selection runs.
    v12.PINNED_EXPANSION_ROW_IDS = row_ids
    v12.PINNED_EXPANSION_BUDGETS[target] = pool_size
    v12.PREFLIGHT_REGISTRY_CALL_CEILINGS[target] = (
        pool_size * v12.MAX_REGISTRY_CALLS_PER_EXPANSION_ROW
    )
    v14.PINNED_BACKFILL_POOL_SIZES[target] = pool_size

    print(
        f"FROZEN {target} V16 DYNAMIC BACKFILL: reviewed_prefix=20 "
        f"candidate_pool={pool_size} registry_call_ceiling="
        f"{v12.PREFLIGHT_REGISTRY_CALL_CEILINGS[target]}",
        flush=True,
    )
    return await _BASE_PINNED_BUILD(
        dataset,
        require_images=require_images,
        registry_match=registry_match,
    )


def _install_contract() -> None:
    # Install the complete v15 physical/Registry hierarchy first.
    v15._install_contract()

    # v12.main() installs its staged function after CLI parsing by reading the
    # module-global symbol. Replace that symbol with this wrapper so all inherited
    # contracts remain active and only candidate availability changes.
    v12.build_staged_pinned_live = build_staged_pinned_live_v16
    v12.SCHEMA = SCHEMA
    v12.v11.SCHEMA = SCHEMA


def _self_test_dynamic_backfill() -> None:
    pinned = tuple(f"pin-{index}" for index in range(20))
    eligible = ["seed-1", "pin-3", "extra-1", "extra-1", "extra-2", "extra-3"]
    ordered = _ordered_backfill_ids(pinned, eligible, {"seed-1"}, 23)
    assert ordered[:20] == pinned
    assert ordered[20:] == ("extra-1", "extra-2", "extra-3")
    assert len(set(ordered)) == len(ordered)

    assert DYNAMIC_BACKFILL_POOL_SIZES[15] == 60
    assert DYNAMIC_BACKFILL_POOL_SIZES[25] == 120
    assert DYNAMIC_BACKFILL_POOL_SIZES[15] > len(v12.PINNED_EXPANSION_ROW_IDS)

    print("PASS v16 preserves all 20 reviewed pins as the deterministic priority prefix")
    print("PASS v16 excludes Frozen Five seed rows and duplicate backfill row IDs")
    print("PASS v16 bounds Frozen 15/25 replacement availability at 60/120 rows")


def self_test() -> int:
    assert v15.self_test() == 0
    _install_contract()
    _self_test_dynamic_backfill()
    assert v12.build_staged_pinned_live is build_staged_pinned_live_v16
    assert v9._image_witness_conflict_hardened is v15._authoritative_prizm_back_mark_conflict
    assert v5._image_witness_conflict is v15._authoritative_prizm_back_mark_conflict
    print("PASS v16 preserves every v15/v14/v13/v12/v11/v10/v9 fail-closed gate")
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
