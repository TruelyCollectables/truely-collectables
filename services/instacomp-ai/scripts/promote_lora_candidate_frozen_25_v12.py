#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v10 as v10
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_five as base

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v12"

# These exact expansion rows came from a prior live Registry-authoritative
# Frozen 25 preflight that reached PREFLIGHT COMPLETE. They are deliberately
# ordered from simpler/ordinary fixtures into the trickier expansion fixtures.
# Every v12 run STILL revalidates each selected row against live Registry;
# these IDs only remove the wasteful discovery crawl.
PINNED_EXPANSION_ROW_IDS = (
    "47c1d7b9-41c8-4dc1-96dc-86cdfbc74232",  # Aari McDonald #10
    "f4c768d3-b89e-4b9e-9b46-58c64a6ac630",  # Ajsa Sivka #85
    "85fd8ef9-e3c8-442b-8f08-048b957d1fd9",  # Alyssa Thomas #57
    "ca58b44a-009a-4633-8166-5d34994d1aa7",  # Aneesah Morrow #79
    "bc11ae94-7a00-4a15-9f63-f58640f48ae7",  # Arike Ogunbowale #189
    "f7f410f6-51d8-4cf3-88ea-59a08e6b5d0e",  # Brianna Turner #105
    "7f259a08-26c6-4b2a-bef7-5a141cb7d84a",  # Brittney Griner #46
    "19110d26-8d83-46b2-9871-1fccfe2ab45f",  # Caitlin Clark #41
    "d6bcd174-3f84-49b8-8538-4d1f57263274",  # DeWanna Bonner #32
    "8b6ccd94-4e5a-4b70-9d48-ae6a52831c06",  # Diamond Miller #15
    "cdfac993-e68e-464c-9a98-01e3447a4593",  # A'ja Wilson #76
    "c6427e26-229f-402c-b0fc-90606a3d4b98",  # Dominique Malonga #8
    "413ce530-f91f-4246-8761-3fafaf032fec",  # Jade Melbourne #128
    "b99cb90b-5e99-4fbd-a5cb-946a9088426b",  # Kayla McBride #45
    "525a4bc2-373a-4b41-8dc3-80e7256ecc82",  # Sonia Citron #122 alternate row
    "1f42c52c-920c-4cd2-8717-4674d1f441df",  # Dominique Malonga #116 alternate row
    "6fd16c03-f390-4a0f-8424-b2008ed4fbe3",  # Dorka Juhasz #109
    "4babde8f-cb56-446d-ac6f-63b3cf752baf",  # Gabby Williams #77
    "987e7e98-0e95-4153-a2d5-4b4ce575d7a3",  # Hailey Van Lith #139
    "84bd63fc-70c6-4657-9d33-b62a492a4674",  # Haley Jones #110
)

# Number of NEW expansion rows touched in preflight. v10 can make at most
# three Registry calls for a row (normalized, core, OCR-assisted), so Frozen 10
# has a hard preflight call ceiling of 15 instead of hundreds/thousands.
PINNED_EXPANSION_BUDGETS = {10: 5, 15: 10, 25: 20}
MAX_REGISTRY_CALLS_PER_EXPANSION_ROW = 3
PREFLIGHT_REGISTRY_CALL_CEILINGS = {
    target: count * MAX_REGISTRY_CALLS_PER_EXPANSION_ROW
    for target, count in PINNED_EXPANSION_BUDGETS.items()
}

_ORIGINAL_EXPANSION_CANDIDATE = v11._ORIGINAL_EXPANSION_CANDIDATE
_ORIGINAL_EXPANSION_SORT_KEY = v3._expansion_sort_key
RegistryMatch = Callable[[Any, str | None], Awaitable[Any]]


class RegistryThrottleError(RuntimeError):
    """Live Registry refused work because its request throttle is active."""


def _registry_reasons(result: Any) -> list[str]:
    values = getattr(result, "reasons", None) or []
    return [str(value).strip() for value in values if str(value).strip()]


