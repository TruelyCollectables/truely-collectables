#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from typing import Any, Awaitable, Callable

import train_lora_from_unseen_benchmarks_v3 as v3
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import ChecklistOutcome

SCHEMA = "tcos.instacomp-ai.unseen-miss-curriculum.v4"


class HistoricalBenchmarkSuperseded(v3.CurriculumUnverifiable):
    """Historical benchmark truth no longer matches the canonically verified current Registry identity."""


def _historical_local_receipt_nonfatal(example: Any, wanted: dict[str, Any]) -> tuple[str, str | None]:
    """Local receipt drift is historical evidence only; live current Registry truth decides admission."""
    actual_registry = str(getattr(example, "registry_identity_id", None) or "").strip()
    actual_fingerprint = v3.legacy._valid_sha(getattr(example, "registry_fingerprint_sha256", None))
    return actual_registry, actual_fingerprint


def _current_receipt_from_diagnostics(diagnostics: dict[str, Any]) -> tuple[str, str | None]:
    return (
        str(diagnostics.get("registry_identity_id") or "").strip(),
        v3.legacy._valid_sha(diagnostics.get("registry_fingerprint_sha256")),
    )


def _assert_same_current_resolution(
    *,
    row_id: str,
    expected_current_registry: str,
    expected_current_fingerprint: str,
    diagnostics: dict[str, Any],
    source: str,
) -> None:
    actual_registry, actual_fingerprint = _current_receipt_from_diagnostics(diagnostics)
    if actual_registry and v3.legacy._norm(actual_registry) != v3.legacy._norm(expected_current_registry):
        raise RuntimeError(
            f"Refusing inconsistent current Registry resolution for {row_id}: {source} UUID "
            f"expected={expected_current_registry} actual={actual_registry}"
        )
    if actual_fingerprint and actual_fingerprint != expected_current_fingerprint:
        raise RuntimeError(
            f"Refusing inconsistent current Registry resolution for {row_id}: {source} fingerprint changed"
        )


