#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import platform
import sqlite3
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v20 as v20

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v1"
DEFAULT_TARGET = 100
DEFAULT_REGISTRY_CALL_BUDGET = 600
EXACT_RATE_GATE = 0.95
BENCHMARK_DIR = v20.v19.base.SERVICE_ROOT / "data/lora-candidate/benchmarks"
SCORED_FIELDS = (
    "player",
    "year",
    "manufacturer",
    "brand",
    "set_name",
    "card_number",
    "variant",
    "serial_number",
    "serial_run",
    "autograph",
    "memorabilia",
)
WRONG_AUTHORITATIVE_CATEGORIES = frozenset(
    {"registry_uuid_mismatch", "registry_fingerprint_mismatch"}
)


def _text(value: object) -> str | None:
    value = str(value or "").strip()
    return value or None


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _state_text(value: object) -> str:
    return str(getattr(value, "value", value) or "").strip().casefold()


def _identity_payload(identity: Any) -> dict[str, Any]:
    return v20.v19._identity_payload(identity)


def _row_metadata(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("metadata")
    return value if isinstance(value, dict) else {}


def _dataset_membership(dataset: Path) -> dict[str, set[str]]:
    train_ids: set[str] = set()
    validation_ids: set[str] = set()
    image_pair_hashes: set[str] = set()
    for row in v20.v19.base.load_rows(dataset):
        row_id = str(row.get("id") or "")
        split = str(row.get("_split") or "")
        if split == "train":
            train_ids.add(row_id)
        elif split == "validation":
            validation_ids.add(row_id)
        metadata = _row_metadata(row)
        for source in (row, metadata):
            pair = _text(source.get("image_pair_sha256"))
            if pair:
                image_pair_hashes.add(pair.casefold())
    return {
        "train_ids": train_ids,
        "validation_ids": validation_ids,
        "all_ids": train_ids | validation_ids,
        "image_pair_hashes": image_pair_hashes,
    }


def _frozen_25_signatures(
    *,
    adapter_sha: str,
    dataset_sha: str,
) -> list[dict[str, str]]:
    manifest = v20.v19.STAGE_MANIFEST
    if not manifest.is_file():
        raise RuntimeError(
            "Unseen benchmark requires the successful Frozen-25 fixture manifest first"
        )
    payload = v20.v19.base.read_json(manifest)
    return v20.v19._manifest_signatures(
        payload,
        expected_stage=25,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )


def _validation_holdout_candidates(
    dataset: Path,
    *,
    frozen_row_ids: set[str],
) -> list[dict[str, Any]]:
    items = v20.v19._candidate_items(dataset, require_images=True)
    output: list[dict[str, Any]] = []
    for item in items.values():
        if str(item.get("split") or "") != "validation":
            continue
        row_id = str(item.get("row_id") or "")
        if row_id in frozen_row_ids:
            continue
        value = dict(item)
        value["benchmark_source"] = "locked_validation_holdout"
        output.append(value)
    return output


def _post_dataset_trusted_candidates(
    *,
    database_path: Path,
    image_store_path: Path,
    dataset_ids: set[str],
    dataset_image_pair_hashes: set[str],
    frozen_row_ids: set[str],
) -> list[dict[str, Any]]:
    from app.images import persisted_image_path
    from app.models import TrainingExample

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT training_example_id, example_json, created_at "
            "FROM training_examples WHERE trusted = 1 ORDER BY created_at ASC, training_example_id ASC"
        ).fetchall()
    finally:
        connection.close()

    output: list[dict[str, Any]] = []
    for row in rows:
        try:
            example = TrainingExample.model_validate(json.loads(row["example_json"]))
        except Exception:
            continue
        row_id = str(example.training_example_id or row["training_example_id"] or "")
        if not row_id or row_id in dataset_ids or row_id in frozen_row_ids:
            continue
        state = _state_text(example.state)
        verification = _norm(example.verification_source)
        if state != "operator_confirmed" and "operator_confirmed" not in verification:
            continue
        identity = example.confirmed_identity
        if identity is None:
            continue
        pair_hash = _text(example.image_pair_sha256)
        if pair_hash and pair_hash.casefold() in dataset_image_pair_hashes:
            continue
        front_path = persisted_image_path(
            image_store_path,
            example.front_sha256,
            "front",
        )
        if not front_path.is_file():
            continue
        images = [front_path]
        if example.back_sha256:
            back_path = persisted_image_path(
                image_store_path,
                example.back_sha256,
                "back",
            )
            if not back_path.is_file():
                continue
            images.append(back_path)
        output.append(
            {
                "row_id": row_id,
                "split": "post_dataset_operator_confirmed",
                "benchmark_source": "post_dataset_operator_confirmed",
                "images": images,
                "identity": _identity_payload(identity),
                "trusted_created_at": str(example.created_at or row["created_at"] or ""),
                "image_pair_sha256": pair_hash,
            }
        )
    return output


