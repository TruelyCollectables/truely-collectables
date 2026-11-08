#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import time
from collections import Counter
from typing import Any

import benchmark_lora_unseen_holdout_v6 as v6

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v7"
PREFLIGHT_CONCURRENCY = 6
PREFLIGHT_BATCH_SIZE = 12
PREFLIGHT_ITEM_TIMEOUT_SECONDS = 25.0
PREFLIGHT_WALL_BUDGET_SECONDS = 600.0

canonical = v6.v5.canonical


async def _bounded_authoritative_holdout(
    items: list[dict[str, Any]],
    *,
    target: int,
    registry_call_budget: int,
    gateway: Any,
    train_ids: set[str],
    all_dataset_ids: set[str],
    frozen_row_ids: set[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Canonical V3/V20 admission with bounded parallel Registry I/O.

    This preserves the exact unseen, receipt, Registry compatibility, physical
    witness, identity/image cap, and player-diversity rules from canonical V3.
    Only the transport scheduling changes: independent read-only locks are
    evaluated in bounded batches with a hard per-item timeout, visible progress,
    and a total preflight wall-clock watchdog.
    """
    from app.models import CardIdentity

    locked: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    reasons: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    registry_counts: Counter[str] = Counter()
    player_counts: Counter[str] = Counter()
    used_pairs: set[str] = set()
    calls = 0
    inspected = 0
    historical_receipts_available = 0
    historical_receipts_requested = 0
    historical_receipts_revalidated = 0
    historical_receipts_fell_back_to_resolver = 0

    work: list[tuple[dict[str, Any], Any, str, tuple[str, str] | None]] = []
    for item in canonical._diverse_order(items):
        if len(work) >= registry_call_budget:
            break
        inspected += 1
        canonical.legacy._assert_unseen_contract(
            item,
            train_ids=train_ids,
            all_dataset_ids=all_dataset_ids,
            frozen_row_ids=frozen_row_ids,
        )
        identity = CardIdentity.model_validate(item["identity"])
        ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
        if not ready:
            reasons["teacher_registry_request_incomplete"] += 1
            continue
        try:
            pair_sha = canonical._image_pair_sha(item)
        except Exception as error:
            reasons[f"image_pair_hash_error:{type(error).__name__}"] += 1
            continue
        if pair_sha in canonical._prior_pair_hashes:
            reasons["duplicate_or_previously_scored_image_pair"] += 1
            continue
        receipt = canonical._historical_receipt(item)
        if receipt is not None:
            historical_receipts_available += 1
            historical_receipts_requested += 1
        work.append((item, identity, pair_sha, receipt))

    print(
        "UNSEEN PREFLIGHT START: "
        f"eligible={len(work)} concurrency={PREFLIGHT_CONCURRENCY} "
        f"batch={PREFLIGHT_BATCH_SIZE} item_timeout={PREFLIGHT_ITEM_TIMEOUT_SECONDS:.0f}s "
        f"wall_budget={PREFLIGHT_WALL_BUDGET_SECONDS:.0f}s",
        flush=True,
    )

    started = time.monotonic()
    semaphore = asyncio.Semaphore(PREFLIGHT_CONCURRENCY)

    async def run_one(
        item: dict[str, Any],
        identity: Any,
        receipt: tuple[str, str] | None,
    ) -> tuple[dict[str, Any] | None, dict[str, Any], bool, bool]:
        async with semaphore:
            probe_gateway = gateway
            receipt_gateway: Any | None = None
            if receipt is not None:
                receipt_gateway = canonical._ReceiptAwareGateway(
                    gateway, receipt[0], receipt[1]
                )
                probe_gateway = receipt_gateway
            try:
                current, detail = await asyncio.wait_for(
                    canonical.legacy.v20._lock_identity(
                        item,
                        identity,
                        gateway=probe_gateway,
                    ),
                    timeout=PREFLIGHT_ITEM_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                return None, {"reason": "registry_preflight_item_timeout"}, False, False
            accepted = False
            fell_back = False
            if receipt_gateway is not None:
                accepted = bool(
                    receipt_gateway.last_diagnostics.get(
                        "registry_receipt_revalidation_accepted"
                    )
                )
                fell_back = bool(receipt_gateway.last_diagnostics) and not accepted
                if accepted and current is not None:
                    current["registry_lock_source"] = (
                        "current_registry_receipt_revalidated_plus_v20_physical_witness"
                    )
            return current, detail, accepted, fell_back

    stop_for_wall = False
    for batch_start in range(0, len(work), PREFLIGHT_BATCH_SIZE):
        if len(locked) >= target or calls >= registry_call_budget:
            break
        elapsed = time.monotonic() - started
        if elapsed >= PREFLIGHT_WALL_BUDGET_SECONDS:
            reasons["registry_preflight_wall_budget_exhausted"] += 1
            stop_for_wall = True
            break

        batch = work[batch_start : batch_start + PREFLIGHT_BATCH_SIZE]
        remaining = max(0, registry_call_budget - calls)
        batch = batch[:remaining]
        if not batch:
            break
        results = await asyncio.gather(
            *(run_one(item, identity, receipt) for item, identity, _pair, receipt in batch)
        )
        calls += len(batch)

        for (item, identity, pair_sha, receipt), result in zip(batch, results, strict=True):
            current, detail, accepted, fell_back = result
            if receipt is not None:
                if accepted:
                    historical_receipts_revalidated += 1
                elif fell_back:
                    historical_receipts_fell_back_to_resolver += 1

            if current is None:
                reasons[str(detail.get("reason") or "teacher_current_authority_reject")] += 1
                continue

            signature = canonical.legacy.v20.v19._signature(current)
            registry_id = signature["registry_identity_id"]
            player = signature["player"]
            reason = canonical._admission_reason(
                registry_id=registry_id,
                player=player,
                image_pair_sha256=pair_sha,
                registry_counts=registry_counts,
                player_counts=player_counts,
                used_pairs=used_pairs,
                enforce_player_cap=True,
            )
            current["benchmark_source"] = item["benchmark_source"]
            current["trusted_identity"] = canonical.legacy._identity_payload(identity)
            current["trusted_created_at"] = item.get("trusted_created_at")
            current["benchmark_image_pair_sha256"] = pair_sha
            if reason == "player_image_cap":
                deferred.append(current)
                reasons[reason] += 1
                continue
            if reason:
                reasons[reason] += 1
                continue

            locked.append(current)
            used_pairs.add(pair_sha)
            registry_counts[registry_id] += 1
            player_counts[canonical._norm(player)] += 1
            sources[str(item["benchmark_source"])] += 1
            if len(locked) <= 10 or len(locked) % 10 == 0:
                receipt_label = (
                    " receipt=current"
                    if current.get("registry_lock_source")
                    == "current_registry_receipt_revalidated_plus_v20_physical_witness"
                    else ""
                )
                print(
                    f"UNSEEN PREFLIGHT LOCK {len(locked)}/{target} {player} "
                    f"#{signature['card_number']} source={item['benchmark_source']} "
                    f"registry={registry_id} identity_image={registry_counts[registry_id]}/"
                    f"{canonical.MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY}{receipt_label}",
                    flush=True,
                )
            if len(locked) >= target:
                break

        elapsed = time.monotonic() - started
        rate = calls / elapsed if elapsed > 0 else 0.0
        print(
            "UNSEEN PREFLIGHT PROGRESS: "
            f"calls={calls}/{min(len(work), registry_call_budget)} locked={len(locked)}/{target} "
            f"revalidated={historical_receipts_revalidated} "
            f"timeouts={reasons['registry_preflight_item_timeout']} "
            f"elapsed={elapsed:.1f}s rate={rate:.2f}/s",
            flush=True,
        )

    if stop_for_wall:
        elapsed = time.monotonic() - started
        print(
            "UNSEEN PREFLIGHT WATCHDOG: "
            f"wall budget reached after {elapsed:.1f}s; continuing fail-closed with "
            f"calls={calls} locked={len(locked)}/{target}",
            flush=True,
        )

    # Preserve canonical behavior: relax only the player diversity cap using
    # already-current-authoritative locks. Registry/image caps remain hard.
    for current in deferred:
        if len(locked) >= target:
            break
        signature = canonical.legacy.v20.v19._signature(current)
        registry_id = signature["registry_identity_id"]
        pair_sha = str(current.get("benchmark_image_pair_sha256") or "")
        reason = canonical._admission_reason(
            registry_id=registry_id,
            player=signature["player"],
            image_pair_sha256=pair_sha,
            registry_counts=registry_counts,
            player_counts=player_counts,
            used_pairs=used_pairs,
            enforce_player_cap=False,
        )
        if reason:
            continue
        locked.append(current)
        used_pairs.add(pair_sha)
        registry_counts[registry_id] += 1
        player_counts[canonical._norm(signature["player"])] += 1
        sources[str(current["benchmark_source"])] += 1
        reasons["player_cap_relaxed_from_deferred"] += 1

    diagnostics = {
        "inspected": inspected,
        "registry_calls": calls,
        "locked": len(locked),
        "unique_registry_identities": len(registry_counts),
        "unique_image_pairs": len(used_pairs),
        "max_examples_for_one_registry_identity": max(registry_counts.values(), default=0),
        "max_examples_for_one_player": max(player_counts.values(), default=0),
        "registry_identity_distribution": dict(registry_counts),
        "source_counts": dict(sources),
        "reject_reasons": dict(reasons),
        "historical_receipts_available": historical_receipts_available,
        "historical_receipts_requested": historical_receipts_requested,
        "historical_receipts_revalidated": historical_receipts_revalidated,
        "historical_receipts_fell_back_to_resolver": historical_receipts_fell_back_to_resolver,
        "previously_scored_rows_excluded": len(canonical._prior_scored_rows()),
        "previously_scored_image_pairs_known": len(canonical._prior_pair_hashes),
        "registry_identity_image_cap": canonical.MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY,
        "player_image_cap": canonical.MAX_IMAGE_EXAMPLES_PER_PLAYER,
        "preflight_concurrency": PREFLIGHT_CONCURRENCY,
        "preflight_item_timeout_seconds": PREFLIGHT_ITEM_TIMEOUT_SECONDS,
        "preflight_wall_budget_seconds": PREFLIGHT_WALL_BUDGET_SECONDS,
    }
    if len(locked) < target:
        top_rejects = ", ".join(
            f"{reason}={count}" for reason, count in reasons.most_common(10)
        ) or "none"
        print(
            "UNSEEN PREFLIGHT DIAGNOSTICS: "
            f"inspected={inspected} registry_calls={calls} locked={len(locked)}/{target} "
            f"historical_receipts={historical_receipts_available} "
            f"revalidated={historical_receipts_revalidated} "
            f"receipt_fallbacks={historical_receipts_fell_back_to_resolver} "
            f"top_rejects=[{top_rejects}]",
            flush=True,
        )
    return locked, diagnostics


def _install_runtime() -> None:
    v6._install_fast_runtime()
    v6.v5._CANONICAL_AUTHORITATIVE_HOLDOUT = _bounded_authoritative_holdout
    v6.v5.SCHEMA = SCHEMA
    v6.v5.v4.SCHEMA = SCHEMA
    canonical.SCHEMA = SCHEMA


def _self_test() -> int:
    assert v6._self_test() == 0
    assert PREFLIGHT_CONCURRENCY > 1
    assert PREFLIGHT_BATCH_SIZE >= PREFLIGHT_CONCURRENCY
    assert PREFLIGHT_ITEM_TIMEOUT_SECONDS < 60.0
    assert PREFLIGHT_WALL_BUDGET_SECONDS <= 600.0
    assert v6.v5._CANONICAL_AUTHORITATIVE_HOLDOUT is not _bounded_authoritative_holdout
    _install_runtime()
    assert v6.v5._CANONICAL_AUTHORITATIVE_HOLDOUT is _bounded_authoritative_holdout
    print("PASS unseen V7 bounds the second canonical Registry preflight phase")
    print("PASS unseen V7 emits canonical preflight progress and hard wall watchdog")
    print("PASS unseen V7 preserves V3/V20 receipt, Registry, physical, and diversity admission")
    return 0


def main() -> int:
    import sys

    if "--self-test" in sys.argv[1:]:
        return _self_test()
    _install_runtime()
    return int(v6.v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
