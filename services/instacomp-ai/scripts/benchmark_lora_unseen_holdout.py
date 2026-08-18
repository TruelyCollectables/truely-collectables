#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any

import benchmark_lora_unseen_holdout_v1 as legacy

# Canonical successor for the 100-card image benchmark.  V1 correctly enforced
# train/Frozen leakage and Registry/physical truth, but it allowed only one image
# example per Registry UUID.  The live Mac therefore found 1,094 unseen rows yet
# scored only 21.  This runner keeps every safety gate while allowing a bounded
# number of genuinely different image pairs for the same exact card identity.
DEFAULT_REGISTRY_CALL_BUDGET = 1500
MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY = 5
MAX_IMAGE_EXAMPLES_PER_PLAYER = 8
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v2"

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


def _post_dataset_trusted_candidates(**kwargs: Any) -> list[dict[str, Any]]:
    global _prior_pair_hashes
    prior_rows = _prior_scored_rows()
    values = legacy._post_dataset_trusted_candidates(**kwargs)
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


def _ranked_item_key(item: dict[str, Any]) -> tuple[Any, ...]:
    identity = item.get("identity") or {}
    ready, _missing = legacy.v20._visible_set_identity_readiness(identity)
    historical = legacy.v20._historical_registry_receipt(item)
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

        calls += 1
        current, detail = await legacy.v20._lock_identity(item, identity, gateway=gateway)
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
            print(
                f"UNSEEN PREFLIGHT LOCK {len(locked)}/{target} {player} "
                f"#{signature['card_number']} source={item['benchmark_source']} "
                f"registry={registry_id} identity_image={registry_counts[registry_id]}/"
                f"{MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY}",
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

    return locked, {
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
        "previously_scored_rows_excluded": len(_prior_scored_rows()),
        "previously_scored_image_pairs_known": len(_prior_pair_hashes),
        "registry_identity_image_cap": MAX_IMAGE_EXAMPLES_PER_REGISTRY_IDENTITY,
        "player_image_cap": MAX_IMAGE_EXAMPLES_PER_PLAYER,
    }


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

    print("PASS canonical unseen benchmark prioritizes Registry-ready rows")
    print("PASS canonical unseen benchmark permits bounded repeated identities but unique images only")
    print("PASS canonical unseen benchmark keeps a hard five-image cap per Registry identity")
    print("PASS canonical unseen benchmark excludes previously scored rows before the next exam")
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
