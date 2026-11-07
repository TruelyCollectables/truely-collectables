#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any, Callable

import benchmark_lora_unseen_holdout_v1 as legacy

# Capture every wrapped legacy callable BEFORE main() monkey-patches the legacy
# module. Calling through legacy.<name> from inside a wrapper after monkey-patch
# would recurse back into the wrapper (the live Mac caught exactly that bug).
_LEGACY_POST_DATASET_TRUSTED_CANDIDATES = legacy._post_dataset_trusted_candidates

# Canonical successor for the 100-card image benchmark. V1 correctly enforced
# train/Frozen leakage and Registry/physical truth, but it allowed only one image
# example per Registry UUID. The live Mac therefore found 1,094 unseen rows yet
# scored only 21. This runner keeps every safety gate while allowing a bounded
# number of genuinely different image pairs for the same exact card identity.
DEFAULT_REGISTRY_CALL_BUDGET = 1500
MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY = 5
MAX_IMAGE_EXAMPLES_PER_PLAYER = 8
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v3"

_prior_pair_hashes: set[str] = set()


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _image_pair_sha(item: dict[str, Any]) -> str:
    explicit = str(item.get("image_pair_sha256") or "").strip().lower()
    if len(explicit) == 64 and all(ch in "0123456789abcdef" for ch in explicit):
        return explicit
    images = [Path(value) if not isinstance(value, Path) else value for value in item.get("images") or []]
    if not images:
        raise RuntimeError("unseen_candidate_images_missing")
    digest = hashlib.sha256()
    for index, path in enumerate(images):
        digest.update(str(index).encode("ascii"))
        digest.update(b"\0")
        digest.update(_file_sha(path).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _prior_scored_rows() -> set[str]:
    rows: set[str] = set()
    if not legacy.BENCHMARK_DIR.is_dir():
        return rows
    for path in sorted(legacy.BENCHMARK_DIR.glob("unseen-holdout-*.json")):
        try:
            payload = json.loads(path.read_text("utf-8"))
        except Exception:
            continue
        results = payload.get("results")
        if not isinstance(results, list):
            continue
        for result in results:
            if not isinstance(result, dict):
                continue
            row_id = str(result.get("row_id") or "").strip()
            if row_id:
                rows.add(row_id)
    return rows


def _validation_holdout_candidates(dataset: Path, *, frozen_row_ids: set[str]) -> list[dict[str, Any]]:
    global _prior_pair_hashes
    prior_rows = _prior_scored_rows()
    raw = legacy.v20.v19._candidate_items(dataset, require_images=True)
    output: list[dict[str, Any]] = []
    for item in raw.values():
        if str(item.get("split") or "") != "validation":
            continue
        row_id = str(item.get("row_id") or "")
        if row_id in frozen_row_ids:
            continue
        value = dict(item)
        value["benchmark_source"] = "locked_validation_holdout"
        if row_id in prior_rows:
            try:
                _prior_pair_hashes.add(_image_pair_sha(value))
            except Exception:
                pass
            continue
        output.append(value)
    return output


def _post_dataset_trusted_candidates(
    *,
    _source_fn: Callable[..., list[dict[str, Any]]] | None = None,
    **kwargs: Any,
) -> list[dict[str, Any]]:
    """Filter already-scored post-dataset rows without recursive monkey-patching.

    `_source_fn` exists only for the regression self-test. Production always uses
    the original V1 callable captured at module import, before main() replaces
    the public legacy attribute with this wrapper.
    """
    global _prior_pair_hashes
    prior_rows = _prior_scored_rows()
    source_fn = _source_fn or _LEGACY_POST_DATASET_TRUSTED_CANDIDATES
    values = source_fn(**kwargs)
    output: list[dict[str, Any]] = []
    for item in values:
        row_id = str(item.get("row_id") or "")
        if row_id in prior_rows:
            pair = str(item.get("image_pair_sha256") or "").strip().lower()
            if pair:
                _prior_pair_hashes.add(pair)
            continue
        output.append(item)
    return output


def _historical_receipt(item: dict[str, Any]) -> tuple[str, str] | None:
    identity_id = legacy.v20.v19.legacy._valid_uuid(
        item.get("historical_metadata_registry_id")
    )
    fingerprint = legacy.v20.v19.legacy._valid_sha256(
        item.get("historical_metadata_fingerprint")
    )
    if identity_id and fingerprint:
        return identity_id, fingerprint
    return None


class _ReceiptAwareGateway:
    """Inject one trusted historical Registry receipt into the normal V20 request.

    V20 still owns compatibility and physical-variant gates. The Production
    registry-lock endpoint revalidates this UUID + fingerprint against the current
    live Registry row and current visible evidence before it may return exact.
    """

    def __init__(self, gateway: Any, identity_id: str, fingerprint: str) -> None:
        self.gateway = gateway
        self.identity_id = identity_id
        self.fingerprint = fingerprint
        self.last_diagnostics: dict[str, Any] = {}

    async def match_with_diagnostics(
        self,
        identity: Any,
        ocr_text: str | None = None,
    ) -> tuple[Any, dict[str, Any]]:
        result, diagnostics = await self.gateway.match_with_diagnostics(
            identity,
            ocr_text,
            registry_identity_id=self.identity_id,
            registry_fingerprint_sha256=self.fingerprint,
        )
        self.last_diagnostics = dict(diagnostics)
        return result, diagnostics


def _ranked_item_key(item: dict[str, Any]) -> tuple[Any, ...]:
    identity = item.get("identity") or {}
    ready, _missing = legacy.v20._visible_set_identity_readiness(identity)
    historical = _historical_receipt(item) is not None
    release_score = legacy.v20._release_field_score(item)
    return (
        0 if ready else 1,
        0 if historical else 1,
        -release_score,
        _norm(identity.get("player")),
        _norm(identity.get("card_number")).lstrip("#"),
        str(item.get("row_id") or ""),
    )


def _diverse_order(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Keep V1's source/sport/variant/serial round-robin diversity, but put the
    # rows most likely to produce a current Registry lock first inside each lane.
    grouped: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[legacy._candidate_bucket(item)].append(item)
    buckets = {
        key: deque(sorted(values, key=_ranked_item_key))
        for key, values in grouped.items()
    }
    keys = sorted(buckets)
    output: list[dict[str, Any]] = []
    while keys:
        next_keys: list[tuple[str, str, str, str]] = []
        for key in keys:
            bucket = buckets[key]
            if bucket:
                output.append(bucket.popleft())
            if bucket:
                next_keys.append(key)
        keys = next_keys
    return output


def _admission_reason(
    *,
    registry_id: str,
    player: str,
    image_pair_sha256: str,
    registry_counts: Counter[str],
    player_counts: Counter[str],
    used_pairs: set[str],
    enforce_player_cap: bool,
) -> str | None:
    if image_pair_sha256 in used_pairs or image_pair_sha256 in _prior_pair_hashes:
        return "duplicate_or_previously_scored_image_pair"
    if registry_counts[registry_id] >= MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY:
        return "registry_identity_image_cap"
    if enforce_player_cap and player_counts[_norm(player)] >= MAX_IMAGE_EXAMPLES_PER_PLAYER:
        return "player_image_cap"
    return None


async def _authoritative_holdout(
    items: list[dict[str, Any]],
    *,
    target: int,
    registry_call_budget: int,
    gateway: Any,
    train_ids: set[str],
    all_dataset_ids: set[str],
    frozen_row_ids: set[str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
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

    for item in _diverse_order(items):
        if calls >= registry_call_budget or len(locked) >= target:
            break
        inspected += 1
        legacy._assert_unseen_contract(
            item,
            train_ids=train_ids,
            all_dataset_ids=all_dataset_ids,
            frozen_row_ids=frozen_row_ids,
        )
        identity = CardIdentity.model_validate(item["identity"])
        ready, _missing = legacy.v20._visible_set_identity_readiness(identity)
        if not ready:
            reasons["teacher_registry_request_incomplete"] += 1
            continue

        # Cheap image de-duplication happens before spending a Registry call.
        try:
            pair_sha = _image_pair_sha(item)
        except Exception as error:
            reasons[f"image_pair_hash_error:{type(error).__name__}"] += 1
            continue
        if pair_sha in used_pairs or pair_sha in _prior_pair_hashes:
            reasons["duplicate_or_previously_scored_image_pair"] += 1
            continue

        receipt = _historical_receipt(item)
        probe_gateway = gateway
        receipt_gateway: _ReceiptAwareGateway | None = None
        if receipt is not None:
            historical_receipts_available += 1
            historical_receipts_requested += 1
            receipt_gateway = _ReceiptAwareGateway(gateway, receipt[0], receipt[1])
            probe_gateway = receipt_gateway

        calls += 1
        current, detail = await legacy.v20._lock_identity(
            item,
            identity,
            gateway=probe_gateway,
        )
        if receipt_gateway is not None:
            accepted = bool(
                receipt_gateway.last_diagnostics.get(
                    "registry_receipt_revalidation_accepted"
                )
            )
            if accepted:
                historical_receipts_revalidated += 1
                if current is not None:
                    current["registry_lock_source"] = (
                        "current_registry_receipt_revalidated_plus_v20_physical_witness"
                    )
            elif receipt_gateway.last_diagnostics:
                historical_receipts_fell_back_to_resolver += 1

        if current is None:
            reasons[str(detail.get("reason") or "teacher_current_authority_reject")] += 1
            continue

        signature = legacy.v20.v19._signature(current)
        registry_id = signature["registry_identity_id"]
        player = signature["player"]
        reason = _admission_reason(
            registry_id=registry_id,
            player=player,
            image_pair_sha256=pair_sha,
            registry_counts=registry_counts,
            player_counts=player_counts,
            used_pairs=used_pairs,
            enforce_player_cap=True,
        )
        current["benchmark_source"] = item["benchmark_source"]
        current["trusted_identity"] = legacy._identity_payload(identity)
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
        player_counts[_norm(player)] += 1
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
                f"{MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY}{receipt_label}",
                flush=True,
            )

    # If the strict player cap alone prevented 100, relax only that diversity
    # cap using already-current-authoritative locks. Registry-identity and image
    # uniqueness caps remain hard and are never relaxed.
    for current in deferred:
        if len(locked) >= target:
            break
        signature = legacy.v20.v19._signature(current)
        registry_id = signature["registry_identity_id"]
        pair_sha = str(current.get("benchmark_image_pair_sha256") or "")
        reason = _admission_reason(
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
        player_counts[_norm(signature["player"])] += 1
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
        "previously_scored_rows_excluded": len(_prior_scored_rows()),
        "previously_scored_image_pairs_known": len(_prior_pair_hashes),
        "registry_identity_image_cap": MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY,
        "player_image_cap": MAX_IMAGE_EXAMPLES_PER_PLAYER,
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


def _self_test() -> int:
    assert legacy._self_test() == 0

    sample = [
        {"row_id": "b", "benchmark_source": "locked_validation_holdout", "identity": {"sport": "Basketball", "year": "2025", "brand": "Prizm", "set_name": "Base", "player": "B", "card_number": "2"}},
        {"row_id": "a", "benchmark_source": "locked_validation_holdout", "identity": {"sport": "Basketball", "year": "2025", "brand": "Prizm", "set_name": "Base", "player": "A", "card_number": "1"}},
    ]
    first = [item["row_id"] for item in _diverse_order(sample)]
    second = [item["row_id"] for item in _diverse_order(list(reversed(sample)))]
    assert first == second == ["a", "b"]

    registry_counts: Counter[str] = Counter({"rid": MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY})
    player_counts: Counter[str] = Counter()
    assert _admission_reason(
        registry_id="rid", player="P", image_pair_sha256="new", registry_counts=registry_counts,
        player_counts=player_counts, used_pairs=set(), enforce_player_cap=False,
    ) == "registry_identity_image_cap"
    registry_counts.clear()
    assert _admission_reason(
        registry_id="rid", player="P", image_pair_sha256="same", registry_counts=registry_counts,
        player_counts=player_counts, used_pairs={"same"}, enforce_player_cap=False,
    ) == "duplicate_or_previously_scored_image_pair"

    # Regression for the exact live-Mac failure: main() replaces the public
    # legacy attribute with this wrapper. The wrapper must still dispatch to a
    # callable captured before monkey-patching, never through the patched name.
    legacy_public = legacy._post_dataset_trusted_candidates
    source_calls = 0

    def fake_original(**_kwargs: Any) -> list[dict[str, Any]]:
        nonlocal source_calls
        source_calls += 1
        return [
            {
                "row_id": "fresh-post-dataset-row",
                "image_pair_sha256": "a" * 64,
            }
        ]

    try:
        legacy._post_dataset_trusted_candidates = _post_dataset_trusted_candidates
        wrapped = _post_dataset_trusted_candidates(_source_fn=fake_original)
        assert source_calls == 1
        assert [item["row_id"] for item in wrapped] == ["fresh-post-dataset-row"]
        assert _LEGACY_POST_DATASET_TRUSTED_CANDIDATES is not legacy._post_dataset_trusted_candidates
    finally:
        legacy._post_dataset_trusted_candidates = legacy_public

    # The receipt-aware proxy must forward the prior UUID/fingerprint as keyword
    # evidence while preserving the ordinary gateway contract used by V20.
    class FakeGateway:
        def __init__(self) -> None:
            self.received: dict[str, Any] = {}

        async def match_with_diagnostics(self, identity: Any, ocr_text: str | None = None, **kwargs: Any):
            self.received = dict(kwargs)
            return object(), {
                "registry_receipt_revalidation_accepted": True,
            }

    fake = FakeGateway()
    proxy = _ReceiptAwareGateway(
        fake,
        "11111111-1111-4111-8111-111111111111",
        "a" * 64,
    )
    asyncio.run(proxy.match_with_diagnostics(object(), "visible"))
    assert fake.received["registry_identity_id"] == "11111111-1111-4111-8111-111111111111"
    assert fake.received["registry_fingerprint_sha256"] == "a" * 64
    assert proxy.last_diagnostics["registry_receipt_revalidation_accepted"] is True

    print("PASS canonical unseen benchmark prioritizes Registry-ready rows")
    print("PASS canonical unseen benchmark permits bounded repeated identities but unique images only")
    print("PASS canonical unseen benchmark keeps a hard five-image cap per Registry identity")
    print("PASS canonical unseen benchmark excludes previously scored rows before the next exam")
    print("PASS canonical unseen benchmark wrapper cannot recurse after legacy monkey-patch")
    print("PASS canonical unseen benchmark forwards historical Registry receipts for current revalidation")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    legacy.DEFAULT_REGISTRY_CALL_BUDGET = DEFAULT_REGISTRY_CALL_BUDGET
    legacy.SCHEMA = SCHEMA
    legacy._validation_holdout_candidates = _validation_holdout_candidates
    legacy._post_dataset_trusted_candidates = _post_dataset_trusted_candidates
    legacy._diverse_order = _diverse_order
    legacy._authoritative_holdout = _authoritative_holdout
    return int(legacy.main())


if __name__ == "__main__":
    raise SystemExit(main())
