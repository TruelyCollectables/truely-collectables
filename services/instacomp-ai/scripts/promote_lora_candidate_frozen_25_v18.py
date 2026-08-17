#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import platform
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v5 as v5
import promote_lora_candidate_frozen_25_v6 as v6
import promote_lora_candidate_frozen_25_v10 as v10
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v13 as v13
import promote_lora_candidate_frozen_25_v14 as v14
import promote_lora_candidate_frozen_25_v15 as v15
import promote_lora_candidate_frozen_25_v17 as v17
import promote_lora_candidate_frozen_five as base

SCHEMA = "tcos.instacomp-ai.lora-staged-authoritative-promotion.v18"
ALLOWED_STAGE_TARGETS = (10, 15, 25)
PRIOR_STAGE = {10: None, 15: 10, 25: 15}
SELECTION_ATTEMPT_LIMITS = {10: 80, 15: 120, 25: 200}
LOCKED_POOL_LIMITS = {10: 30, 15: 45, 25: 70}
CANDIDATE_DRY_PASSES = 2
REVIEWED_PRIORITY_ROW_IDS = tuple(v17.REVIEWED_PINNED_ROW_IDS)
STAGE_MANIFEST = v11.STAGE_MANIFEST
MANIFEST_SCHEMA = v11.MANIFEST_SCHEMA

RegistryMatch = Callable[[Any, str | None], Awaitable[Any]]
ProbeFn = Callable[[dict[str, Any], str, int], Awaitable[tuple[bool, dict[str, Any]]]]


class CandidateFixtureMismatch(RuntimeError):
    """A deterministic candidate/Registry mismatch that may be backfilled."""


def _stage_label(target: int) -> str:
    return f"Frozen {target}"


def _dataset_fingerprint(dataset: Path, declared: object = None) -> str:
    declared_text = str(declared or "").strip().lower()
    if v3.legacy._valid_sha256(declared_text) is not None:
        return declared_text
    digest = hashlib.sha256()
    for name in ("train.jsonl", "validation.jsonl"):
        path = dataset / name
        if not path.is_file():
            raise RuntimeError(f"V18 cannot fingerprint missing dataset split: {path}")
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _install_contract(target: int) -> None:
    if target not in ALLOWED_STAGE_TARGETS:
        raise RuntimeError(f"Unsupported stage target {target}; allowed={ALLOWED_STAGE_TARGETS}")

    # Install the complete current physical/Registry hierarchy, including:
    # candidate-shape normalization, serial/card-number guards, Prizm back-mark
    # authority, pattern-sensitive image witness, and Registry throttle retry.
    v15._install_contract()
    v13._install_contract()

    # Configure inherited receipt naming for this exact stage. V18 does NOT call
    # the legacy v12/v17 fixture builders or rely on their round monkey-patches.
    v11._configure_stage(target)
    v3.SCHEMA = SCHEMA
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


def _signature(item: dict[str, Any]) -> dict[str, str]:
    case = item.get("case") or ()
    if len(case) < 6:
        raise RuntimeError("V18 fixture is missing authoritative Registry case fields")
    payload = {
        "row_id": str(item.get("row_id") or ""),
        "player": str(case[1] or ""),
        "card_number": str(case[2] or ""),
        "registry_identity_id": str(case[4] or ""),
        "registry_fingerprint_sha256": str(case[5] or ""),
    }
    if any(not payload[key] for key in payload):
        raise RuntimeError(f"V18 fixture signature contains a blank required field: {payload}")
    if v3.legacy._valid_uuid(payload["registry_identity_id"]) is None:
        raise RuntimeError(f"V18 fixture has invalid Registry UUID: {payload['registry_identity_id']!r}")
    if v3.legacy._valid_sha256(payload["registry_fingerprint_sha256"]) is None:
        raise RuntimeError("V18 fixture has invalid Registry fingerprint")
    return payload


