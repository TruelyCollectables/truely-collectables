#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace
from typing import Any

import httpx
import benchmark_lora_unseen_holdout_v8 as unseen_v8
import train_lora_from_unseen_benchmarks as legacy
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import ChecklistOutcome

SCHEMA = "tcos.instacomp-ai.unseen-miss-curriculum.v2"
LIVE_REVALIDATION_CONCURRENCY = 6
LIVE_REVALIDATION_HTTP_TIMEOUT_SECONDS = 10.0
LIVE_REVALIDATION_ITEM_TIMEOUT_SECONDS = 25.0
PLAYER_CARD_BOOTSTRAP_HTTP_TIMEOUT_SECONDS = 10.0
PLAYER_CARD_BOOTSTRAP_ITEM_TIMEOUT_SECONDS = 14.0

# V8 intentionally points the shared V6 fast-bootstrap helper at the indexed
# player+card holdout route only when its runtime is installed. Curriculum V2
# uses that same helper for one bounded recovery path without installing or
# mutating the benchmark runtime itself.
unseen_v8.v7.v6.FAST_ROUTE = unseen_v8.SCOPED_FAST_ROUTE


def _local_receipt_without_contradiction(
    example: Any,
    wanted: dict[str, str],
) -> tuple[str, str | None]:
    """Reject persisted contradictions, but allow missing receipts to be revalidated live.

    V8 unseen exams intentionally keep recovered Registry receipts read-only and ephemeral,
    so a trusted local training example may legitimately have no persisted Registry receipt
    even though the completed benchmark has a current UUID/fingerprint. A non-empty local
    receipt that contradicts the benchmark is still a hard failure.
    """
    actual_registry = str(example.registry_identity_id or "").strip()
    actual_fingerprint = legacy._valid_sha(example.registry_fingerprint_sha256)
    expected_registry = str(wanted["registry_identity_id"]).strip()
    expected_fingerprint = wanted["registry_fingerprint_sha256"]

    if actual_registry and legacy._norm(actual_registry) != legacy._norm(expected_registry):
        raise RuntimeError(
            f"Refusing stale curriculum truth for {wanted['row_id']}: Registry UUID changed "
            f"benchmark={expected_registry} current={actual_registry}"
        )
    if actual_fingerprint and actual_fingerprint != expected_fingerprint:
        raise RuntimeError(
            f"Refusing stale curriculum truth for {wanted['row_id']}: Registry fingerprint changed"
        )
    return actual_registry, actual_fingerprint


def _accepted_expected_receipt(
    result: Any,
    diagnostics: dict[str, Any],
    *,
    expected_registry: str,
    expected_fingerprint: str,
) -> bool:
    actual_registry = str(diagnostics.get("registry_identity_id") or "").strip()
    actual_fingerprint = legacy._valid_sha(diagnostics.get("registry_fingerprint_sha256"))
    return bool(
        result.outcome == ChecklistOutcome.EXACT_MATCH
        and diagnostics.get("registry_receipt_revalidation_attempted") is True
        and diagnostics.get("registry_receipt_revalidation_accepted") is True
        and legacy._norm(actual_registry) == legacy._norm(expected_registry)
        and actual_fingerprint == expected_fingerprint
    )


async def _canonical_revalidate(
    gateway: AuthoritativeRegistryChecklistGateway,
    identity: Any,
    *,
    expected_registry: str,
    expected_fingerprint: str,
) -> tuple[Any, dict[str, Any]]:
    return await asyncio.wait_for(
        gateway.match_with_diagnostics(
            identity,
            registry_identity_id=expected_registry,
            registry_fingerprint_sha256=expected_fingerprint,
        ),
        timeout=LIVE_REVALIDATION_ITEM_TIMEOUT_SECONDS,
    )