def _variant(identity: Any) -> str | None:
    return v20.v19._identity_variant(identity)


def _candidate_bucket(item: dict[str, Any]) -> tuple[str, str, str, str]:
    identity = item.get("identity") or {}
    sport = _norm(identity.get("sport") or identity.get("league") or "unknown")
    variant = _variant(identity) or "base_or_unspecified"
    serial = "serial" if identity.get("serial_number") or identity.get("serial_run") else "nonserial"
    source = str(item.get("benchmark_source") or "unknown")
    return source, sport, variant, serial


def _deterministic_item_key(item: dict[str, Any]) -> tuple[str, str, str, str]:
    identity = item.get("identity") or {}
    return (
        _norm(identity.get("player")),
        _norm(identity.get("card_number")).lstrip("#"),
        str(item.get("benchmark_source") or ""),
        str(item.get("row_id") or ""),
    )


def _diverse_order(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str, str], deque[dict[str, Any]]] = {}
    grouped: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        grouped[_candidate_bucket(item)].append(item)
    for key, values in grouped.items():
        buckets[key] = deque(sorted(values, key=_deterministic_item_key))
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


def _assert_unseen_contract(
    item: dict[str, Any],
    *,
    train_ids: set[str],
    all_dataset_ids: set[str],
    frozen_row_ids: set[str],
) -> None:
    row_id = str(item.get("row_id") or "")
    source = str(item.get("benchmark_source") or "")
    if not row_id:
        raise RuntimeError("Unseen benchmark candidate is missing row_id")
    if row_id in frozen_row_ids:
        raise RuntimeError(f"Frozen-25 certification leakage detected: {row_id}")
    if source == "locked_validation_holdout":
        if row_id in train_ids:
            raise RuntimeError(f"Training leakage detected in validation holdout: {row_id}")
        return
    if source == "post_dataset_operator_confirmed":
        if row_id in all_dataset_ids:
            raise RuntimeError(f"Training/export leakage detected in post-dataset holdout: {row_id}")
        return
    raise RuntimeError(f"Unknown unseen benchmark source: {source!r}")


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
    used_registry_ids: set[str] = set()
    reasons: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    calls = 0
    inspected = 0

    for item in _diverse_order(items):
        if calls >= registry_call_budget or len(locked) >= target:
            break
        inspected += 1
        _assert_unseen_contract(
            item,
            train_ids=train_ids,
            all_dataset_ids=all_dataset_ids,
            frozen_row_ids=frozen_row_ids,
        )
        identity = CardIdentity.model_validate(item["identity"])
        ready, missing = v20._visible_set_identity_readiness(identity)
        if not ready:
            reasons["teacher_registry_request_incomplete"] += 1
            continue
        calls += 1
        current, detail = await v20._lock_identity(item, identity, gateway=gateway)
        if current is None:
            reasons[str(detail.get("reason") or "teacher_current_authority_reject")] += 1
            continue
        signature = v20.v19._signature(current)
        registry_id = signature["registry_identity_id"]
        if registry_id in used_registry_ids:
            reasons["duplicate_registry_identity"] += 1
            continue
        current["benchmark_source"] = item["benchmark_source"]
        current["trusted_identity"] = _identity_payload(identity)
        current["trusted_created_at"] = item.get("trusted_created_at")
        locked.append(current)
        used_registry_ids.add(registry_id)
        sources[str(item["benchmark_source"])] += 1
        if len(locked) <= 10 or len(locked) % 10 == 0:
            print(
                f"UNSEEN PREFLIGHT LOCK {len(locked)}/{target} "
                f"{signature['player']} #{signature['card_number']} "
                f"source={item['benchmark_source']} registry={registry_id}",
                flush=True,
            )

    return locked, {
        "inspected": inspected,
        "registry_calls": calls,
        "locked": len(locked),
        "source_counts": dict(sources),
        "reject_reasons": dict(reasons),
    }