def _registry_throttle_reason(result: Any) -> str | None:
    for reason in _registry_reasons(result):
        lowered = reason.casefold()
        if any(
            marker in lowered
            for marker in (
                "too many attempts",
                "try again in",
                "rate limit",
                "rate_limit",
                "ratelimit",
                "throttl",
                "http 429",
                "status 429",
            )
        ):
            return reason
    return None


def _throttle_guarded_registry_match(registry_match: RegistryMatch) -> RegistryMatch:
    async def guarded(identity: Any, ocr: str | None):
        result = await registry_match(identity, ocr)
        reason = _registry_throttle_reason(result)
        if reason:
            raise RegistryThrottleError(
                "Registry throttle is active; promotion stopped before treating throttling "
                f"as an identity miss. Registry said: {reason}"
            )
        return result

    return guarded


def _wanted_pinned_row_ids(target: int) -> tuple[str, ...]:
    if target not in PINNED_EXPANSION_BUDGETS:
        raise RuntimeError(
            f"Unsupported pinned promotion stage {target}; "
            f"allowed={tuple(PINNED_EXPANSION_BUDGETS)}"
        )
    count = PINNED_EXPANSION_BUDGETS[target]
    return PINNED_EXPANSION_ROW_IDS[:count]


def _validate_pinned_rows(
    dataset: Path,
    *,
    require_images: bool,
    target: int,
) -> tuple[set[str], int]:
    wanted = _wanted_pinned_row_ids(target)
    wanted_set = set(wanted)
    found: dict[str, dict[str, Any]] = {}
    eligible_count = 0

    for row in base.load_rows(dataset):
        item = _ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is None:
            continue
        eligible_count += 1
        row_id = str(item.get("row_id") or "")
        if row_id in wanted_set:
            found[row_id] = item

    missing = [row_id for row_id in wanted if row_id not in found]
    if missing:
        raise RuntimeError(
            f"Pinned {_stage_label(target)} fixture rows are missing/ineligible: {missing}"
        )
    return wanted_set, eligible_count


def _stage_label(target: int) -> str:
    return f"Frozen {target}"


async def build_staged_pinned_live(
    dataset: Path,
    *,
    require_images: bool = True,
    registry_match: RegistryMatch | None = None,
) -> list[dict[str, Any]]:
    target = int(v3.TARGET)
    wanted = _wanted_pinned_row_ids(target)
    allowed_rows, eligible_count = _validate_pinned_rows(
        dataset,
        require_images=require_images,
        target=target,
    )
    order = {row_id: index for index, row_id in enumerate(wanted)}

    print(
        f"{_stage_label(target).upper()} PINNED PREFLIGHT: "
        f"eligible_rows={eligible_count} expansion_rows={len(wanted)} "
        f"preflight_registry_call_ceiling={PREFLIGHT_REGISTRY_CALL_CEILINGS[target]}",
        flush=True,
    )

    def pinned_expansion(row: dict[str, Any], *, require_images: bool):
        item = _ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is None:
            return None
        row_id = str(item.get("row_id") or "")
        return item if row_id in allowed_rows else None

    def pinned_sort_key(item: dict[str, Any]):
        row_id = str(item.get("row_id") or "")
        return (order.get(row_id, len(order) + 1), row_id)

    if registry_match is None:
        from app.checklist import checklist_gateway

        registry_match = checklist_gateway.match
    guarded_registry_match = _throttle_guarded_registry_match(registry_match)

    previous_candidate = v3._expansion_candidate
    previous_sort_key = v3._expansion_sort_key
    v3._expansion_candidate = pinned_expansion
    v3._expansion_sort_key = pinned_sort_key
    try:
        fixtures = await v10.build_frozen_25_live_v10(
            dataset,
            require_images=require_images,
            registry_match=guarded_registry_match,
        )
    finally:
        v3._expansion_candidate = previous_candidate
        v3._expansion_sort_key = previous_sort_key

    if len(fixtures) != target:
        raise RuntimeError(
            f"{_stage_label(target)} pinned preflight produced {len(fixtures)} fixtures; "
            f"expected {target}"
        )
    return fixtures


