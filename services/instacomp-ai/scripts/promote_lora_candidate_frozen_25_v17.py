#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v9 as v9
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v14 as v14
import promote_lora_candidate_frozen_25_v15 as v15
import promote_lora_candidate_frozen_25_v16 as v16

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v17"
_BASE_PINNED_BUILD = v16._BASE_PINNED_BUILD
DYNAMIC_BACKFILL_POOL_SIZES = dict(v16.DYNAMIC_BACKFILL_POOL_SIZES)
REVIEWED_PINNED_ROW_IDS = tuple(v12.PINNED_EXPANSION_ROW_IDS)


def _manifest_carry_forward_expansion_ids(
    manifest: dict[str, Any],
    *,
    seed_row_ids: tuple[str, ...],
    target: int,
) -> tuple[str, ...]:
    prior = v11.PRIOR_STAGE[target]
    if prior <= len(seed_row_ids):
        return ()
    if manifest.get("schema_version") != v11.MANIFEST_SCHEMA or manifest.get("complete") is not True:
        raise RuntimeError("Prior staged fixture manifest is not complete")
    if int(manifest.get("stage_target") or 0) != prior:
        raise RuntimeError(
            f"Frozen {target} requires Frozen {prior} immediately before it; "
            f"manifest stage={manifest.get('stage_target')!r}"
        )

    signatures = v11._manifest_fixture_signatures(manifest)
    if len(signatures) != prior:
        raise RuntimeError(
            f"Frozen {target} prior manifest has {len(signatures)} fixtures; expected {prior}"
        )
    manifest_row_ids = tuple(str(item.get("row_id") or "") for item in signatures)
    if manifest_row_ids[: len(seed_row_ids)] != seed_row_ids:
        raise RuntimeError(
            f"Frozen {target} prior manifest no longer matches the exact Frozen Five row prefix"
        )

    expansion = manifest_row_ids[len(seed_row_ids) :]
    if not expansion or any(not row_id for row_id in expansion):
        raise RuntimeError(f"Frozen {target} prior manifest has missing expansion row IDs")
    if len(set(expansion)) != len(expansion):
        raise RuntimeError(f"Frozen {target} prior manifest repeats an expansion row ID")
    return expansion


def _prior_stage_expansion_ids(
    dataset: Path,
    *,
    require_images: bool,
    target: int,
    manifest_path: Path | None = None,
) -> tuple[str, ...]:
    prior = v11.PRIOR_STAGE[target]
    if prior == 5:
        return ()

    path = manifest_path or v11.STAGE_MANIFEST
    if not path.is_file():
        raise RuntimeError(
            f"Frozen {target} requires a successful Frozen {prior} fixture manifest first: {path}"
        )
    manifest = v12.base.read_json(path)
    seeds = v12.base.fixtures(dataset, require_images=require_images)
    seed_row_ids = tuple(str(item.get("row_id") or "") for item in seeds)
    if len(seed_row_ids) != 5 or len(set(seed_row_ids)) != 5 or any(not row_id for row_id in seed_row_ids):
        raise RuntimeError("Frozen Five seed rows are missing, duplicated, or malformed")
    return _manifest_carry_forward_expansion_ids(
        manifest,
        seed_row_ids=seed_row_ids,
        target=target,
    )


def _ordered_dynamic_backfill_ids(
    *,
    carry_forward: tuple[str, ...],
    eligible: list[str],
    seed_ids: set[str],
    desired_size: int,
) -> tuple[str, ...]:
    # The exact expansion rows from the successful immediately-prior stage MUST
    # be tried first. The original reviewed pin universe follows, then bounded
    # deterministic image-backed extras. This makes v11's strict prefix contract
    # constructive instead of merely checking it after discovery has already
    # selected a different set of cards.
    priority = list(carry_forward)
    seen = set(priority)
    for row_id in REVIEWED_PINNED_ROW_IDS:
        if row_id and row_id not in seen and row_id not in seed_ids:
            priority.append(row_id)
            seen.add(row_id)

    if desired_size < len(priority):
        raise RuntimeError(
            f"Dynamic backfill pool {desired_size} is too small for carry-forward + reviewed priority {len(priority)}"
        )

    ordered = list(priority)
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
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    desired_size = DYNAMIC_BACKFILL_POOL_SIZES[target]
    seeds = v12.base.fixtures(dataset, require_images=require_images)
    seed_ids = {str(item.get("row_id") or "") for item in seeds}
    carry_forward = _prior_stage_expansion_ids(
        dataset,
        require_images=require_images,
        target=target,
    )

    candidates: list[dict[str, Any]] = []
    for row in v12.base.load_rows(dataset):
        item = v12._ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is not None:
            candidates.append(item)
    candidates.sort(key=v12._ORIGINAL_EXPANSION_SORT_KEY)
    eligible_ids = [str(item.get("row_id") or "") for item in candidates]

    ordered = _ordered_dynamic_backfill_ids(
        carry_forward=carry_forward,
        eligible=eligible_ids,
        seed_ids=seed_ids,
        desired_size=desired_size,
    )
    if len(ordered) < desired_size:
        raise RuntimeError(
            f"Frozen {target} dynamic backfill could only assemble {len(ordered)} eligible rows; "
            f"required bounded pool size={desired_size}"
        )
    if ordered[: len(carry_forward)] != carry_forward:
        raise RuntimeError("Dynamic backfill changed the certified prior-stage expansion prefix")
    return ordered, carry_forward


