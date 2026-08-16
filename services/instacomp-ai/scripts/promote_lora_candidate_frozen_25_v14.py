#!/usr/bin/env python3
from __future__ import annotations

import sys

import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v13 as v13

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v14"

# A stage needs target-5 NEW expansion fixtures because the trusted Frozen Five
# are always carried in first. v12 previously exposed exactly that many pinned
# rows, which meant one legitimate safety rejection made the whole stage
# impossible. Keep the same deterministic priority prefix but expose a small
# bounded replacement pool so v3 can skip a rejected pin and keep selecting.
#
# This is NOT request throttling. The Registry client runs at full speed; these
# values only bound which already-vetted pinned training rows may be considered
# for a staged certification rung.
PINNED_BACKFILL_POOL_SIZES = {10: 8, 15: 15, 25: 20}
REQUIRED_NEW_FIXTURES = {10: 5, 15: 10, 25: 20}
MAX_REGISTRY_CALLS_PER_EXPANSION_ROW = v12.MAX_REGISTRY_CALLS_PER_EXPANSION_ROW


def _install_backfill_pool() -> None:
    v12.PINNED_EXPANSION_BUDGETS = dict(PINNED_BACKFILL_POOL_SIZES)
    v12.PREFLIGHT_REGISTRY_CALL_CEILINGS = {
        target: pool_size * MAX_REGISTRY_CALLS_PER_EXPANSION_ROW
        for target, pool_size in PINNED_BACKFILL_POOL_SIZES.items()
    }


def _install_contract() -> None:
    _install_backfill_pool()
    # Preserve v13's same-request throttle handling and every inherited
    # Registry/identity/image/serial/card-number safety gate.
    v13._install_contract()
    # Stamp the resulting staged receipts with the incident-specific runner.
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


def self_test() -> int:
    # First prove v13 exactly as it existed before this incident fix.
    assert v13.self_test() == 0

    original_budgets = dict(v12.PINNED_EXPANSION_BUDGETS)
    original_ceilings = dict(v12.PREFLIGHT_REGISTRY_CALL_CEILINGS)
    try:
        _install_backfill_pool()
        assert PINNED_BACKFILL_POOL_SIZES[10] > REQUIRED_NEW_FIXTURES[10]
        assert PINNED_BACKFILL_POOL_SIZES[15] > REQUIRED_NEW_FIXTURES[15]
        assert PINNED_BACKFILL_POOL_SIZES[25] >= REQUIRED_NEW_FIXTURES[25]

        frozen10 = v12._wanted_pinned_row_ids(10)
        frozen15 = v12._wanted_pinned_row_ids(15)
        frozen25 = v12._wanted_pinned_row_ids(25)

        assert len(frozen10) == 8
        assert len(frozen15) == 15
        assert len(frozen25) == 20
        # The original priority order is untouched. The only change is that
        # later pins are now available as replacements after a safety reject.
        assert frozen10[:5] == v12.PINNED_EXPANSION_ROW_IDS[:5]
        assert frozen10[5:] == v12.PINNED_EXPANSION_ROW_IDS[5:8]
        assert frozen15[:8] == frozen10
        assert frozen25[:15] == frozen15
        assert v12.PREFLIGHT_REGISTRY_CALL_CEILINGS == {10: 24, 15: 45, 25: 60}
    finally:
        v12.PINNED_EXPANSION_BUDGETS = original_budgets
        v12.PREFLIGHT_REGISTRY_CALL_CEILINGS = original_ceilings

    print("PASS v14 Frozen 10 preserves the original five pinned priorities")
    print("PASS v14 Frozen 10 exposes three deterministic replacement pins after a safety reject")
    print("PASS v14 Frozen 15/25 preserve the exact nested pinned priority prefix")
    print("PASS v14 changes fixture availability only; v13 throttle and all fail-closed gates remain inherited")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    _install_contract()
    try:
        return v12.main()
    except v13.RegistryThrottleAbort as error:
        print(f"REGISTRY THROTTLE ABORT: {error}", file=sys.stderr, flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
