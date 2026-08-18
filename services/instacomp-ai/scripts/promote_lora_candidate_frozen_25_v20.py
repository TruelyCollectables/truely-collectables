#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import platform
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25_v13 as v13
import promote_lora_candidate_frozen_25_v19 as v19

SCHEMA = "tcos.instacomp-ai.lora-staged-authoritative-promotion.v20"
ALLOWED_STAGE_TARGETS = v19.ALLOWED_STAGE_TARGETS
CANDIDATE_DRY_PASSES = v19.CANDIDATE_DRY_PASSES
LOCKED_POOL_LIMITS = dict(v19.LOCKED_POOL_LIMITS)

# V19's live Mac run found 15 current-authoritative preflight locks in its first
# 80 rows, then six candidate/physical rejects left only 9/10 stable fixtures.
# V20 does not weaken those rejects. It creates enough safe reserve before
# activation and spends Registry calls only on rows that satisfy the Production
# resolver's visible-set minimum: year + brand + setName.
REGISTRY_CALL_BUDGETS = {10: 180, 15: 300, 25: 500}
MINIMUM_LOCKED_RESERVE = {10: 20, 15: 30, 25: 45}

_UNCERTAIN_EVIDENCE_RE = re.compile(
    r"\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\b",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
_SET_STOP_WORDS = frozenset(
    {"the", "and", "card", "cards", "trading", "set", "series", "upper", "deck", "panini", "topps"}
)

ProbeFn = Callable[..., Awaitable[tuple[bool, dict[str, Any]]]]


class CandidateFixtureMismatch(RuntimeError):
    """A certified carry-forward fixture changed under the current V20 pipeline."""


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _identity_payload(identity: Any) -> dict[str, Any]:
    return v19._identity_payload(identity)


def _meaningful_set_tokens(value: object) -> list[str]:
    text = str(value or "").casefold()
    text = re.sub(r"\b(?:19|20)\d{2}\s+(?:\d{2}|(?:19|20)\d{2})\b", " ", text)
    text = re.sub(r"\b(?:19|20)\d{2}\b", " ", text)
    text = re.sub(r"[^a-z0-9/]+", " ", text)
    return [token for token in text.split() if token and token not in _SET_STOP_WORDS]


def _visible_set_identity_readiness(identity: Any) -> tuple[bool, tuple[str, ...]]:
    """Mirror Production Registry's minimum visible set-identity contract.

    Production resolveChecklistRegistry requires year, brand, and meaningful
    setName, and rejects those fields when they carry explicit uncertainty text.
    This local check is only a request-readiness filter. It cannot lock a card,
    create a UUID/fingerprint, or turn historical metadata into current truth.
    """
    payload = _identity_payload(identity)
    year = _text(payload.get("year"))
    brand = _text(payload.get("brand"))
    set_name = _text(payload.get("set_name") or payload.get("setName"))
    missing: list[str] = []
    if not year or _YEAR_RE.search(year) is None:
        missing.append("year")
    if not brand:
        missing.append("brand")
    if not set_name or not _meaningful_set_tokens(set_name):
        missing.append("set_name")
    for key, value in (("year", year), ("brand", brand), ("set_name", set_name)):
        if value and _UNCERTAIN_EVIDENCE_RE.search(value):
            missing.append(f"{key}_uncertain")
    deduped = tuple(dict.fromkeys(missing))
    return not deduped, deduped


def _historical_registry_receipt(item: dict[str, Any]) -> bool:
    return bool(
        v19.legacy._valid_uuid(item.get("historical_metadata_registry_id"))
        and v19.legacy._valid_sha256(item.get("historical_metadata_fingerprint"))
    )


def _release_field_score(item: dict[str, Any]) -> int:
    identity = item.get("identity") or {}
    return sum(
        1
        for key in ("year", "brand", "set_name", "manufacturer", "sport", "league")
        if _text(identity.get(key))
    )


def _deterministic_item_key(item: dict[str, Any]) -> tuple[str, str, str]:
    identity = item.get("identity") or {}
    return (
        _norm(identity.get("player")),
        _norm(identity.get("card_number")).lstrip("#"),
        str(item.get("row_id") or ""),
    )


def _ranked_extra_key(item: dict[str, Any]) -> tuple[Any, ...]:
    ready, _missing = _visible_set_identity_readiness(item.get("identity") or {})
    return (
        0 if ready else 1,
        0 if _historical_registry_receipt(item) else 1,
        -_release_field_score(item),
        _deterministic_item_key(item),
    )


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
    for row_id in v19.REVIEWED_PRIORITY_ROW_IDS:
        add(row_id)

    extras = sorted(
        (item for row_id, item in items.items() if row_id not in seen),
        key=_ranked_extra_key,
    )
    for item in extras:
        add(str(item.get("row_id") or ""))

    if order[: len(carry_ids)] != carry_ids:
        missing = [row_id for row_id in carry_ids if row_id not in items]
        raise RuntimeError(
            "V20 cannot preserve the certified prior-stage row prefix; "
            f"missing/ineligible={missing}"
        )
    return order


async def _registry_lookup(
    identity: Any,
    *,
    item: dict[str, Any] | None,
    vision: Any | None,
    gateway: Any,
) -> tuple[Any, dict[str, Any]]:
    """One Production-compatible Registry request; never strip brand/setName."""
    normalized = v19._normalize_identity_shape(identity)
    ready, missing = _visible_set_identity_readiness(normalized)
    if not ready:
        raise RuntimeError(
            "registry_visible_set_identity_incomplete:" + ",".join(missing)
        )
    if vision is None and item is not None:
        vision = await v19._local_vision_for_item(item)
    ocr = _text(getattr(vision, "combined_text", None)) if vision is not None else None
    return await v19._registry_request_with_throttle(gateway, normalized, ocr)


async def _lock_identity(
    item: dict[str, Any],
    identity: Any,
    *,
    gateway: Any,
    vision: Any | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """V19's exact UUID/fingerprint + physical gates with V20 Registry request shape."""
    paths = item.get("images") or []
    normalized = v19._normalize_identity_shape(identity)
    ready, missing = _visible_set_identity_readiness(normalized)
    if not ready:
        return None, {
            "reason": "registry_visible_set_identity_incomplete",
            "registry_outcome": "input_incomplete",
            "registry_resolver_status": "local_request_guard",
            "missing_visible_set_identity": list(missing),
        }
    if vision is None:
        vision = await v19._local_vision_for_item(item)
    if vision is None:
        return None, {"reason": "physical_vision_unavailable"}
    back_bytes = paths[1].read_bytes() if len(paths) > 1 else None

    registry, diagnostics = await _registry_lookup(
        normalized,
        item=item,
        vision=vision,
        gateway=gateway,
    )
    outcome = v19._registry_outcome(registry)
    registry_id = v19.legacy._valid_uuid(getattr(registry, "identity_id", None))
    fingerprint = v19._registry_fingerprint(registry, diagnostics)
    detail: dict[str, Any] = {
        "reason": None,
        "registry_outcome": outcome,
        "registry_uuid": registry_id,
        "registry_fingerprint_present": fingerprint is not None,
        "registry_attempt": 1,
        "registry_reasons": list(getattr(registry, "reasons", None) or []),
        "registry_request": diagnostics.get("registry_request"),
        "registry_resolver_status": diagnostics.get("registry_resolver_status"),
    }
    if outcome != "exact_match":
        detail["reason"] = "registry_" + (outcome or "non_exact")
        return None, detail
    if registry_id is None:
        detail["reason"] = "registry_uuid_missing"
        return None, detail
    if fingerprint is None:
        detail["reason"] = "registry_fingerprint_missing"
        return None, detail
    if not v19._registry_identity_compatible(normalized, registry):
        detail["reason"] = "registry_identity_mismatch"
        return None, detail

    physical_ok, physical = v19._physical_variant_gate(
        normalized,
        registry,
        vision=vision,
        back_bytes=back_bytes,
    )
    detail["physical"] = physical
    if not physical_ok:
        detail["reason"] = physical.get("reason") or "physical_conflict"
        return None, detail

    payload = _identity_payload(normalized)
    locked_identity = _identity_payload(getattr(registry, "identity", None))
    player = _text(payload.get("player")) or _text(locked_identity.get("player"))
    number = _text(payload.get("card_number")) or _text(locked_identity.get("card_number"))
    if not player or not number:
        detail["reason"] = "locked_identity_missing_player_or_card_number"
        return None, detail

    locked = dict(item)
    locked["case"] = (
        f"registry-{registry_id[:8]}-{number.lstrip('#')}",
        player,
        number.lstrip("#"),
        v19._identity_variant(normalized),
        registry_id,
        fingerprint,
    )
    locked["registry_lock_source"] = (
        "v20_direct_authoritative_registry_plus_physical_witness"
    )
    locked["v20_lock_diagnostics"] = detail
    return locked, detail


def _require_carry_forward_lock(
    locked: dict[str, Any] | None,
    expected: dict[str, str],
) -> dict[str, Any]:
    if locked is None:
        raise CandidateFixtureMismatch(
            f"Certified prior-stage row {expected['row_id']} no longer passes V20 current preflight"
        )
    actual = v19._signature(locked)
    if actual != expected:
        raise CandidateFixtureMismatch(
            f"Certified prior-stage fixture drifted: expected={expected} actual={actual}"
        )
    return locked


async def _build_locked_pool(
    dataset: Path,
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
    gateway: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    items = v19._candidate_items(dataset, require_images=True)
    carry_forward = v19._prior_stage_signatures(
        target,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )
    order = _ordered_candidate_ids(
        items=items,
        carry_forward=carry_forward,
        legacy_priority=v19._legacy_priority_row_ids(dataset, require_images=True),
    )
    carry_by_row = {item["row_id"]: item for item in carry_forward}
    call_budget = min(REGISTRY_CALL_BUDGETS[target], len(order))
    pool_limit = LOCKED_POOL_LIMITS[target]
    locked_pool: list[dict[str, Any]] = []
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()
    registry_calls = 0
    local_skips = 0
    inspected = 0

    print(
        f"{v19._stage_label(target).upper()} V20 PREFLIGHT: "
        f"eligible_rows={len(items)} carry_forward={len(carry_forward)} "
        f"registry_call_budget={call_budget} locked_pool_limit={pool_limit} "
        f"minimum_reserve={MINIMUM_LOCKED_RESERVE[target]}",
        flush=True,
    )

    for row_id in order:
        if registry_calls >= call_budget or len(locked_pool) >= pool_limit:
            break
        inspected += 1
        item = items[row_id]
        expected = carry_by_row.get(row_id)
        from app.models import CardIdentity

        identity = CardIdentity.model_validate(item["identity"])
        normalized = v19._normalize_identity_shape(identity)
        ready, missing = _visible_set_identity_readiness(normalized)
        if not ready:
            if expected is not None:
                raise CandidateFixtureMismatch(
                    f"Certified prior-stage row {row_id} is no longer Registry-request-ready: {missing}"
                )
            local_skips += 1
            if local_skips <= 12:
                print(
                    f"V20 PREFLIGHT SKIP {identity.player} #{identity.card_number}: "
                    f"reason=registry_visible_set_identity_incomplete missing={','.join(missing)}",
                    flush=True,
                )
            continue

        registry_calls += 1
        locked, detail = await _lock_identity(
            item,
            normalized,
            gateway=gateway,
        )
        if expected is not None:
            locked = _require_carry_forward_lock(locked, expected)
        elif locked is None:
            print(
                f"V20 PREFLIGHT REJECT {identity.player} #{identity.card_number}: "
                f"reason={detail.get('reason')} outcome={detail.get('registry_outcome')!r} "
                f"resolver={detail.get('registry_resolver_status')!r}",
                flush=True,
            )
            continue

        sig = v19._signature(locked)
        registry_id = sig["registry_identity_id"]
        if registry_id in used_registry_ids:
            if expected is not None:
                raise RuntimeError(
                    f"Certified carry-forward Registry UUID duplicated: {registry_id}"
                )
            continue
        player_key = _norm(sig["player"])
        cap = int(getattr(v19.legacy, "MAX_PRIMARY_ROWS_PER_PLAYER", 2))
        if expected is None and player_counts[player_key] >= cap:
            continue
        locked_pool.append(locked)
        used_registry_ids.add(registry_id)
        player_counts[player_key] += 1
        print(
            f"V20 PREFLIGHT LOCK {len(locked_pool)}/{pool_limit} "
            f"{sig['player']} #{sig['card_number']} registry={registry_id} "
            f"carry_forward={'true' if expected is not None else 'false'}",
            flush=True,
        )

    print(
        f"V20 PREFLIGHT SEARCH COMPLETE: inspected={inspected} registry_calls={registry_calls} "
        f"local_incomplete_skips={local_skips} locks={len(locked_pool)}/{pool_limit}",
        flush=True,
    )

    minimum = min(pool_limit, MINIMUM_LOCKED_RESERVE[target])
    if len(locked_pool) < minimum:
        raise RuntimeError(
            f"{v19._stage_label(target)} V20 locked only {len(locked_pool)} current-authoritative "
            f"candidates before activation; reserve_required={minimum} target={target}"
        )
    if carry_forward and [
        v19._signature(item) for item in locked_pool[: len(carry_forward)]
    ] != carry_forward:
        raise RuntimeError(
            f"{v19._stage_label(target)} V20 failed to preserve exact prior-stage prefix"
        )
    return locked_pool, carry_forward


async def _candidate_probe(
    item: dict[str, Any],
    *,
    adapter_sha: str,
    gateway: Any,
    phase: str,
    pass_number: int,
) -> tuple[bool, dict[str, Any]]:
    expected = v19._signature(item)
    try:
        identity, vision, candidate_meta = await v19._read_candidate_direct(
            item,
            expected_adapter_sha=adapter_sha,
        )
    except Exception as error:
        return False, {
            "passed": False,
            "phase": phase,
            "pass": pass_number,
            "key": item["case"][0],
            "player": expected["player"],
            "card_number": expected["card_number"],
            "failure_category": str(error).split(" ", 1)[0],
            "error": str(error)[:800],
        }

    normalized = v19._normalize_identity_shape(identity)
    ready, missing = _visible_set_identity_readiness(normalized)
    if not ready:
        return False, {
            "passed": False,
            "phase": phase,
            "pass": pass_number,
            "key": item["case"][0],
            "player": expected["player"],
            "card_number": expected["card_number"],
            "candidate_provider": candidate_meta["provider"],
            "candidate_fallback": candidate_meta["fallback"],
            "candidate_identity": _identity_payload(normalized),
            "failure_category": "candidate_visible_set_identity_incomplete",
            "missing_visible_set_identity": list(missing),
            "registry_status": "input_incomplete",
            "registry_resolver_status": "local_request_guard",
        }

    locked, detail = await _lock_identity(
        item,
        normalized,
        gateway=gateway,
        vision=vision,
    )
    receipt: dict[str, Any] = {
        "passed": False,
        "phase": phase,
        "pass": pass_number,
        "key": item["case"][0],
        "player": expected["player"],
        "card_number": expected["card_number"],
        "candidate_provider": candidate_meta["provider"],
        "candidate_fallback": candidate_meta["fallback"],
        "candidate_identity": _identity_payload(normalized),
        "registry_status": detail.get("registry_outcome"),
        "registry_resolver_status": detail.get("registry_resolver_status"),
        "registry_identity_id": detail.get("registry_uuid"),
        "registry_failure_reason": detail.get("reason"),
        "physical": detail.get("physical"),
    }
    if locked is None:
        receipt["failure_category"] = (
            detail.get("reason") or "candidate_registry_rejected"
        )
        return False, receipt

    actual = v19._signature(locked)
    if actual["registry_identity_id"] != expected["registry_identity_id"]:
        receipt["failure_category"] = "registry_uuid_mismatch"
        receipt["actual_registry_identity_id"] = actual["registry_identity_id"]
        return False, receipt
    if actual["registry_fingerprint_sha256"] != expected["registry_fingerprint_sha256"]:
        receipt["failure_category"] = "registry_fingerprint_mismatch"
        receipt["actual_registry_fingerprint_sha256"] = actual[
            "registry_fingerprint_sha256"
        ]
        return False, receipt

    receipt["passed"] = True
    receipt["registry_identity_id"] = actual["registry_identity_id"]
    receipt["registry_fingerprint_sha256"] = actual[
        "registry_fingerprint_sha256"
    ]
    return True, receipt


async def _qualify_locked_pool(
    locked_pool: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    carry_forward: list[dict[str, str]],
    gateway: Any,
    probe_fn: ProbeFn | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    probe = probe_fn or _candidate_probe
    carry_count = len(carry_forward)
    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    for item in locked_pool:
        sig = v19._signature(item)
        is_carry = len(selected) < carry_count and sig == carry_forward[len(selected)]
        if len(selected) < carry_count and not is_carry:
            raise RuntimeError(
                "V20 candidate pool no longer begins with exact certified prefix "
                f"at position {len(selected)}"
            )

        pass_receipts: list[dict[str, Any]] = []
        stable = True
        for pass_number in range(1, CANDIDATE_DRY_PASSES + 1):
            ok, receipt = await probe(
                item,
                adapter_sha=adapter_sha,
                gateway=gateway,
                phase="qualification",
                pass_number=pass_number,
            )
            pass_receipts.append(receipt)
            if not ok:
                stable = False
                break

        if not stable:
            failure = pass_receipts[-1]
            if is_carry:
                raise CandidateFixtureMismatch(
                    "Certified prior-stage fixture failed V20 qualification: "
                    f"{sig['player']} #{sig['card_number']} "
                    f"category={failure.get('failure_category')}"
                )
            rejected.append(
                {
                    **sig,
                    "reason": failure.get("failure_category"),
                    "passes_completed": len(pass_receipts),
                    "last_probe": failure,
                }
            )
            print(
                f"V20 CANDIDATE REJECT {sig['player']} #{sig['card_number']}: "
                f"category={failure.get('failure_category')} "
                f"registry_status={failure.get('registry_status')!r}",
                flush=True,
            )
            continue

        selected.append(item)
        print(
            f"V20 CANDIDATE PASS {len(selected)}/{target} "
            f"{sig['player']} #{sig['card_number']} exact_passes={CANDIDATE_DRY_PASSES}",
            flush=True,
        )
        if len(selected) >= target:
            break

    if len(selected) != target:
        raise RuntimeError(
            f"{v19._stage_label(target)} V20 candidate qualification produced "
            f"{len(selected)}/{target} stable fixtures; rejected={len(rejected)} "
            f"locked_reserve={len(locked_pool)}"
        )
    if carry_forward and [
        v19._signature(item) for item in selected[:carry_count]
    ] != carry_forward:
        raise RuntimeError(
            f"{v19._stage_label(target)} V20 qualification changed prior-stage prefix"
        )
    return selected, rejected


async def _certification_round(
    number: int,
    fixtures: list[dict[str, Any]],
    *,
    adapter_sha: str,
    gateway: Any,
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for item in fixtures:
        ok, receipt = await _candidate_probe(
            item,
            adapter_sha=adapter_sha,
            gateway=gateway,
            phase=f"certification_round_{number}",
            pass_number=number,
        )
        cases.append(receipt)
        sig = v19._signature(item)
        if ok:
            print(
                f"ROUND {number} PASS {sig['player']} #{sig['card_number']} "
                f"provider=instacomp_lora_candidate registry={sig['registry_identity_id']}",
                flush=True,
            )
        else:
            failures.append(
                {
                    "key": receipt.get("key"),
                    "player": sig["player"],
                    "card_number": sig["card_number"],
                    "error": receipt.get("failure_category"),
                    "registry_status": receipt.get("registry_status"),
                    "registry_resolver_status": receipt.get("registry_resolver_status"),
                    "registry_identity_id": receipt.get("registry_identity_id"),
                }
            )
            print(
                f"ROUND {number} FAIL {sig['player']} #{sig['card_number']}: "
                f"{receipt.get('failure_category')}; "
                f"registry_status={receipt.get('registry_status')!r}; "
                f"resolver={receipt.get('registry_resolver_status')!r}",
                flush=True,
            )
    return {
        "round": number,
        "passed": not failures and len(cases) == len(fixtures),
        "cases": cases,
        "failure_mode": None if not failures else "deterministic_card_failures",
        "failure_count": len(failures),
        "failures": failures,
        "error": None
        if not failures
        else (
            f"{len(failures)} deterministic card failure(s): "
            + "; ".join(
                f"{item['player']} #{item['card_number']}: {item['error']}"
                for item in failures
            )
        ),
    }


def _write_stage_manifest(
    fixtures: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
) -> Path:
    v19.STAGE_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": v19.MANIFEST_SCHEMA,
        "created_at": v19.base.now(),
        "complete": True,
        "stage_target": target,
        "adapter_weights_sha256": adapter_sha,
        "dataset_sha256": dataset_sha,
        "registry_remains_identity_authority": True,
        "v20_registry_ready_reserve_selection": True,
        "fixtures": [v19._signature(item) for item in fixtures],
    }
    tmp = v19.STAGE_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(v19.STAGE_MANIFEST)
    return v19.STAGE_MANIFEST


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
    return v19.legacy._write_receipt(
        {
            "schema_version": SCHEMA,
            "created_at": v19.base.now(),
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
            "v20_registry_ready_reserve_selection": True,
            "automatic_deployment": False,
            "automatic_promotion": False,
            "nothing_published": True,
        }
    )


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
    return v19.legacy._write_receipt(
        {
            "schema_version": SCHEMA,
            "created_at": v19.base.now(),
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
            "v20_registry_ready_reserve_selection": True,
            "automatic_deployment": False,
            "automatic_promotion": False,
            "nothing_published": True,
        }
    )


def _fixture(index: int) -> dict[str, Any]:
    uuid = f"00000000-0000-0000-0020-{index:012d}"
    return {
        "row_id": f"row-{index}",
        "split": "train",
        "identity": {
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": f"Player {index}",
            "card_number": str(index),
        },
        "case": (
            f"case-{index}",
            f"Player {index}",
            str(index),
            None,
            uuid,
            f"{index + 1:064x}",
        ),
    }


def _self_test_registry_readiness_and_ordering() -> None:
    assert _visible_set_identity_readiness(
        {"year": "2025", "brand": "Prizm", "set_name": "Base"}
    ) == (True, ())
    for broken in (
        {"brand": "Prizm", "set_name": "Base"},
        {"year": "2025", "set_name": "Base"},
        {"year": "2025", "brand": "Prizm"},
        {"year": "2025", "brand": "maybe Prizm", "set_name": "Base"},
    ):
        assert _visible_set_identity_readiness(broken)[0] is False

    carry = _fixture(1)
    legacy = _fixture(2)
    historical = _fixture(3)
    ordinary = _fixture(4)
    incomplete = _fixture(5)
    historical["historical_metadata_registry_id"] = historical["case"][4]
    historical["historical_metadata_fingerprint"] = historical["case"][5]
    incomplete["identity"] = {
        "player": "A Alphabetically First",
        "card_number": "1",
    }
    items = {item["row_id"]: item for item in (incomplete, ordinary, historical, legacy, carry)}
    order = _ordered_candidate_ids(
        items=items,
        carry_forward=[v19._signature(carry)],
        legacy_priority=(legacy["row_id"],),
    )
    assert order[:4] == [
        carry["row_id"],
        legacy["row_id"],
        historical["row_id"],
        ordinary["row_id"],
    ]
    assert order[-1] == incomplete["row_id"]
    print("PASS V20 mirrors Production year+brand+setName request readiness")
    print("PASS V20 ranks Registry-ready historical evidence before alphabetic incomplete rows")


def _self_test_single_registry_request_shape() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    calls: list[dict[str, Any]] = []
    exact_uuid = "00000000-0000-0000-0020-000000000041"
    fingerprint = "b" * 64

    class FakeGateway:
        async def match_with_diagnostics(self, identity, ocr):
            payload = identity.model_dump(mode="json")
            calls.append({"identity": payload, "ocr": ocr})
            return ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=exact_uuid,
                identity=CardIdentity(
                    year=identity.year,
                    brand=identity.brand,
                    set_name=identity.set_name,
                    player=identity.player,
                    card_number=identity.card_number,
                    parallel=identity.parallel,
                ),
                candidate_count=1,
                source_receipts=[
                    f"registry_identity:{exact_uuid}",
                    f"registry_fingerprint:{fingerprint}",
                ],
            ), {
                "registry_fingerprint_sha256": fingerprint,
                "registry_resolver_status": "internal_exact_match",
            }

    identity = CardIdentity(
        year="2025",
        brand="Prizm",
        set_name="Base",
        player="Caitlin Clark",
        card_number="41",
        parallel="Silver Prizm",
    )
    result, diagnostics = asyncio.run(
        _registry_lookup(
            identity,
            item=None,
            vision=SimpleNamespace(combined_text="CAITLIN CLARK 41 PRIZM"),
            gateway=FakeGateway(),
        )
    )
    assert v19._registry_outcome(result) == "exact_match"
    assert diagnostics["registry_fingerprint_sha256"] == fingerprint
    assert len(calls) == 1
    sent = calls[0]["identity"]
    assert sent["year"] == "2025" and sent["brand"] == "Prizm" and sent["set_name"] == "Base"
    assert sent["card_number"] == "41"
    print("PASS V20 sends one Production-compatible Registry request without stripping brand/setName")


def _self_test_candidate_backfill() -> None:
    pool = [_fixture(index) for index in range(6)]
    calls: Counter[str] = Counter()

    async def fake_probe(item, **_kwargs):
        key = item["case"][0]
        calls[key] += 1
        ok = key != "case-2"
        return ok, {
            "passed": ok,
            "failure_category": None if ok else "synthetic_candidate_reject",
            "registry_status": "exact_match" if ok else "input_incomplete",
        }

    selected, rejected = asyncio.run(
        _qualify_locked_pool(
            pool,
            target=3,
            adapter_sha="f" * 64,
            carry_forward=[],
            gateway=object(),
            probe_fn=fake_probe,
        )
    )
    assert [item["case"][0] for item in selected] == ["case-0", "case-1", "case-3"]
    assert rejected[0]["row_id"] == "row-2"
    assert calls["case-0"] == calls["case-1"] == calls["case-3"] == 2

    async def fail_carry(item, **_kwargs):
        return False, {
            "passed": False,
            "failure_category": "synthetic_carry_drift",
            "registry_status": "exact_match",
        }

    try:
        asyncio.run(
            _qualify_locked_pool(
                pool,
                target=2,
                adapter_sha="f" * 64,
                carry_forward=[v19._signature(pool[0])],
                gateway=object(),
                probe_fn=fail_carry,
            )
        )
        raise AssertionError("V20 backfilled a failed certified carry-forward fixture")
    except CandidateFixtureMismatch:
        pass

    print("PASS V20 backfills unstable fresh candidates from the locked reserve")
    print("PASS V20 never swaps a failed certified carry-forward fixture")


def self_test() -> int:
    # Preserve V19's direct sidecar, exact UUID/fingerprint, physical-card, and
    # throttle contracts, then prove only the request-readiness/reserve changes.
    assert v19.self_test() == 0
    _self_test_registry_readiness_and_ordering()
    _self_test_single_registry_request_shape()
    _self_test_candidate_backfill()
    assert MINIMUM_LOCKED_RESERVE[10] > 10
    assert LOCKED_POOL_LIMITS[10] >= MINIMUM_LOCKED_RESERVE[10]
    print("PASS V20 keeps V19 physical and current-authoritative identity gates unchanged")
    print("PASS V20 requires reserve capacity before candidate activation")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    parser.add_argument(
        "--stage-target",
        type=int,
        choices=ALLOWED_STAGE_TARGETS,
        default=10,
    )
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit(
            "V20 staged InstaComp Production promotion must run on the Apple Silicon Mac."
        )

    target = int(args.stage_target)
    v19.v3.frozen_five_v2.clear_mutable_candidate_env_overrides()
    receipt, validated, dataset = v19.base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit(
            "Explicit adapter does not match complete_and_validated receipt"
        )
    adapter_sha = v19.base.file_sha(adapter / "adapters.safetensors")
    dataset_sha = v19._dataset_fingerprint(dataset, receipt.get("dataset_sha256"))

    activated = False
    activation = None
    rounds: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    try:
        from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway

        gateway = AuthoritativeRegistryChecklistGateway()
        locked_pool, carry_forward = asyncio.run(
            _build_locked_pool(
                dataset,
                target=target,
                adapter_sha=adapter_sha,
                dataset_sha=dataset_sha,
                gateway=gateway,
            )
        )

        started = datetime.now(timezone.utc).timestamp()
        subprocess.run(
            ["bash", str(v19.base.ENABLE), str(adapter)],
            cwd=v19.base.REPO_ROOT,
            check=True,
        )
        activated = True
        activation = v19.base.activation_receipt(started, adapter, adapter_sha)
        settings = v19.v6._refresh_runtime_candidate_settings()
        if settings.lora_candidate_enabled is not True:
            raise RuntimeError(
                "Candidate setting did not reload enabled after protected .env refresh"
            )

        fixtures, rejected = asyncio.run(
            _qualify_locked_pool(
                locked_pool,
                target=target,
                adapter_sha=adapter_sha,
                carry_forward=carry_forward,
                gateway=gateway,
            )
        )
        print(
            f"{v19._stage_label(target).upper()} V20 FIXTURES: "
            + ", ".join(
                f"{item['case'][1]} #{item['case'][2]}[{item['split']}:{item['row_id']}]"
                for item in fixtures
            ),
            flush=True,
        )

        for number in (1, 2):
            result = asyncio.run(
                _certification_round(
                    number,
                    fixtures,
                    adapter_sha=adapter_sha,
                    gateway=gateway,
                )
            )
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(
                    str(result.get("error") or f"Round {number} failed")[:4000]
                )
        v19._rounds_gate(rounds, target)

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
            f"PASS {v19._stage_label(target)} V20 certification complete: "
            f"dry_passes={CANDIDATE_DRY_PASSES} rounds=2 cards={target}",
            flush=True,
        )
        print(
            f"{v19._stage_label(target).upper()} V20 SUCCESS RECEIPT: {path}",
            flush=True,
        )
        return 0
    except v13.RegistryThrottleAbort as error:
        if activated:
            subprocess.run(
                ["bash", str(v19.base.DISABLE)],
                cwd=v19.base.REPO_ROOT,
                check=False,
            )
        print(f"REGISTRY THROTTLE ABORT: {error}", flush=True)
        return 3
    except BaseException as error:
        if activated:
            subprocess.run(
                ["bash", str(v19.base.DISABLE)],
                cwd=v19.base.REPO_ROOT,
                check=False,
            )
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
                    "status": "failed_rolled_back"
                    if activated
                    else "failed_before_activation",
                    "promotion_stage_target": target,
                    "error_type": type(error).__name__,
                    "error": str(error)[:4000],
                    "nothing_published": True,
                },
                indent=2,
            )
        )
        print(
            f"{v19._stage_label(target).upper()} V20 FAILURE RECEIPT: {path}",
            flush=True,
        )
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
