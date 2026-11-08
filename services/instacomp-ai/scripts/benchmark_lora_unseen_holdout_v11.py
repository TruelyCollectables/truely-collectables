#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from typing import Any, Awaitable, Callable

import benchmark_lora_unseen_holdout_v10 as v10

v9 = v10.v9
v5 = v9.v5
canonical = v5.canonical
legacy = canonical.legacy
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v11"
_ORIGINAL_RUN_CANDIDATE_BENCHMARK = legacy._run_candidate_benchmark


async def _run_candidate_benchmark(
    holdout: list[dict[str, Any]],
    *,
    adapter_sha: str,
    gateway: Any,
    source_fn: Callable[..., Awaitable[tuple[list[dict[str, Any]], dict[str, Any]]]] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Persist the exact teacher identity that survived current Registry + physical admission.

    This changes only receipt provenance. Scoring, Registry authority, physical gates,
    image uniqueness, and candidate behavior remain owned by the existing V10/V9/V8/V20 path.
    """
    fn = source_fn or _ORIGINAL_RUN_CANDIDATE_BENCHMARK
    results, summary = await fn(holdout, adapter_sha=adapter_sha, gateway=gateway)
    if len(results) != len(holdout):
        raise RuntimeError(
            f"V11 receipt provenance mismatch: results={len(results)} holdout={len(holdout)}"
        )

    for result, item in zip(results, holdout, strict=True):
        expected = item.get("trusted_identity")
        if not isinstance(expected, dict) or not expected:
            expected = item.get("identity") if isinstance(item.get("identity"), dict) else None
        if not isinstance(expected, dict) or not expected:
            raise RuntimeError(
                f"V11 cannot persist exam-admitted identity for row {result.get('row_id')!r}"
            )
        result["expected_identity"] = dict(expected)
        pair_sha = str(item.get("benchmark_image_pair_sha256") or "").strip().lower()
        if pair_sha:
            result["expected_image_pair_sha256"] = pair_sha
        result["expected_identity_provenance"] = (
            "same_identity_that_passed_current_registry_uuid_fingerprint_and_v20_physical_admission"
        )
    return results, summary


def _install_runtime() -> None:
    v10._install_runtime()
    legacy._run_candidate_benchmark = _run_candidate_benchmark
    legacy.SCHEMA = SCHEMA
    canonical.SCHEMA = SCHEMA
    v5.SCHEMA = SCHEMA
    v5.v4.SCHEMA = SCHEMA
    v9.SCHEMA = SCHEMA


def _self_test() -> int:
    assert v10._self_test() == 0

    holdout = [
        {
            "row_id": "row-1",
            "identity": {"player": "Old Player", "card_number": "1"},
            "trusted_identity": {
                "sport": "Basketball",
                "year": "2025",
                "brand": "Prizm",
                "set_name": "Base",
                "player": "Truth Player",
                "card_number": "77",
                "parallel": "Base",
            },
            "benchmark_image_pair_sha256": "a" * 64,
        }
    ]

    async def fake_source(
        _holdout: list[dict[str, Any]], *, adapter_sha: str, gateway: Any
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        assert adapter_sha == "sha"
        assert gateway == "gateway"
        return ([{"row_id": "row-1", "authoritative_exact": False}], {"total": 1})

    results, summary = asyncio.run(
        _run_candidate_benchmark(
            holdout,
            adapter_sha="sha",
            gateway="gateway",
            source_fn=fake_source,
        )
    )
    assert summary["total"] == 1
    assert results[0]["expected_identity"]["player"] == "Truth Player"
    assert results[0]["expected_image_pair_sha256"] == "a" * 64
    assert "registry_uuid_fingerprint" in results[0]["expected_identity_provenance"]

    print("PASS unseen V11 persists the exact exam-admitted identity for later curriculum revalidation")
    print("PASS unseen V11 changes receipt provenance only and preserves every V10/V9/V8/V20 gate")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()
    if "--preflight-only" in sys.argv[1:]:
        return 0 if v10._live_registry_preflight() else 4
    if not v10._live_registry_preflight():
        return 4
    _install_runtime()
    return int(v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