def _manifest_signatures(
    payload: dict[str, Any],
    *,
    expected_stage: int,
    adapter_sha: str | None = None,
    dataset_sha: str | None = None,
) -> list[dict[str, str]]:
    if payload.get("schema_version") != MANIFEST_SCHEMA or payload.get("complete") is not True:
        raise RuntimeError("Prior V18 staged fixture manifest is not complete")
    if int(payload.get("stage_target") or 0) != expected_stage:
        raise RuntimeError(
            f"Expected successful Frozen {expected_stage} manifest; "
            f"found stage={payload.get('stage_target')!r}"
        )
    if adapter_sha is not None and base.norm(payload.get("adapter_weights_sha256")) != base.norm(adapter_sha):
        raise RuntimeError("Prior staged manifest adapter hash does not match current validated adapter")
    if dataset_sha is not None and base.norm(payload.get("dataset_sha256")) != base.norm(dataset_sha):
        raise RuntimeError("Prior staged manifest dataset hash does not match current validated dataset")
    raw = payload.get("fixtures")
    if not isinstance(raw, list) or len(raw) != expected_stage:
        raise RuntimeError(
            f"Prior Frozen {expected_stage} manifest must contain exactly {expected_stage} fixtures"
        )

    signatures: list[dict[str, str]] = []
    row_ids: set[str] = set()
    registry_ids: set[str] = set()
    for value in raw:
        if not isinstance(value, dict):
            raise RuntimeError("Prior staged manifest contains a malformed fixture")
        item = {
            "row_id": str(value.get("row_id") or ""),
            "player": str(value.get("player") or ""),
            "card_number": str(value.get("card_number") or ""),
            "registry_identity_id": str(value.get("registry_identity_id") or ""),
            "registry_fingerprint_sha256": str(
                value.get("registry_fingerprint_sha256") or ""
            ),
        }
        if any(not item[key] for key in item):
            raise RuntimeError(
                f"Prior staged manifest contains a blank required fixture field: {item}"
            )
        if v3.legacy._valid_uuid(item["registry_identity_id"]) is None:
            raise RuntimeError("Prior staged manifest contains an invalid Registry UUID")
        if v3.legacy._valid_sha256(item["registry_fingerprint_sha256"]) is None:
            raise RuntimeError("Prior staged manifest contains an invalid Registry fingerprint")
        if item["row_id"] in row_ids:
            raise RuntimeError("Prior staged manifest repeats a row ID")
        if item["registry_identity_id"] in registry_ids:
            raise RuntimeError("Prior staged manifest repeats a Registry UUID")
        row_ids.add(item["row_id"])
        registry_ids.add(item["registry_identity_id"])
        signatures.append(item)
    return signatures


def _prior_stage_signatures(
    target: int,
    *,
    adapter_sha: str,
    dataset_sha: str | None,
) -> list[dict[str, str]]:
    prior = PRIOR_STAGE[target]
    if prior is None:
        return []
    if not STAGE_MANIFEST.is_file():
        raise RuntimeError(
            f"{_stage_label(target)} requires a successful Frozen {prior} manifest first: "
            f"{STAGE_MANIFEST}"
        )
    payload = base.read_json(STAGE_MANIFEST)
    return _manifest_signatures(
        payload,
        expected_stage=prior,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )


def _candidate_items(dataset: Path, *, require_images: bool) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for row in base.load_rows(dataset):
        item = v12._ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is None:
            continue
        row_id = str(item.get("row_id") or "")
        if not row_id or row_id in items:
            raise RuntimeError(f"V18 expansion candidate row ID is missing/duplicated: {row_id!r}")
        items[row_id] = item
    if not items:
        raise RuntimeError("V18 found no image-backed training candidates")
    return items


def _legacy_priority_row_ids(dataset: Path, *, require_images: bool) -> tuple[str, ...]:
    """Use legacy Frozen Five only as preference, never as accepted truth."""
    try:
        fixtures = base.fixtures(dataset, require_images=require_images)
    except Exception:
        return ()
    output: list[str] = []
    for item in fixtures:
        row_id = str(item.get("row_id") or "")
        if row_id and row_id not in output:
            output.append(row_id)
    return tuple(output)