async def _revalidate_one(
    *,
    row_id: str,
    wanted: dict[str, Any],
    example: Any,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    historical_registry = str(wanted["registry_identity_id"]).strip()
    historical_fingerprint = str(wanted["registry_fingerprint_sha256"]).strip().lower()
    request_identity = v3._expected_identity(wanted, example)
    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=v3.v2.LIVE_REVALIDATION_HTTP_TIMEOUT_SECONDS,
        max_attempts=2,
        retry_backoff_seconds=0.5,
    )

    async with semaphore:
        try:
            direct_result, direct_diagnostics = await v3.v2._canonical_revalidate(
                gateway,
                request_identity,
                expected_registry=historical_registry,
                expected_fingerprint=historical_fingerprint,
            )
        except TimeoutError:
            direct_result = type("Result", (), {"outcome": ChecklistOutcome.NOT_CONFIGURED, "identity": None})()
            direct_diagnostics = {
                "registry_receipt_revalidation_attempted": False,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": None,
                "registry_fingerprint_sha256": None,
                "registry_attempts": 0,
                "registry_transport_error": "curriculum_direct_revalidation_timeout",
            }

        if v3.v2._accepted_expected_receipt(
            direct_result,
            direct_diagnostics,
            expected_registry=historical_registry,
            expected_fingerprint=historical_fingerprint,
        ):
            return {
                "registry_identity_id": historical_registry,
                "registry_fingerprint_sha256": historical_fingerprint,
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_attempts": int(direct_diagnostics.get("registry_attempts") or 0),
                "revalidation_path": "canonical_direct",
                "canonical_identity": v3._canonical_identity_payload(direct_result, request_identity),
            }

        bootstrap, bootstrap_reason = await v3.v2._player_card_bootstrap(
            row_id=row_id,
            identity=request_identity,
        )
        if bootstrap is None:
            direct_status = str(getattr(direct_result.outcome, "value", direct_result.outcome))
            direct_registry, direct_fingerprint = _current_receipt_from_diagnostics(direct_diagnostics)
            if direct_registry and (
                v3.legacy._norm(direct_registry) != v3.legacy._norm(historical_registry)
                or (direct_fingerprint and direct_fingerprint != historical_fingerprint)
            ):
                raise HistoricalBenchmarkSuperseded(
                    f"historical benchmark Registry truth superseded but current identity could not be "
                    f"independently revalidated benchmark={historical_registry} current={direct_registry}"
                )
            raise v3.CurriculumUnverifiable(
                f"canonical receipt revalidation was not accepted (outcome={direct_status}); "
                f"indexed player-card recovery unavailable reason={bootstrap_reason}"
            )

        current_registry = str(bootstrap.registry_id).strip()
        current_fingerprint = str(bootstrap.fingerprint).strip().lower()

        # A direct exact current result and indexed current bootstrap must agree with each other.
        if direct_result.outcome == ChecklistOutcome.EXACT_MATCH:
            direct_registry, direct_fingerprint = _current_receipt_from_diagnostics(direct_diagnostics)
            if direct_registry:
                if v3.legacy._norm(direct_registry) != v3.legacy._norm(current_registry):
                    raise RuntimeError(
                        f"Refusing inconsistent current Registry resolution for {row_id}: canonical direct UUID "
                        f"current={direct_registry} indexed={current_registry}"
                    )
                if direct_fingerprint and direct_fingerprint != current_fingerprint:
                    raise RuntimeError(
                        f"Refusing inconsistent current Registry resolution for {row_id}: canonical direct fingerprint "
                        "does not match indexed current fingerprint"
                    )

        try:
            current_result, current_diagnostics = await v3.v2._canonical_revalidate(
                gateway,
                bootstrap.identity,
                expected_registry=current_registry,
                expected_fingerprint=current_fingerprint,
            )
        except TimeoutError as exc:
            raise v3.CurriculumUnverifiable(
                "canonical current Registry receipt revalidation timed out after indexed player-card recovery"
            ) from exc

        if not v3.v2._accepted_expected_receipt(
            current_result,
            current_diagnostics,
            expected_registry=current_registry,
            expected_fingerprint=current_fingerprint,
        ):
            _assert_same_current_resolution(
                row_id=row_id,
                expected_current_registry=current_registry,
                expected_current_fingerprint=current_fingerprint,
                diagnostics=current_diagnostics,
                source="indexed-then-canonical",
            )
            current_status = str(getattr(current_result.outcome, "value", current_result.outcome))
            raise v3.CurriculumUnverifiable(
                f"indexed player-card current identity could not pass canonical current receipt revalidation "
                f"(outcome={current_status})"
            )

        canonical_identity = v3._canonical_identity_payload(current_result, bootstrap.identity)
        if (
            v3.legacy._norm(current_registry) != v3.legacy._norm(historical_registry)
            or current_fingerprint != historical_fingerprint
        ):
            raise HistoricalBenchmarkSuperseded(
                f"historical benchmark Registry truth superseded by canonically verified current identity "
                f"benchmark={historical_registry} current={current_registry}"
            )

        return {
            "registry_identity_id": current_registry,
            "registry_fingerprint_sha256": current_fingerprint,
            "registry_receipt_revalidation_attempted": True,
            "registry_receipt_revalidation_accepted": True,
            "registry_attempts": int(current_diagnostics.get("registry_attempts") or 0),
            "revalidation_path": "indexed_player_card_then_canonical_current",
            "bootstrap_reason": bootstrap_reason,
            "canonical_identity": canonical_identity,
        }