async def build_staged_pinned_live_v17(
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

    row_ids, carry_forward = _dynamic_row_ids(
        dataset,
        require_images=require_images,
        target=target,
    )
    pool_size = len(row_ids)

    # Reuse v12's fail-closed builder. The only change is candidate ORDER and
    # bounded availability: exact prior-stage expansion rows are first, then
    # reviewed pins, then deterministic replacements. Every row is revalidated
    # live against Registry and physical-card evidence before it may be selected.
    v12.PINNED_EXPANSION_ROW_IDS = row_ids
    v12.PINNED_EXPANSION_BUDGETS[target] = pool_size
    v12.PREFLIGHT_REGISTRY_CALL_CEILINGS[target] = (
        pool_size * v12.MAX_REGISTRY_CALLS_PER_EXPANSION_ROW
    )
    v14.PINNED_BACKFILL_POOL_SIZES[target] = pool_size

    print(
        f"FROZEN {target} V17 CERTIFIED-PREFIX BACKFILL: "
        f"carry_forward_expansion={len(carry_forward)} reviewed_pins={len(REVIEWED_PINNED_ROW_IDS)} "
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
    # Install every v16/v15 physical, Registry, throttle, exhaustive-round and
    # zero-fallback contract first, then replace only staged candidate ordering.
    v16._install_contract()
    v12.build_staged_pinned_live = build_staged_pinned_live_v17
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


def _self_test_certified_prefix_order() -> None:
    seed_ids = tuple(f"seed-{index}" for index in range(5))
    prior_expansion = tuple(f"prior-{index}" for index in range(5))
    manifest = {
        "schema_version": v11.MANIFEST_SCHEMA,
        "complete": True,
        "stage_target": 10,
        "fixtures": [
            {
                "row_id": row_id,
                "player": f"Player {index}",
                "card_number": str(index),
                "registry_identity_id": f"00000000-0000-0000-0017-{index:012d}",
                "registry_fingerprint_sha256": f"{index + 1:064x}",
            }
            for index, row_id in enumerate(seed_ids + prior_expansion)
        ],
    }
    carried = _manifest_carry_forward_expansion_ids(
        manifest,
        seed_row_ids=seed_ids,
        target=15,
    )
    assert carried == prior_expansion

    eligible = ["seed-0", REVIEWED_PINNED_ROW_IDS[0], "extra-a", "extra-b", "extra-c"]
    ordered = _ordered_dynamic_backfill_ids(
        carry_forward=carried,
        eligible=eligible,
        seed_ids=set(seed_ids),
        desired_size=len(carried) + len(REVIEWED_PINNED_ROW_IDS) + 3,
    )
    assert ordered[: len(carried)] == carried
    assert all(row_id in ordered for row_id in REVIEWED_PINNED_ROW_IDS)
    assert ordered[-3:] == ("extra-a", "extra-b", "extra-c")
    assert len(set(ordered)) == len(ordered)

    swapped = dict(manifest)
    swapped["fixtures"] = list(manifest["fixtures"])
    swapped["fixtures"][0] = dict(swapped["fixtures"][0])
    swapped["fixtures"][0]["row_id"] = "wrong-seed"
    try:
        _manifest_carry_forward_expansion_ids(swapped, seed_row_ids=seed_ids, target=15)
        raise AssertionError("Changed Frozen Five seed prefix was accepted")
    except RuntimeError:
        pass

    print("PASS v17 reads the exact successful prior-stage expansion row IDs from the manifest")
    print("PASS v17 forces certified prior-stage expansion rows ahead of reviewed/backfill candidates")
    print("PASS v17 refuses a prior manifest whose Frozen Five row prefix changed")


def self_test() -> int:
    assert v16.self_test() == 0
    _install_contract()
    _self_test_certified_prefix_order()
    assert v12.build_staged_pinned_live is build_staged_pinned_live_v17
    assert v9._image_witness_conflict_hardened is v15._authoritative_prizm_back_mark_conflict
    assert v5._image_witness_conflict is v15._authoritative_prizm_back_mark_conflict
    print("PASS v17 preserves every v16/v15/v14/v13/v12/v11/v10/v9 fail-closed gate")
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