async def _player_card_bootstrap(
    *,
    row_id: str,
    identity: Any,
) -> tuple[Any | None, str]:
    timeout = httpx.Timeout(PLAYER_CARD_BOOTSTRAP_HTTP_TIMEOUT_SECONDS)
    limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)
    item = {
        "row_id": row_id,
        "identity": unseen_v8.canonical.legacy.v20.v19._identity_payload(identity),
    }
    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        try:
            return await asyncio.wait_for(
                unseen_v8.v7.v6._fast_bootstrap_one(client, item, identity),
                timeout=PLAYER_CARD_BOOTSTRAP_ITEM_TIMEOUT_SECONDS,
            )
        except TimeoutError:
            return None, "bootstrap_item_timeout"


async def _revalidate_one(
    *,
    row_id: str,
    wanted: dict[str, str],
    example: Any,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    expected_registry = str(wanted["registry_identity_id"]).strip()
    expected_fingerprint = wanted["registry_fingerprint_sha256"]
    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=LIVE_REVALIDATION_HTTP_TIMEOUT_SECONDS,
        max_attempts=2,
        retry_backoff_seconds=0.5,
    )

    async with semaphore:
        try:
            direct_result, direct_diagnostics = await _canonical_revalidate(
                gateway,
                example.confirmed_identity,
                expected_registry=expected_registry,
                expected_fingerprint=expected_fingerprint,
            )
        except TimeoutError:
            direct_result = SimpleNamespace(outcome=ChecklistOutcome.NOT_CONFIGURED)
            direct_diagnostics = {
                "registry_receipt_revalidation_attempted": False,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": None,
                "registry_fingerprint_sha256": None,
                "registry_attempts": 0,
                "registry_transport_error": "curriculum_direct_revalidation_timeout",
            }

        if _accepted_expected_receipt(
            direct_result,
            direct_diagnostics,
            expected_registry=expected_registry,
            expected_fingerprint=expected_fingerprint,
        ):
            return {
                "registry_identity_id": str(direct_diagnostics.get("registry_identity_id") or "").strip(),
                "registry_fingerprint_sha256": legacy._valid_sha(
                    direct_diagnostics.get("registry_fingerprint_sha256")
                ),
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_attempts": int(direct_diagnostics.get("registry_attempts") or 0),
                "revalidation_path": "canonical_direct",
            }

        # Direct receipt revalidation can fail only because the trusted local row
        # still carries stale/incomplete release coordinates that V8 repaired during
        # the exam. Recover one current player+card identity exactly as V8 does, but
        # never accept that bootstrap by itself.
        bootstrap, bootstrap_reason = await _player_card_bootstrap(
            row_id=row_id,
            identity=example.confirmed_identity,
        )
        if bootstrap is None:
            direct_status = str(getattr(direct_result.outcome, "value", direct_result.outcome))
            raise RuntimeError(
                f"Refusing unverifiable curriculum truth for {row_id}: canonical receipt revalidation "
                f"was not accepted (outcome={direct_status}) and indexed player-card recovery failed "
                f"reason={bootstrap_reason}"
            )

        if legacy._norm(bootstrap.registry_id) != legacy._norm(expected_registry):
            raise RuntimeError(
                f"Refusing stale curriculum truth for {row_id}: Registry UUID changed "
                f"benchmark={expected_registry} current={bootstrap.registry_id}"
            )
        if bootstrap.fingerprint != expected_fingerprint:
            raise RuntimeError(
                f"Refusing stale curriculum truth for {row_id}: Registry fingerprint changed"
            )

        try:
            retry_result, retry_diagnostics = await _canonical_revalidate(
                gateway,
                bootstrap.identity,
                expected_registry=expected_registry,
                expected_fingerprint=expected_fingerprint,
            )
        except TimeoutError as exc:
            raise RuntimeError(
                f"Refusing unverifiable curriculum truth for {row_id}: canonical Registry receipt "
                "revalidation timed out after indexed player-card recovery"
            ) from exc

        if not _accepted_expected_receipt(
            retry_result,
            retry_diagnostics,
            expected_registry=expected_registry,
            expected_fingerprint=expected_fingerprint,
        ):
            retry_status = str(getattr(retry_result.outcome, "value", retry_result.outcome))
            raise RuntimeError(
                f"Refusing unverifiable curriculum truth for {row_id}: indexed player-card recovery "
                f"found the benchmark Registry identity but canonical receipt revalidation was not accepted "
                f"(outcome={retry_status})"
            )

        return {
            "registry_identity_id": str(retry_diagnostics.get("registry_identity_id") or "").strip(),
            "registry_fingerprint_sha256": legacy._valid_sha(
                retry_diagnostics.get("registry_fingerprint_sha256")
            ),
            "registry_receipt_revalidation_attempted": True,
            "registry_receipt_revalidation_accepted": True,
            "registry_attempts": int(retry_diagnostics.get("registry_attempts") or 0),
            "revalidation_path": "indexed_player_card_then_canonical",
            "bootstrap_reason": bootstrap_reason,
        }