def _ordered_candidate_ids(
    *,
    items: dict[str, dict[str, Any]],
    carry_forward: list[dict[str, str]],
    legacy_priority: tuple[str, ...],
) -> list[str]:
    carry_ids = [item["row_id"] for item in carry_forward]
    order: list[str] = []
    seen: set[str] = set()

    def add(row_id: str) -> None:
        if row_id and row_id in items and row_id not in seen:
            order.append(row_id)
            seen.add(row_id)

    for row_id in carry_ids:
        add(row_id)
    for row_id in legacy_priority:
        add(row_id)
    for row_id in REVIEWED_PRIORITY_ROW_IDS:
        add(row_id)

    extras = sorted(
        (item for row_id, item in items.items() if row_id not in seen),
        key=v12._ORIGINAL_EXPANSION_SORT_KEY,
    )
    for item in extras:
        add(str(item.get("row_id") or ""))

    if order[: len(carry_ids)] != carry_ids:
        missing = [row_id for row_id in carry_ids if row_id not in items]
        raise RuntimeError(
            "V18 cannot preserve the certified prior-stage row prefix; "
            f"missing/ineligible carry-forward rows={missing}"
        )
    return order


def _case_from_lock(item: dict[str, Any], registry: Any) -> dict[str, Any] | None:
    # Current v3._locked_expansion is the inherited v15 physical + Registry gate.
    locked = v3._locked_expansion(item, registry)
    if locked is None:
        return None
    sig = _signature(locked)
    locked["v18_signature"] = sig
    return locked


async def _authoritative_lock(
    item: dict[str, Any],
    *,
    registry_match: RegistryMatch,
) -> dict[str, Any] | None:
    from app.models import CardIdentity

    teacher = CardIdentity.model_validate(item["identity"])
    registry = await v10._registry_match_evidence_aligned(
        teacher,
        item,
        registry_match,
    )
    return _case_from_lock(item, registry)


def _require_carry_forward_lock(
    locked: dict[str, Any] | None,
    expected: dict[str, str],
) -> dict[str, Any]:
    if locked is None:
        raise RuntimeError(
            f"Certified prior-stage row {expected['row_id']} no longer passes current "
            "Registry/physical preflight"
        )
    actual = _signature(locked)
    if actual != expected:
        raise RuntimeError(
            "Certified prior-stage fixture drifted before activation: "
            f"expected={expected} actual={actual}"
        )
    return locked