def _install_contract(target: int) -> None:
    # Install every v11/v10/v9 safety contract first, then replace ONLY staged
    # expansion discovery with the pinned + throttle-aware preflight.
    v11._install_stage_contract(target)
    v11.SCHEMA = SCHEMA
    v11.REGISTRY_ATTEMPT_BUDGETS = dict(PINNED_EXPANSION_BUDGETS)
    v11.build_staged_live = build_staged_pinned_live
    v3.SCHEMA = SCHEMA
    v3.build_frozen_25_live = build_staged_pinned_live


def _self_test_throttle_guard() -> None:
    calls = 0

    async def throttled(_identity: Any, _ocr: str | None):
        nonlocal calls
        calls += 1
        return SimpleNamespace(
            reasons=["Too many attempts. Try again in 21 minutes."],
            outcome="set_present_no_exact_match",
        )

    guarded = _throttle_guarded_registry_match(throttled)
    try:
        asyncio.run(guarded(SimpleNamespace(), None))
        raise AssertionError("Registry throttle was treated as a normal identity miss")
    except RegistryThrottleError as exc:
        assert "Try again in 21 minutes" in str(exc)
    assert calls == 1

    async def ordinary(_identity: Any, _ocr: str | None):
        return SimpleNamespace(reasons=["no exact checklist row"], outcome="set_present_no_exact_match")

    result = asyncio.run(_throttle_guarded_registry_match(ordinary)(SimpleNamespace(), None))
    assert result.outcome == "set_present_no_exact_match"

    print("PASS v12 Registry throttle aborts on the first throttled response")
    print("PASS v12 ordinary Registry misses remain eligible for v10 retry logic")


def _self_test_pinned_contract() -> None:
    assert len(PINNED_EXPANSION_ROW_IDS) == 20
    assert len(set(PINNED_EXPANSION_ROW_IDS)) == 20
    assert PINNED_EXPANSION_BUDGETS == {10: 5, 15: 10, 25: 20}
    assert PREFLIGHT_REGISTRY_CALL_CEILINGS == {10: 15, 15: 30, 25: 60}
    assert _wanted_pinned_row_ids(10) == PINNED_EXPANSION_ROW_IDS[:5]
    assert _wanted_pinned_row_ids(15)[:5] == _wanted_pinned_row_ids(10)
    assert _wanted_pinned_row_ids(25)[:10] == _wanted_pinned_row_ids(15)

    print("PASS v12 Frozen 10 touches exactly five pinned expansion rows")
    print("PASS v12 Frozen 15 and 25 preserve the exact pinned expansion prefix")
    print("PASS v12 Frozen 10 preflight Registry call ceiling is 15")


def self_test() -> int:
    assert v11.self_test() == 0
    _self_test_throttle_guard()
    _self_test_pinned_contract()
    print("PASS v12 preserves every staged v11/v10/v9 fail-closed promotion gate")
    return 0


def _requested_target(argv: list[str]) -> int:
    target = v11.DEFAULT_STAGE_TARGET
    for index, arg in enumerate(argv):
        if arg == "--stage-target" and index + 1 < len(argv):
            target = int(argv[index + 1])
        elif arg.startswith("--stage-target="):
            target = int(arg.split("=", 1)[1])
    if target not in PINNED_EXPANSION_BUDGETS:
        raise SystemExit(
            f"Unsupported stage target {target}; allowed={tuple(PINNED_EXPANSION_BUDGETS)}"
        )
    return target


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    target = _requested_target(sys.argv[1:])
    _install_contract(target)
    return v11.main()


if __name__ == "__main__":
    raise SystemExit(main())