async def _revalidate_all(
    pending: list[tuple[str, dict[str, str], Any, str]],
) -> dict[str, dict[str, Any]]:
    semaphore = asyncio.Semaphore(LIVE_REVALIDATION_CONCURRENCY)
    completed = 0
    accepted = 0
    total = len(pending)
    progress_lock = asyncio.Lock()

    async def run_one(
        row_id: str,
        wanted: dict[str, str],
        example: Any,
        resolution: str,
    ) -> tuple[str, dict[str, Any]]:
        nonlocal completed, accepted
        detail = await _revalidate_one(
            row_id=row_id,
            wanted=wanted,
            example=example,
            semaphore=semaphore,
        )
        detail["resolution"] = resolution
        async with progress_lock:
            completed += 1
            accepted += 1
            if completed == 1 or completed % 10 == 0 or completed == total:
                print(
                    f"CURRICULUM REGISTRY REVALIDATION: {completed}/{total} accepted={accepted} "
                    f"concurrency={LIVE_REVALIDATION_CONCURRENCY}",
                    flush=True,
                )
        return row_id, detail

    pairs = await asyncio.gather(
        *(run_one(row_id, wanted, example, resolution) for row_id, wanted, example, resolution in pending)
    )
    return dict(pairs)


def _verified_curriculum_examples(
    examples: list[Any],
    expectations: dict[str, dict[str, str]],
) -> tuple[set[str], list[dict[str, Any]]]:
    by_id = {str(example.training_example_id): example for example in examples}
    by_card_uuid = {
        str(example.card_uuid): example
        for example in examples
        if str(example.card_uuid or "").strip()
    }
    pending: list[tuple[str, dict[str, str], Any, str]] = []

    for original_row_id, wanted in sorted(expectations.items()):
        example = by_id.get(original_row_id)
        resolution = "same_training_example"
        if example is None and wanted.get("card_uuid"):
            example = by_card_uuid.get(wanted["card_uuid"])
            resolution = "latest_same_physical_card"
        if example is None:
            raise RuntimeError(
                f"Cannot teach benchmark miss {original_row_id}: no current trusted example for that row/physical card"
            )

        # A persisted non-empty contradiction is never papered over by a live lookup.
        # Missing/partial receipts are expected for V8 read-only bootstrap rows and are
        # resolved only by current canonical Registry receipt revalidation below.
        _local_receipt_without_contradiction(example, wanted)
        pending.append((original_row_id, wanted, example, resolution))

    if not pending:
        return set(), []

    current_receipts = asyncio.run(_revalidate_all(pending))
    force_ids: set[str] = set()
    audit: list[dict[str, Any]] = []

    for original_row_id, wanted, example, resolution in pending:
        current = current_receipts[original_row_id]
        current_id = str(example.training_example_id)
        force_ids.add(current_id)
        audit.append(
            {
                "benchmark_row_id": original_row_id,
                "training_example_id": current_id,
                "resolution": f"{resolution}+current_registry_receipt_revalidated",
                "registry_identity_id": current["registry_identity_id"],
                "registry_fingerprint_sha256": current["registry_fingerprint_sha256"],
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_attempts": current["registry_attempts"],
                "registry_revalidation_path": current["revalidation_path"],
                "registry_bootstrap_reason": current.get("bootstrap_reason"),
                "source_benchmark": wanted["source_benchmark"],
            }
        )
    return force_ids, audit