async def _revalidate_all(
    pending: list[tuple[str, dict[str, Any], Any, str]],
    *,
    revalidate_fn: Callable[..., Awaitable[dict[str, Any]]] | None = None,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    semaphore = asyncio.Semaphore(v3.v2.LIVE_REVALIDATION_CONCURRENCY)
    fn = revalidate_fn or _revalidate_one
    completed = accepted = quarantined = 0
    total = len(pending)
    progress_lock = asyncio.Lock()

    async def run_one(row_id: str, wanted: dict[str, Any], example: Any, resolution: str):
        nonlocal completed, accepted, quarantined
        detail = quarantine = None
        try:
            detail = await fn(row_id=row_id, wanted=wanted, example=example, semaphore=semaphore)
            detail["resolution"] = resolution
        except v3.CurriculumUnverifiable as exc:
            status = (
                "quarantined_superseded_historical_benchmark_truth"
                if isinstance(exc, HistoricalBenchmarkSuperseded)
                else "quarantined_unverifiable_current_registry_truth"
            )
            quarantine = {
                "benchmark_row_id": row_id,
                "training_example_id": str(example.training_example_id),
                "resolution": resolution,
                "registry_identity_id": wanted["registry_identity_id"],
                "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
                "source_benchmark": wanted["source_benchmark"],
                "reason": str(exc),
                "status": status,
            }
        async with progress_lock:
            completed += 1
            if detail is not None:
                accepted += 1
            else:
                quarantined += 1
            if completed == 1 or completed % 10 == 0 or completed == total:
                print(
                    f"CURRICULUM REGISTRY REVALIDATION: {completed}/{total} accepted={accepted} "
                    f"quarantined={quarantined} concurrency={v3.v2.LIVE_REVALIDATION_CONCURRENCY}",
                    flush=True,
                )
        return row_id, detail, quarantine

    rows = await asyncio.gather(
        *(run_one(row_id, wanted, example, resolution) for row_id, wanted, example, resolution in pending)
    )
    accepted_rows: dict[str, dict[str, Any]] = {}
    quarantines: list[dict[str, Any]] = []
    for row_id, detail, quarantine in rows:
        if detail is not None:
            accepted_rows[row_id] = detail
        if quarantine is not None:
            quarantines.append(quarantine)
    return accepted_rows, quarantines


def _self_test() -> int:
    assert v3._self_test() == 0

    historical_registry = "b00121db-a36d-4350-aed5-8f6fd5b5b1cf"
    historical_fingerprint = "b72cf17187db8f9c006c3274405d2daf5363c226e9f4253db6a52b69bb923e2d"
    current_registry = "a82860a8-1e28-4599-81ec-5af50e1fac4d"
    current_fingerprint = "c13fc274630371b64e06dbe0a06d2df7023af0f64b39ed83d2214602c674784d"

    assert _historical_local_receipt_nonfatal(
        type("E", (), {"registry_identity_id": current_registry, "registry_fingerprint_sha256": current_fingerprint})(),
        {"registry_identity_id": historical_registry, "registry_fingerprint_sha256": historical_fingerprint},
    ) == (current_registry, current_fingerprint)

    async def fake_superseded(**_kwargs: Any):
        raise HistoricalBenchmarkSuperseded(
            f"historical benchmark Registry truth superseded by canonically verified current identity "
            f"benchmark={historical_registry} current={current_registry}"
        )

    pending = [
        (
            "232c2cdf-61bf-45a9-93a9-f2586b26c508",
            {
                "registry_identity_id": historical_registry,
                "registry_fingerprint_sha256": historical_fingerprint,
                "source_benchmark": "/tmp/unseen-holdout-20260820T025713Z.json",
            },
            type("E", (), {"training_example_id": "232c2cdf-61bf-45a9-93a9-f2586b26c508"})(),
            "same_training_example",
        )
    ]
    accepted, quarantines = asyncio.run(_revalidate_all(pending, revalidate_fn=fake_superseded))
    assert accepted == {}
    assert len(quarantines) == 1
    assert quarantines[0]["status"] == "quarantined_superseded_historical_benchmark_truth"
    assert historical_registry in quarantines[0]["reason"]
    assert current_registry in quarantines[0]["reason"]

    try:
        _assert_same_current_resolution(
            row_id="current-conflict",
            expected_current_registry=current_registry,
            expected_current_fingerprint=current_fingerprint,
            diagnostics={
                "registry_identity_id": "00000000-0000-4000-8000-000000000099",
                "registry_fingerprint_sha256": current_fingerprint,
            },
            source="test",
        )
    except RuntimeError as exc:
        assert "inconsistent current Registry resolution" in str(exc)
    else:
        raise AssertionError("Contradiction inside one current Registry resolution must remain fatal")

    print("PASS curriculum V4 quarantines the exact Pius Suter superseded benchmark UUID pair")
    print("PASS curriculum V4 lets live current Registry truth supersede stale local benchmark receipts")
    print("PASS curriculum V4 keeps contradictions inside one current Registry resolution fatal")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    v3.v2._local_receipt_without_contradiction = _historical_local_receipt_nonfatal
    v3._revalidate_one = _revalidate_one
    v3._revalidate_all = _revalidate_all
    v3.SCHEMA = SCHEMA
    return int(v3.main())


if __name__ == "__main__":
    raise SystemExit(main())