def _field_value(identity: dict[str, Any], field: str) -> Any:
    if field == "variant":
        return _variant(identity)
    if field == "card_number":
        return _norm(identity.get(field)).lstrip("#") or None
    if field in {"autograph", "memorabilia"}:
        if field not in identity:
            return None
        return bool(identity.get(field))
    if field == "serial_run":
        value = identity.get(field)
        if value in {None, ""}:
            return None
        try:
            return int(value)
        except Exception:
            return _norm(value)
    return _norm(identity.get(field)) or None


def _field_scores(expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for field in SCORED_FIELDS:
        wanted = _field_value(expected, field)
        got = _field_value(actual, field)
        eligible = wanted is not None
        output[field] = {
            "eligible": eligible,
            "match": bool(eligible and wanted == got),
            "expected": wanted,
            "actual": got,
        }
    return output


def _candidate_classification(ok: bool, receipt: dict[str, Any]) -> str:
    if ok:
        return "authoritative_exact"
    category = str(receipt.get("failure_category") or "")
    if category in WRONG_AUTHORITATIVE_CATEGORIES:
        return "wrong_authoritative_identity"
    return "safe_review_or_reject"


def _dangerous_variant_error(
    *,
    authoritative_exact: bool,
    expected: dict[str, Any],
    actual: dict[str, Any],
) -> bool:
    if not authoritative_exact:
        return False
    expected_variant = _field_value(expected, "variant")
    actual_variant = _field_value(actual, "variant")
    return expected_variant is not None and expected_variant != actual_variant


async def _run_candidate_benchmark(
    holdout: list[dict[str, Any]],
    *,
    adapter_sha: str,
    gateway: Any,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    results: list[dict[str, Any]] = []
    classes: Counter[str] = Counter()
    field_totals: dict[str, Counter[str]] = {field: Counter() for field in SCORED_FIELDS}
    dangerous_variant_errors = 0
    fallbacks = 0

    for index, item in enumerate(holdout, 1):
        expected_signature = v20.v19._signature(item)
        ok, receipt = await v20._candidate_probe(
            item,
            adapter_sha=adapter_sha,
            gateway=gateway,
            phase="unseen_holdout",
            pass_number=1,
        )
        actual_identity = receipt.get("candidate_identity")
        if not isinstance(actual_identity, dict):
            actual_identity = {}
        expected_identity = item.get("trusted_identity")
        if not isinstance(expected_identity, dict):
            expected_identity = item.get("identity") or {}
        scores = _field_scores(expected_identity, actual_identity)
        for field, score in scores.items():
            if score["eligible"]:
                field_totals[field]["eligible"] += 1
                if score["match"]:
                    field_totals[field]["matches"] += 1
        classification = _candidate_classification(ok, receipt)
        classes[classification] += 1
        dangerous_variant = _dangerous_variant_error(
            authoritative_exact=ok,
            expected=expected_identity,
            actual=actual_identity,
        )
        if dangerous_variant:
            dangerous_variant_errors += 1
        if receipt.get("candidate_fallback") is True:
            fallbacks += 1
        result = {
            "index": index,
            "row_id": str(item.get("row_id") or ""),
            "source": item.get("benchmark_source"),
            "player": expected_signature["player"],
            "card_number": expected_signature["card_number"],
            "expected_registry_identity_id": expected_signature["registry_identity_id"],
            "expected_registry_fingerprint_sha256": expected_signature["registry_fingerprint_sha256"],
            "classification": classification,
            "authoritative_exact": ok,
            "failure_category": receipt.get("failure_category"),
            "registry_status": receipt.get("registry_status"),
            "registry_identity_id": receipt.get("registry_identity_id"),
            "candidate_provider": receipt.get("candidate_provider"),
            "candidate_fallback": receipt.get("candidate_fallback"),
            "candidate_identity": actual_identity,
            "field_scores": scores,
            "dangerous_variant_error": dangerous_variant,
            "physical": receipt.get("physical"),
        }
        results.append(result)
        label = "PASS" if ok else ("WRONG" if classification == "wrong_authoritative_identity" else "REVIEW")
        print(
            f"UNSEEN {label} {index}/{len(holdout)} "
            f"{expected_signature['player']} #{expected_signature['card_number']} "
            f"category={receipt.get('failure_category')!r}",
            flush=True,
        )

    field_summary: dict[str, Any] = {}
    for field, counts in field_totals.items():
        eligible = int(counts["eligible"])
        matches = int(counts["matches"])
        field_summary[field] = {
            "eligible": eligible,
            "matches": matches,
            "accuracy": (matches / eligible) if eligible else None,
        }
    exact = int(classes["authoritative_exact"])
    total = len(results)
    return results, {
        "total": total,
        "authoritative_exact": exact,
        "authoritative_exact_rate": (exact / total) if total else 0.0,
        "safe_review_or_reject": int(classes["safe_review_or_reject"]),
        "wrong_authoritative_identity": int(classes["wrong_authoritative_identity"]),
        "dangerous_variant_errors": dangerous_variant_errors,
        "candidate_fallbacks": fallbacks,
        "field_accuracy": field_summary,
    }


def _graduation_gate(*, target: int, tested: int, summary: dict[str, Any]) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if tested != target:
        reasons.append(f"benchmark_incomplete:{tested}/{target}")
    if float(summary.get("authoritative_exact_rate") or 0.0) < EXACT_RATE_GATE:
        reasons.append("authoritative_exact_rate_below_95_percent")
    if int(summary.get("wrong_authoritative_identity") or 0) != 0:
        reasons.append("wrong_authoritative_identity_nonzero")
    if int(summary.get("dangerous_variant_errors") or 0) != 0:
        reasons.append("dangerous_variant_errors_nonzero")
    if int(summary.get("candidate_fallbacks") or 0) != 0:
        reasons.append("candidate_fallbacks_nonzero")
    return not reasons, reasons


def _write_receipt(payload: dict[str, Any]) -> Path:
    BENCHMARK_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BENCHMARK_DIR / f"unseen-holdout-{stamp}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(path)
    return path


def _self_test() -> int:
    items = [
        {
            "row_id": "v-1",
            "benchmark_source": "locked_validation_holdout",
            "identity": {"sport": "Basketball", "player": "B", "card_number": "2", "parallel": "Cracked Ice"},
        },
        {
            "row_id": "p-1",
            "benchmark_source": "post_dataset_operator_confirmed",
            "identity": {"sport": "Hockey", "player": "A", "card_number": "1", "parallel": "Base"},
        },
        {
            "row_id": "v-2",
            "benchmark_source": "locked_validation_holdout",
            "identity": {"sport": "Basketball", "player": "C", "card_number": "3", "parallel": "Velocity"},
        },
    ]
    order1 = [item["row_id"] for item in _diverse_order(items)]
    order2 = [item["row_id"] for item in _diverse_order(list(reversed(items)))]
    assert order1 == order2 and set(order1) == {"v-1", "v-2", "p-1"}

    _assert_unseen_contract(
        items[0],
        train_ids={"train-1"},
        all_dataset_ids={"train-1", "v-1", "v-2"},
        frozen_row_ids=set(),
    )
    try:
        leaked = dict(items[0])
        leaked["row_id"] = "train-1"
        _assert_unseen_contract(
            leaked,
            train_ids={"train-1"},
            all_dataset_ids={"train-1"},
            frozen_row_ids=set(),
        )
        raise AssertionError("training leakage was accepted")
    except RuntimeError:
        pass

    scores = _field_scores(
        {"player": "Test Player", "card_number": "41", "parallel": "Cracked Ice"},
        {"player": "test player", "card_number": "#41", "parallel": "Prizms Ice"},
    )
    assert scores["player"]["match"] is True
    assert scores["card_number"]["match"] is True
    assert scores["variant"]["match"] is True
    assert _candidate_classification(True, {}) == "authoritative_exact"
    assert _candidate_classification(False, {"failure_category": "registry_uuid_mismatch"}) == "wrong_authoritative_identity"
    assert _candidate_classification(False, {"failure_category": "registry_input_incomplete"}) == "safe_review_or_reject"

    good_summary = {
        "authoritative_exact_rate": 0.95,
        "wrong_authoritative_identity": 0,
        "dangerous_variant_errors": 0,
        "candidate_fallbacks": 0,
    }
    passed, reasons = _graduation_gate(target=100, tested=100, summary=good_summary)
    assert passed is True and not reasons
    passed, reasons = _graduation_gate(target=100, tested=99, summary=good_summary)
    assert passed is False and any(reason.startswith("benchmark_incomplete") for reason in reasons)

    print("PASS unseen gauntlet deterministic diversity ordering")
    print("PASS unseen gauntlet excludes train and Frozen-25 leakage")
    print("PASS unseen gauntlet canonical field/variant scoring")
    print("PASS unseen gauntlet distinguishes safe review from wrong authoritative identity")
    print("PASS unseen gauntlet graduation requires complete 100-card, >=95% exact, zero wrong identity/variant, zero fallback")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Benchmark the certified LoRA on genuinely unseen image-backed cards. "
            "Eligible sources are the locked validation split (never train) excluding Frozen-25 fixtures, "
            "plus later trusted operator-confirmed rows absent from the adapter dataset."
        )
    )
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    parser.add_argument("--registry-call-budget", type=int, default=DEFAULT_REGISTRY_CALL_BUDGET)
    parser.add_argument(
        "--allow-partial",
        action="store_true",
        help="Run all currently available authoritative unseen cards even when fewer than --target exist; partial runs can never graduate the adapter.",
    )
    args = parser.parse_args()
    if args.self_test:
        return _self_test()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("The live unseen benchmark must run on the Apple Silicon Mac.")
    if args.target < 1:
        raise SystemExit("--target must be >= 1")
    if args.registry_call_budget < args.target:
        raise SystemExit("--registry-call-budget must be >= --target")

    receipt, adapter, dataset = v20.v19.base.completion_gate()
    adapter_sha = v20.v19.base.file_sha(adapter / "adapters.safetensors")
    dataset_sha = v20.v19._dataset_fingerprint(dataset, receipt.get("dataset_sha256"))
    frozen = _frozen_25_signatures(adapter_sha=adapter_sha, dataset_sha=dataset_sha)
    frozen_row_ids = {item["row_id"] for item in frozen}
    membership = _dataset_membership(dataset)

    from app.config import settings
    from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway

    settings.ensure_directories()
    database_path = settings.resolve_local_path(settings.database_path)
    image_store_path = settings.resolve_local_path(settings.image_store_path)

    validation = _validation_holdout_candidates(
        dataset,
        frozen_row_ids=frozen_row_ids,
    )
    post_dataset = _post_dataset_trusted_candidates(
        database_path=database_path,
        image_store_path=image_store_path,
        dataset_ids=membership["all_ids"],
        dataset_image_pair_hashes=membership["image_pair_hashes"],
        frozen_row_ids=frozen_row_ids,
    )
    pool = validation + post_dataset
    print(
        "UNSEEN POOL: "
        f"validation_holdout={len(validation)} post_dataset_operator_confirmed={len(post_dataset)} "
        f"raw_unseen={len(pool)} target={args.target}",
        flush=True,
    )

    gateway = AuthoritativeRegistryChecklistGateway()
    try:
        holdout, preflight = asyncio.run(
            _authoritative_holdout(
                pool,
                target=args.target,
                registry_call_budget=args.registry_call_budget,
                gateway=gateway,
                train_ids=membership["train_ids"],
                all_dataset_ids=membership["all_ids"],
                frozen_row_ids=frozen_row_ids,
            )
        )
    except v20.v13.RegistryThrottleAbort as error:
        path = _write_receipt(
            {
                "schema_version": SCHEMA,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "registry_throttle_abort",
                "complete": False,
                "target": args.target,
                "adapter": str(adapter),
                "adapter_weights_sha256": adapter_sha,
                "dataset": str(dataset),
                "dataset_sha256": dataset_sha,
                "error": str(error),
                "nothing_published": True,
                "model_weights_mutated": False,
                "inventory_mutated": False,
            }
        )
        print(f"UNSEEN BENCHMARK ABORTED BY REGISTRY THROTTLE: {path}", flush=True)
        return 3

    if len(holdout) < args.target and not args.allow_partial:
        needed = args.target - len(holdout)
        path = _write_receipt(
            {
                "schema_version": SCHEMA,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "insufficient_unseen_authoritative_pool",
                "complete": False,
                "target": args.target,
                "authoritative_unseen_available": len(holdout),
                "additional_unseen_cards_needed": needed,
                "adapter": str(adapter),
                "adapter_weights_sha256": adapter_sha,
                "dataset": str(dataset),
                "dataset_sha256": dataset_sha,
                "frozen_25_excluded_rows": len(frozen_row_ids),
                "raw_source_counts": {
                    "locked_validation_holdout": len(validation),
                    "post_dataset_operator_confirmed": len(post_dataset),
                },
                "preflight": preflight,
                "graduation_gate_passed": False,
                "graduation_gate_reasons": [f"benchmark_incomplete:{len(holdout)}/{args.target}"],
                "nothing_published": True,
                "model_weights_mutated": False,
                "inventory_mutated": False,
            }
        )
        print(
            f"UNSEEN HOLDOUT NOT YET 100-CARD READY: authoritative={len(holdout)}/{args.target}; "
            f"need={needed} more genuinely unseen trusted cards; receipt={path}",
            flush=True,
        )
        return 4

    if not holdout:
        raise RuntimeError("No current-authoritative unseen cards are available for benchmarking")

    results, summary = asyncio.run(
        _run_candidate_benchmark(
            holdout,
            adapter_sha=adapter_sha,
            gateway=gateway,
        )
    )
    graduated, graduation_reasons = _graduation_gate(
        target=args.target,
        tested=len(holdout),
        summary=summary,
    )
    status = "complete" if len(holdout) == args.target else "partial_complete"
    payload = {
        "schema_version": SCHEMA,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "complete": len(holdout) == args.target,
        "target": args.target,
        "tested": len(holdout),
        "exact_rate_gate": EXACT_RATE_GATE,
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "frozen_25_excluded_rows": sorted(frozen_row_ids),
        "raw_source_counts": {
            "locked_validation_holdout": len(validation),
            "post_dataset_operator_confirmed": len(post_dataset),
        },
        "preflight": preflight,
        "summary": summary,
        "graduation_gate_passed": graduated,
        "graduation_gate_reasons": graduation_reasons,
        "results": results,
        "registry_remains_identity_authority": True,
        "candidate_fallback_forbidden": True,
        "nothing_published": True,
        "model_weights_mutated": False,
        "inventory_mutated": False,
    }
    path = _write_receipt(payload)
    print(
        "UNSEEN HOLDOUT SUMMARY: "
        f"tested={summary['total']} exact={summary['authoritative_exact']} "
        f"exact_rate={summary['authoritative_exact_rate']:.3%} "
        f"safe_review={summary['safe_review_or_reject']} "
        f"wrong_authoritative={summary['wrong_authoritative_identity']} "
        f"dangerous_variant={summary['dangerous_variant_errors']} "
        f"fallbacks={summary['candidate_fallbacks']}",
        flush=True,
    )
    print(
        f"UNSEEN HOLDOUT RECEIPT: {path}\n"
        f"GRADUATION GATE: {'PASS' if graduated else 'NOT YET'} "
        f"reasons={graduation_reasons}",
        flush=True,
    )
    return 0 if graduated else 5


if __name__ == "__main__":
    raise SystemExit(main())