def _self_test() -> int:
    wanted = {
        "row_id": "row-1",
        "registry_identity_id": "00000000-0000-4000-8000-000000000001",
        "registry_fingerprint_sha256": "a" * 64,
        "source_benchmark": "/tmp/benchmark.json",
        "card_uuid": "card-1",
    }

    missing = SimpleNamespace(registry_identity_id=None, registry_fingerprint_sha256=None)
    assert _local_receipt_without_contradiction(missing, wanted) == ("", None)

    matching = SimpleNamespace(
        registry_identity_id=wanted["registry_identity_id"],
        registry_fingerprint_sha256=wanted["registry_fingerprint_sha256"],
    )
    assert _local_receipt_without_contradiction(matching, wanted) == (
        wanted["registry_identity_id"],
        wanted["registry_fingerprint_sha256"],
    )

    uuid_drift = SimpleNamespace(
        registry_identity_id="00000000-0000-4000-8000-000000000002",
        registry_fingerprint_sha256=wanted["registry_fingerprint_sha256"],
    )
    try:
        _local_receipt_without_contradiction(uuid_drift, wanted)
    except RuntimeError as exc:
        assert "Registry UUID changed" in str(exc)
    else:
        raise AssertionError("UUID drift must fail closed")

    fingerprint_drift = SimpleNamespace(
        registry_identity_id=wanted["registry_identity_id"],
        registry_fingerprint_sha256="b" * 64,
    )
    try:
        _local_receipt_without_contradiction(fingerprint_drift, wanted)
    except RuntimeError as exc:
        assert "Registry fingerprint changed" in str(exc)
    else:
        raise AssertionError("fingerprint drift must fail closed")

    accepted = SimpleNamespace(outcome=ChecklistOutcome.EXACT_MATCH)
    assert _accepted_expected_receipt(
        accepted,
        {
            "registry_receipt_revalidation_attempted": True,
            "registry_receipt_revalidation_accepted": True,
            "registry_identity_id": wanted["registry_identity_id"],
            "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
        },
        expected_registry=wanted["registry_identity_id"],
        expected_fingerprint=wanted["registry_fingerprint_sha256"],
    )
    assert not _accepted_expected_receipt(
        accepted,
        {
            "registry_receipt_revalidation_attempted": True,
            "registry_receipt_revalidation_accepted": False,
            "registry_identity_id": wanted["registry_identity_id"],
            "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
        },
        expected_registry=wanted["registry_identity_id"],
        expected_fingerprint=wanted["registry_fingerprint_sha256"],
    )

    assert unseen_v8.v7.v6.FAST_ROUTE == unseen_v8.SCOPED_FAST_ROUTE
    assert LIVE_REVALIDATION_CONCURRENCY <= 6
    assert LIVE_REVALIDATION_HTTP_TIMEOUT_SECONDS < LIVE_REVALIDATION_ITEM_TIMEOUT_SECONDS
    assert PLAYER_CARD_BOOTSTRAP_HTTP_TIMEOUT_SECONDS < PLAYER_CARD_BOOTSTRAP_ITEM_TIMEOUT_SECONDS
    print("PASS curriculum V2 accepts missing local receipts only through live current Registry revalidation")
    print("PASS curriculum V2 mirrors V8 indexed player-card recovery but never accepts bootstrap without canonical revalidation")
    print("PASS curriculum V2 preserves hard fail-closed UUID/fingerprint contradiction checks")
    print("PASS curriculum V2 keeps Registry revalidation concurrency and time bounded")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        code = legacy._self_test()
        if code != 0:
            return int(code)
        return _self_test()

    legacy._verified_curriculum_examples = _verified_curriculum_examples
    legacy.SCHEMA = SCHEMA
    return int(legacy.main())


if __name__ == "__main__":
    raise SystemExit(main())