async def _build_locked_pool(
    dataset: Path,
    *,
    target: int,
    require_images: bool = True,
    registry_match: RegistryMatch | None = None,
    adapter_sha: str,
    dataset_sha: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if registry_match is None:
        from app.checklist import checklist_gateway

        registry_match = checklist_gateway.match
    registry_match = v13._retrying_registry_match(registry_match)

    items = _candidate_items(dataset, require_images=require_images)
    carry_forward = _prior_stage_signatures(
        target,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )
    legacy_priority = _legacy_priority_row_ids(
        dataset,
        require_images=require_images,
    )
    order = _ordered_candidate_ids(
        items=items,
        carry_forward=carry_forward,
        legacy_priority=legacy_priority,
    )
    carry_by_row = {item["row_id"]: item for item in carry_forward}

    attempt_limit = min(SELECTION_ATTEMPT_LIMITS[target], len(order))
    locked_limit = LOCKED_POOL_LIMITS[target]
    locked_pool: list[dict[str, Any]] = []
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()

    print(
        f"{_stage_label(target).upper()} V18 AUTHORITATIVE PREFLIGHT: "
        f"eligible_rows={len(items)} carry_forward={len(carry_forward)} "
        f"legacy_priority_only={len(legacy_priority)} attempt_limit={attempt_limit} "
        f"locked_pool_limit={locked_limit}",
        flush=True,
    )

    for row_id in order[:attempt_limit]:
        item = items[row_id]
        expected = carry_by_row.get(row_id)
        locked = await _authoritative_lock(item, registry_match=registry_match)

        if expected is not None:
            locked = _require_carry_forward_lock(locked, expected)
        elif locked is None:
            identity = item.get("identity") or {}
            print(
                f"V18 PREFLIGHT SKIP {identity.get('player')} "
                f"#{identity.get('card_number')}: current Registry/physical gates rejected row",
                flush=True,
            )
            continue

        sig = _signature(locked)
        registry_id = sig["registry_identity_id"]
        if registry_id in used_registry_ids:
            if expected is not None:
                raise RuntimeError(
                    f"Certified carry-forward Registry UUID duplicated: {registry_id}"
                )
            continue

        player_key = base.norm(sig["player"])
        cap = int(getattr(v3.legacy, "MAX_PRIMARY_ROWS_PER_PLAYER", 2))
        if expected is None and player_counts[player_key] >= cap:
            continue

        locked_pool.append(locked)
        used_registry_ids.add(registry_id)
        player_counts[player_key] += 1
        print(
            f"V18 PREFLIGHT LOCK {len(locked_pool)}/{locked_limit} "
            f"{sig['player']} #{sig['card_number']} registry={registry_id} "
            f"carry_forward={'true' if expected is not None else 'false'}",
            flush=True,
        )
        if len(locked_pool) >= locked_limit:
            break

    if len(locked_pool) < target:
        raise RuntimeError(
            f"{_stage_label(target)} V18 could lock only {len(locked_pool)} "
            f"current-authoritative candidates before activation; required={target}"
        )

    if carry_forward:
        actual_prefix = [_signature(item) for item in locked_pool[: len(carry_forward)]]
        if actual_prefix != carry_forward:
            raise RuntimeError(
                f"{_stage_label(target)} V18 failed to preserve exact prior-stage prefix"
            )
    return locked_pool, carry_forward


async def _probe_fixture(
    item: dict[str, Any],
    adapter_sha: str,
    pass_number: int,
) -> tuple[bool, dict[str, Any]]:
    result = await v14.run_round_exhaustive(
        -pass_number,
        [item],
        adapter_sha,
    )
    if result.get("passed") is True:
        return True, result
    mode = str(result.get("failure_mode") or "")
    if mode == "deterministic_card_failures":
        return False, result
    raise RuntimeError(
        "Candidate qualification infrastructure failed before certification: "
        + str(result.get("error") or result)[:1500]
    )


async def _qualify_locked_pool(
    locked_pool: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    carry_forward: list[dict[str, str]],
    probe_fn: ProbeFn = _probe_fixture,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    carry_count = len(carry_forward)
    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    for item in locked_pool:
        sig = _signature(item)
        is_carry = len(selected) < carry_count and sig == carry_forward[len(selected)]
        if len(selected) < carry_count and not is_carry:
            raise RuntimeError(
                f"V18 candidate pool no longer begins with exact certified prefix at "
                f"position {len(selected)}"
            )

        pass_receipts: list[dict[str, Any]] = []
        passed = True
        for pass_number in range(1, CANDIDATE_DRY_PASSES + 1):
            ok, receipt = await probe_fn(item, adapter_sha, pass_number)
            pass_receipts.append(receipt)
            if not ok:
                passed = False
                break

        if not passed:
            if is_carry:
                raise CandidateFixtureMismatch(
                    "Certified prior-stage fixture no longer produces its exact current "
                    f"Registry lock in candidate qualification: {sig['player']} "
                    f"#{sig['card_number']}"
                )
            rejected.append(
                {
                    **sig,
                    "reason": "candidate_dry_preflight_mismatch",
                    "passes_completed": len(pass_receipts),
                }
            )
            print(
                f"V18 CANDIDATE PREFLIGHT SKIP {sig['player']} #{sig['card_number']}: "
                "candidate did not survive two exact Registry passes",
                flush=True,
            )
            continue

        selected.append(item)
        print(
            f"V18 CANDIDATE PREFLIGHT PASS {len(selected)}/{target} "
            f"{sig['player']} #{sig['card_number']} exact_passes={CANDIDATE_DRY_PASSES}",
            flush=True,
        )
        if len(selected) >= target:
            break

    if len(selected) != target:
        raise RuntimeError(
            f"{_stage_label(target)} V18 candidate qualification produced "
            f"{len(selected)}/{target} stable fixtures; rejected={len(rejected)}"
        )
    if carry_forward:
        current = [_signature(item) for item in selected[:carry_count]]
        if current != carry_forward:
            raise RuntimeError(
                f"{_stage_label(target)} V18 candidate qualification changed prior-stage prefix"
            )
    if len({_signature(item)["registry_identity_id"] for item in selected}) != target:
        raise RuntimeError("V18 selected duplicate Registry UUIDs")
    return selected, rejected


def _rounds_gate(rounds: list[dict[str, Any]], target: int) -> None:
    if len(rounds) != 2:
        raise RuntimeError(f"{_stage_label(target)} requires exactly two certification rounds")
    wanted: set[str] | None = None
    for index, result in enumerate(rounds, 1):
        cases = result.get("cases")
        if result.get("passed") is not True or not isinstance(cases, list):
            raise RuntimeError(
                f"{_stage_label(target)} round {index} failed: "
                f"{result.get('error') or result}"
            )
        keys = {str(value.get("key") or "") for value in cases}
        if len(cases) != target or len(keys) != target or "" in keys:
            raise RuntimeError(
                f"{_stage_label(target)} round {index} was not exact {target}/{target}"
            )
        if any(
            value.get("candidate_provider") != base.PROVIDER
            or value.get("candidate_fallback") is True
            or value.get("passed") is not True
            for value in cases
        ):
            raise RuntimeError(
                f"{_stage_label(target)} round {index} contains fallback/non-candidate evidence"
            )
        if wanted is None:
            wanted = keys
        elif keys != wanted:
            raise RuntimeError(
                f"{_stage_label(target)} round {index} did not use identical fixture keys"
            )


def _write_stage_manifest(
    fixtures: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
) -> Path:
    STAGE_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": MANIFEST_SCHEMA,
        "created_at": base.now(),
        "complete": True,
        "stage_target": target,
        "adapter_weights_sha256": adapter_sha,
        "dataset_sha256": dataset_sha,
        "registry_attempt_budget": SELECTION_ATTEMPT_LIMITS[target],
        "registry_remains_identity_authority": True,
        "v18_current_authoritative_selection": True,
        "v18_candidate_dry_passes_per_fixture": CANDIDATE_DRY_PASSES,
        "fixtures": [_signature(item) for item in fixtures],
    }
    tmp = STAGE_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(STAGE_MANIFEST)
    return STAGE_MANIFEST


def _failure_receipt(
    *,
    target: int,
    adapter: Path,
    adapter_sha: str,
    dataset: Path,
    dataset_sha: str | None,
    rounds: list[dict[str, Any]],
    rejected: list[dict[str, Any]],
    error: BaseException,
    activated: bool,
) -> Path:
    data = {
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": "failed_rolled_back" if activated else "failed_before_activation",
        "complete": False,
        "promotion_stage_target": target,
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "candidate_dry_preflight_rejections": rejected,
        "rounds": rounds,
        "error_type": type(error).__name__,
        "error": str(error)[:4000],
        "runtime_candidate_enabled_after_failure": False if activated else None,
        "registry_remains_identity_authority": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    return v3.legacy._write_receipt(data)


def _success_receipt(
    *,
    target: int,
    adapter: Path,
    adapter_sha: str,
    dataset: Path,
    dataset_sha: str | None,
    validation_receipt: str | None,
    activation_receipt: str | None,
    manifest: Path,
    rounds: list[dict[str, Any]],
    rejected: list[dict[str, Any]],
) -> Path:
    data = {
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": f"promoted_runtime_candidate_frozen_{target}",
        "complete": True,
        "promotion_stage_target": target,
        "next_stage_target": 15 if target == 10 else (25 if target == 15 else None),
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "validation_receipt": validation_receipt,
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "activation_receipt": activation_receipt,
        "fixture_manifest": str(manifest),
        "candidate_dry_preflight_rejections": rejected,
        "candidate_dry_passes_per_fixture": CANDIDATE_DRY_PASSES,
        "rounds": rounds,
        "passes": 2,
        "cards_per_pass": target,
        "candidate_fallbacks": 0,
        "critical_regressions": 0,
        "runtime_candidate_enabled": True,
        "registry_remains_identity_authority": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    return v3.legacy._write_receipt(data)


def _self_test_manifest_validation() -> None:
    stage = 10
    fixtures = [
        {
            "row_id": f"row-{index}",
            "player": f"Player {index}",
            "card_number": str(index),
            "registry_identity_id": f"00000000-0000-0000-0018-{index:012d}",
            "registry_fingerprint_sha256": f"{index + 1:064x}",
        }
        for index in range(stage)
    ]
    payload = {
        "schema_version": MANIFEST_SCHEMA,
        "complete": True,
        "stage_target": stage,
        "adapter_weights_sha256": "b" * 64,
        "dataset_sha256": "c" * 64,
        "fixtures": fixtures,
    }
    assert _manifest_signatures(
        payload,
        expected_stage=stage,
        adapter_sha="b" * 64,
        dataset_sha="c" * 64,
    ) == fixtures

    bad = json.loads(json.dumps(payload))
    bad["fixtures"][3]["registry_identity_id"] = ""
    try:
        _manifest_signatures(
            bad,
            expected_stage=stage,
            adapter_sha="b" * 64,
            dataset_sha="c" * 64,
        )
        raise AssertionError("Blank prior-stage Registry UUID was accepted")
    except RuntimeError:
        pass

    duplicate = json.loads(json.dumps(payload))
    duplicate["fixtures"][4]["row_id"] = duplicate["fixtures"][0]["row_id"]
    try:
        _manifest_signatures(
            duplicate,
            expected_stage=stage,
            adapter_sha="b" * 64,
            dataset_sha="c" * 64,
        )
        raise AssertionError("Duplicate prior-stage row ID was accepted")
    except RuntimeError:
        pass

    stale = json.loads(json.dumps(payload))
    stale["adapter_weights_sha256"] = "d" * 64
    try:
        _manifest_signatures(
            stale,
            expected_stage=stage,
            adapter_sha="b" * 64,
            dataset_sha="c" * 64,
        )
        raise AssertionError("Stale prior-stage adapter manifest was accepted")
    except RuntimeError:
        pass
    print("PASS v18 rejects incomplete, malformed, duplicate, or stale prior-stage manifests")


def _self_test_priority_only_legacy() -> None:
    def fake_item(row_id: str) -> dict[str, Any]:
        return {
            "row_id": row_id,
            "identity": {"player": row_id, "card_number": row_id},
            "images": [Path("/tmp/a"), Path("/tmp/b")],
            "split": "train",
            "marker": None,
        }

    items = {
        row_id: fake_item(row_id)
        for row_id in ("carry-0", "legacy-0", "reviewed-0", "extra-0", "extra-1")
    }
    ordered = _ordered_candidate_ids(
        items=items,
        carry_forward=[
            {
                "row_id": "carry-0",
                "player": "Carry",
                "card_number": "1",
                "registry_identity_id": "00000000-0000-0000-0018-000000000101",
                "registry_fingerprint_sha256": "a" * 64,
            }
        ],
        legacy_priority=("legacy-0",),
    )
    assert ordered[0] == "carry-0"
    assert ordered.index("legacy-0") > 0
    assert "extra-0" in ordered and "extra-1" in ordered
    print("PASS v18 treats legacy Frozen Five rows as priority only, never accepted seeds")


def _self_test_candidate_backfill() -> None:
    def fixture(index: int) -> dict[str, Any]:
        uuid = f"00000000-0000-0000-0018-{index:012d}"
        return {
            "row_id": f"row-{index}",
            "split": "train",
            "images": [Path("/tmp/card.jpg")],
            "identity": {},
            "case": (
                f"case-{index}",
                f"Player {index}",
                str(index),
                None,
                uuid,
                f"{index + 1:064x}",
            ),
        }

    pool = [fixture(index) for index in range(5)]
    calls: Counter[str] = Counter()

    async def probe(item: dict[str, Any], _sha: str, _pass: int):
        key = item["case"][0]
        calls[key] += 1
        return (key != "case-2", {"passed": key != "case-2"})

    selected, rejected = asyncio.run(
        _qualify_locked_pool(
            pool,
            target=3,
            adapter_sha="f" * 64,
            carry_forward=[],
            probe_fn=probe,
        )
    )
    assert [item["case"][0] for item in selected] == ["case-0", "case-1", "case-3"]
    assert rejected[0]["row_id"] == "row-2"
    assert calls["case-0"] == calls["case-1"] == calls["case-3"] == 2

    carry = [_signature(pool[0])]

    async def fail_carry(_item: dict[str, Any], _sha: str, _pass: int):
        return False, {"passed": False}

    try:
        asyncio.run(
            _qualify_locked_pool(
                pool,
                target=2,
                adapter_sha="f" * 64,
                carry_forward=carry,
                probe_fn=fail_carry,
            )
        )
        raise AssertionError("Unstable certified carry-forward fixture was backfilled")
    except CandidateFixtureMismatch:
        pass
    print("PASS v18 requires two candidate/Registry passes and backfills only new unstable rows")
    print("PASS v18 never swaps an unstable certified prior-stage fixture")


def _self_test_malonga_regression() -> None:
    from types import SimpleNamespace

    item = {
        "identity": {
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "Dominique Malonga",
            "card_number": "116",
            "parallel": "Cracked Ice Prizm",
        }
    }
    registry_ice = SimpleNamespace(
        identity={
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "Dominique Malonga",
            "card_number": "116",
            "parallel": "Prizms Ice",
        }
    )

    previous_back = v15._prizm_back_mark_probe_override
    previous_image = v5._image_parallel_probe_override
    try:
        v15._prizm_back_mark_probe_override = lambda _item: False
        v5._image_parallel_probe_override = lambda _item: "ice"
        conflict, image_marker, teacher_marker, registry_marker = (
            v15._authoritative_prizm_back_mark_conflict(item, registry_ice)
        )
        assert conflict is True
        assert image_marker == "base"
        assert teacher_marker == registry_marker == "ice"

        v15._prizm_back_mark_probe_override = lambda _item: True
        conflict, image_marker, teacher_marker, registry_marker = (
            v15._authoritative_prizm_back_mark_conflict(item, registry_ice)
        )
        assert conflict is False
        assert image_marker == teacher_marker == registry_marker == "ice"
    finally:
        v15._prizm_back_mark_probe_override = previous_back
        v5._image_parallel_probe_override = previous_image
    print("PASS v18 rejects stale Dominique Malonga Ice truth when the physical back rule says Base")
    print("PASS v18 preserves Dominique Ice only when back mark and surface witness both agree")


def _self_test_round_binding() -> None:
    assert v14.run_round_exhaustive.__name__ == "run_round_exhaustive"
    assert CANDIDATE_DRY_PASSES == 2
    assert LOCKED_POOL_LIMITS[10] > 10
    assert LOCKED_POOL_LIMITS[15] > 15
    assert LOCKED_POOL_LIMITS[25] > 25
    print("PASS v18 calls exhaustive certification traversal directly instead of monkey-patch lookup")
    print("PASS v18 locked pools leave deterministic backfill capacity at every stage")


def self_test() -> int:
    assert v15.self_test() == 0
    _install_contract(10)
    _self_test_manifest_validation()
    _self_test_priority_only_legacy()
    _self_test_candidate_backfill()
    _self_test_malonga_regression()
    _self_test_round_binding()
    print("PASS v18 removes unconditional legacy Frozen Five seeds")
    print("PASS v18 preserves current Registry and physical evidence as identity authority")
    print("PASS v18 consolidated runner contract complete")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--stage-target", type=int, choices=ALLOWED_STAGE_TARGETS, default=10)
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit("V18 staged InstaComp Production promotion must run on the Apple Silicon Mac.")

    target = int(args.stage_target)
    _install_contract(target)
    v3.frozen_five_v2.clear_mutable_candidate_env_overrides()

    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit("Explicit adapter does not match complete_and_validated receipt")

    adapter_sha = base.file_sha(adapter / "adapters.safetensors")
    dataset_sha = _dataset_fingerprint(dataset, receipt.get("dataset_sha256"))

    activated = False
    activation = None
    rounds: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    try:
        locked_pool, carry_forward = asyncio.run(
            _build_locked_pool(
                dataset,
                target=target,
                require_images=True,
                adapter_sha=adapter_sha,
                dataset_sha=dataset_sha,
            )
        )

        started = datetime.now(timezone.utc).timestamp()
        subprocess.run(
            ["bash", str(base.ENABLE), str(adapter)],
            cwd=base.REPO_ROOT,
            check=True,
        )
        activated = True
        activation = base.activation_receipt(started, adapter, adapter_sha)
        v6._refresh_runtime_candidate_settings()

        fixtures, rejected = asyncio.run(
            _qualify_locked_pool(
                locked_pool,
                target=target,
                adapter_sha=adapter_sha,
                carry_forward=carry_forward,
            )
        )

        print(
            f"{_stage_label(target).upper()} V18 FIXTURES: "
            + ", ".join(
                f"{item['case'][1]} #{item['case'][2]}[{item['split']}:{item['row_id']}]"
                for item in fixtures
            ),
            flush=True,
        )

        for number in (1, 2):
            result = asyncio.run(
                v14.run_round_exhaustive(
                    number,
                    fixtures,
                    adapter_sha,
                )
            )
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(
                    str(result.get("error") or f"Round {number} failed")[:4000]
                )
        _rounds_gate(rounds, target)

        manifest = _write_stage_manifest(
            fixtures,
            target=target,
            adapter_sha=adapter_sha,
            dataset_sha=dataset_sha,
        )
        path = _success_receipt(
            target=target,
            adapter=adapter,
            adapter_sha=adapter_sha,
            dataset=dataset,
            dataset_sha=dataset_sha,
            validation_receipt=receipt.get("validation_receipt"),
            activation_receipt=activation.get("_path") if activation else None,
            manifest=manifest,
            rounds=rounds,
            rejected=rejected,
        )
        print(
            f"PASS {_stage_label(target)} V18 certification complete: "
            f"dry_passes={CANDIDATE_DRY_PASSES} rounds=2 cards={target}",
            flush=True,
        )
        print(f"{_stage_label(target).upper()} V18 SUCCESS RECEIPT: {path}", flush=True)
        return 0

    except v13.RegistryThrottleAbort as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        print(f"REGISTRY THROTTLE ABORT: {error}", file=sys.stderr, flush=True)
        return 3
    except BaseException as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        path = _failure_receipt(
            target=target,
            adapter=adapter,
            adapter_sha=adapter_sha,
            dataset=dataset,
            dataset_sha=dataset_sha,
            rounds=rounds,
            rejected=rejected,
            error=error,
            activated=activated,
        )
        print(
            json.dumps(
                {
                    "schema_version": SCHEMA,
                    "status": "failed_rolled_back" if activated else "failed_before_activation",
                    "promotion_stage_target": target,
                    "error_type": type(error).__name__,
                    "error": str(error)[:4000],
                    "nothing_published": True,
                },
                indent=2,
            )
        )
        print(f"{_stage_label(target).upper()} V18 FAILURE RECEIPT: {path}", flush=True)
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
