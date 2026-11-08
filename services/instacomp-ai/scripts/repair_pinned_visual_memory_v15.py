#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from typing import Any

import repair_pinned_visual_memory as base

_ADVISORY_REASONS = {"trusted_style_memory_not_retrievable"}


def _blocking_style_memory(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in items if str(item.get("reason") or "") not in _ADVISORY_REASONS]


def _has_fatal_blocker(result: dict[str, Any]) -> bool:
    return bool(
        result["failures"]
        or result["missing_or_untrusted"]
        or result["active_truth_conflicts"]
        or _blocking_style_memory(result["unusable_style_memory"])
    )


def _self_test() -> int:
    assert base._self_test() == 0

    advisory_only = {
        "failures": [],
        "missing_or_untrusted": [],
        "active_truth_conflicts": [],
        "unusable_style_memory": [
            {
                "reason": "trusted_style_memory_not_retrievable",
                "expected_parallel": "Silver Prizm",
                "recovered_parallel": "",
            }
        ],
    }
    assert _has_fatal_blocker(advisory_only) is False

    hard_missing_visual = {
        **advisory_only,
        "unusable_style_memory": [{"reason": "pinned_fixture_visual_memory_missing"}],
    }
    assert _has_fatal_blocker(hard_missing_visual) is True

    hard_truth_conflict = {
        **advisory_only,
        "active_truth_conflicts": [{"reason": "parallel_conflict"}],
    }
    assert _has_fatal_blocker(hard_truth_conflict) is True

    print("PASS v15 treats only non-retrievable style labels as preflight advisories")
    print("PASS v15 still fails closed on missing visual evidence and active truth conflicts")
    print("PASS v15 defers Base/non-Base and variant adjudication to physical/Registry preflight")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    stage_target = base._stage_target(sys.argv[1:])
    workers = min(6, max(1, os.cpu_count() or 1))
    base.settings.ensure_directories()
    database_path = base.settings.resolve_local_path(base.settings.database_path)
    image_store_path = base.settings.resolve_local_path(base.settings.image_store_path)

    result = base._hydrate_ids(
        database_path=database_path,
        image_store_path=image_store_path,
        wanted_ids=base._wanted_ids(stage_target),
        workers=workers,
    )
    result["promotion_stage_target"] = stage_target
    result["style_memory_advisory_count"] = len(
        [
            item
            for item in result["unusable_style_memory"]
            if str(item.get("reason") or "") in _ADVISORY_REASONS
        ]
    )
    result["blocking_style_memory_count"] = len(
        _blocking_style_memory(result["unusable_style_memory"])
    )
    print(json.dumps(result, indent=2), flush=True)

    if _has_fatal_blocker(result):
        return 3

    if result["style_memory_advisory_count"]:
        print(
            "INFO pinned style-memory labels were not retrievable for "
            f"{result['style_memory_advisory_count']} fixture(s); "
            "v15 physical/Registry preflight will reject or backfill them before activation",
            flush=True,
        )

    print(
        "PASS pinned trusted visual memory ready for v15 preflight: "
        f"stage={stage_target} repaired={result['repaired']} "
        f"already_hydrated={result['already_hydrated']} "
        f"superseded={len(result['superseded_pinned_training_examples'])} "
        f"style_advisories={result['style_memory_advisory_count']} "
        "blocking_style_memory=0 missing_or_untrusted=0",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
