#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any

import httpx

import benchmark_lora_unseen_holdout_v4 as v4

canonical = v4.canonical
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v5"
_CANONICAL_AUTHORITATIVE_HOLDOUT = canonical._authoritative_holdout
MAX_BOOTSTRAP_ATTEMPTS = 1200
BOOTSTRAP_EXACT_RESERVE = 240
BOOTSTRAP_CONCURRENCY = 6
BOOTSTRAP_PROGRESS_EVERY = 20
BOOTSTRAP_HTTP_TIMEOUT_SECONDS = 12.0
BOOTSTRAP_ITEM_TIMEOUT_SECONDS = 20.0
BOOTSTRAP_WALL_BUDGET_SECONDS = 900.0


@dataclass(frozen=True)
class BootstrapTruth:
    identity: Any
    registry_id: str
    fingerprint: str
    reason: str


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _bootstrap_eligible(item: dict[str, Any], identity: Any) -> bool:
    source = str(item.get("benchmark_source") or "")
    truth_source = str(item.get("validation_truth_source") or "")
    if source != "locked_validation_holdout":
        return False
    if not truth_source.startswith("current_trusted_training_example_"):
        return False
    player = str(getattr(identity, "player", None) or "").strip()
    card_number = str(getattr(identity, "card_number", None) or "").strip().lstrip("#")
    return bool(player and card_number)


def _bootstrap_payload(identity: Any, *, ocr_text: str | None) -> dict[str, Any]:
    return {
        "year": getattr(identity, "year", None),
        "manufacturer": getattr(identity, "manufacturer", None),
        "brand": getattr(identity, "brand", None),
        "setName": getattr(identity, "set_name", None),
        "subset": getattr(identity, "subset", None),
        "cardNumber": getattr(identity, "card_number", None),
        "player": getattr(identity, "player", None),
        "team": getattr(identity, "team", None),
        "sport": getattr(identity, "sport", None),
        "league": getattr(identity, "league", None),
        "serialNumber": getattr(identity, "serial_number", None),
        "isAuto": getattr(identity, "autograph", None) is True,
        "isRelic": getattr(identity, "memorabilia", None) is True,
        "parallel": getattr(identity, "parallel", None),
        "variation": getattr(identity, "variation", None),
        "ocrText": ocr_text,
        "trustedHoldoutLookup": True,
    }


def _bootstrap_truth(data: dict[str, Any], teacher: Any) -> BootstrapTruth | None:
    from app.models import CardIdentity

    status = str(data.get("status") or "")
    registry_id = canonical.legacy.v20.v19.legacy._valid_uuid(
        data.get("registryIdentityId") or data.get("identityId")
    )
    fingerprint = canonical.legacy.v20.v19.legacy._valid_sha256(
        data.get("registryFingerprintSha256") or data.get("fingerprintSha256")
    )
    locked = data.get("lockedFields") if isinstance(data.get("lockedFields"), dict) else {}
    if status != "exact_match" or registry_id is None or fingerprint is None or not locked:
        return None

    player = str(locked.get("player") or "").strip()
    card_number = str(locked.get("cardNumber") or locked.get("card_number") or "").strip().lstrip("#")
    if _norm(player) != _norm(getattr(teacher, "player", None)):
        return None
    if _norm(card_number) != _norm(str(getattr(teacher, "card_number", None) or "").lstrip("#")):
        return None

    payload = {
        "sport": locked.get("sport") or getattr(teacher, "sport", None),
        "league": locked.get("league") or getattr(teacher, "league", None),
        "year": locked.get("year") or getattr(teacher, "year", None),
        "manufacturer": locked.get("manufacturer") or getattr(teacher, "manufacturer", None),
        "brand": locked.get("brand") or getattr(teacher, "brand", None),
        "set_name": locked.get("setName") or locked.get("set_name") or getattr(teacher, "set_name", None),
        "subset": getattr(teacher, "subset", None),
        "player": player,
        "team": locked.get("team") or getattr(teacher, "team", None),
        "card_number": card_number,
        "parallel": locked.get("parallel") or getattr(teacher, "parallel", None),
        "variation": locked.get("variation") or getattr(teacher, "variation", None),
        "serial_number": getattr(teacher, "serial_number", None),
        "serial_run": locked.get("serialRun") or getattr(teacher, "serial_run", None),
        "rookie": getattr(teacher, "rookie", None),
        "autograph": locked.get("isAuto") if isinstance(locked.get("isAuto"), bool) else getattr(teacher, "autograph", None),
        "inscription": getattr(teacher, "inscription", None),
        "inscription_text": getattr(teacher, "inscription_text", None),
        "memorabilia": locked.get("isRelic") if isinstance(locked.get("isRelic"), bool) else getattr(teacher, "memorabilia", None),
        "memorabilia_type": getattr(teacher, "memorabilia_type", None),
    }
    identity = CardIdentity.model_validate(payload)
    ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
    if not ready:
        return None
    mode = str(data.get("bootstrapMode") or "unique_registry_bootstrap")
    return BootstrapTruth(
        identity=identity,
        registry_id=registry_id,
        fingerprint=fingerprint,
        reason=f"unique_registry_bootstrap:{mode}",
    )


async def _bootstrap_one(
    client: httpx.AsyncClient,
    item: dict[str, Any],
    identity: Any,
) -> tuple[BootstrapTruth | None, str]:
    from app.checklist import _bounded_ocr, _registry_base_url, _registry_headers

    base_url = _registry_base_url()
    if not base_url:
        return None, "registry_url_missing"

    vision = await canonical.legacy.v20.v19._local_vision_for_item(item)
    ocr = str(getattr(vision, "combined_text", None) or "").strip() or None
    payload = _bootstrap_payload(identity, ocr_text=_bounded_ocr(ocr))
    try:
        response = await client.post(
            f"{base_url}/api/instacomp/registry-holdout-lock",
            headers=_registry_headers(),
            json=payload,
        )
    except httpx.HTTPError as error:
        return None, f"transport:{type(error).__name__}"

    try:
        data = response.json() if response.content else {}
    except Exception:
        data = {}
    if response.status_code in {401, 403}:
        return None, "authentication_failed"
    if not response.is_success:
        detail = ""
        if isinstance(data, dict):
            detail = str(data.get("error") or data.get("reasons") or "")
        detail = " ".join(detail.split())[:120]
        return None, f"http_{response.status_code}:{detail}" if detail else f"http_{response.status_code}"
    if not isinstance(data, dict) or data.get("ok") is not True:
        return None, "route_error"

    resolved = _bootstrap_truth(data, identity)
    if resolved is not None:
        return resolved, resolved.reason
    resolver_status = str(data.get("resolverStatus") or data.get("status") or "no_match")
    reasons = data.get("reasons") if isinstance(data.get("reasons"), list) else []
    reason = str(reasons[0] if reasons else resolver_status)
    return None, reason


def _bootstrap_order(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from app.models import CardIdentity

    ordered = canonical._diverse_order(items)
    incomplete: list[dict[str, Any]] = []
    ready: list[dict[str, Any]] = []
    for item in ordered:
        identity = CardIdentity.model_validate(item["identity"])
        is_ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
        (ready if is_ready else incomplete).append(item)
    return incomplete + ready


async def _authoritative_holdout(
    items: list[dict[str, Any]],
    *,
    target: int,
    registry_call_budget: int,
    gateway: Any,
    train_ids: set[str],
    all_dataset_ids: set[str],
    frozen_row_ids: set[str],
):
    from app.models import CardIdentity

    replacements: dict[str, BootstrapTruth] = {}
    stats: Counter[str] = Counter()
    exact = 0

    work: list[tuple[dict[str, Any], Any, bool]] = []
    for item in _bootstrap_order(items):
        identity = CardIdentity.model_validate(item["identity"])
        ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
        if ready:
            stats["already_registry_ready"] += 1
        if _bootstrap_eligible(item, identity):
            work.append((item, identity, ready))
        if len(work) >= MAX_BOOTSTRAP_ATTEMPTS:
            break

    print(
        "UNSEEN TRUSTED REGISTRY BOOTSTRAP START: "
        f"eligible={len(work)} concurrency={BOOTSTRAP_CONCURRENCY} "
        f"item_timeout={BOOTSTRAP_ITEM_TIMEOUT_SECONDS:.0f}s "
        f"http_timeout={BOOTSTRAP_HTTP_TIMEOUT_SECONDS:.0f}s "
        f"wall_budget={BOOTSTRAP_WALL_BUDGET_SECONDS:.0f}s",
        flush=True,
    )

    started = time.monotonic()
    attempts = 0
    semaphore = asyncio.Semaphore(BOOTSTRAP_CONCURRENCY)
    timeout = httpx.Timeout(BOOTSTRAP_HTTP_TIMEOUT_SECONDS)
    limits = httpx.Limits(
        max_connections=BOOTSTRAP_CONCURRENCY,
        max_keepalive_connections=BOOTSTRAP_CONCURRENCY,
    )

    async def run_one(
        client: httpx.AsyncClient,
        item: dict[str, Any],
        identity: Any,
    ) -> tuple[BootstrapTruth | None, str]:
        async with semaphore:
            try:
                return await asyncio.wait_for(
                    _bootstrap_one(client, item, identity),
                    timeout=BOOTSTRAP_ITEM_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                return None, "bootstrap_item_timeout"

    async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
        for batch_start in range(0, len(work), BOOTSTRAP_PROGRESS_EVERY):
            elapsed = time.monotonic() - started
            if exact >= BOOTSTRAP_EXACT_RESERVE:
                stats["bootstrap_exact_reserve_reached"] += 1
                break
            if elapsed >= BOOTSTRAP_WALL_BUDGET_SECONDS:
                stats["bootstrap_wall_budget_exhausted"] += 1
                print(
                    "UNSEEN TRUSTED REGISTRY BOOTSTRAP WATCHDOG: "
                    f"wall budget reached after {elapsed:.1f}s; continuing fail-closed with "
                    f"attempted={attempts} exact={exact}",
                    flush=True,
                )
                break

            batch = work[batch_start : batch_start + BOOTSTRAP_PROGRESS_EVERY]
            results = await asyncio.gather(
                *(run_one(client, item, identity) for item, identity, _ready in batch)
            )
            attempts += len(batch)

            for (item, _identity, ready), (resolved, reason) in zip(batch, results, strict=True):
                stats[reason] += 1
                if resolved is None or exact >= BOOTSTRAP_EXACT_RESERVE:
                    continue
                row_id = str(item.get("row_id") or "")
                if not row_id:
                    continue
                replacements[row_id] = resolved
                exact += 1
                stats["bootstrap_receipt_preserved"] += 1
                stats["bootstrap_incomplete" if not ready else "bootstrap_ready"] += 1

            elapsed = time.monotonic() - started
            rate = attempts / elapsed if elapsed > 0 else 0.0
            print(
                "UNSEEN TRUSTED REGISTRY BOOTSTRAP PROGRESS: "
                f"attempted={attempts}/{len(work)} exact={exact}/{BOOTSTRAP_EXACT_RESERVE} "
                f"receipt_preserved={stats['bootstrap_receipt_preserved']} "
                f"elapsed={elapsed:.1f}s rate={rate:.2f}/s "
                f"recent_top={stats.most_common(5)}",
                flush=True,
            )

    enriched: list[dict[str, Any]] = []
    for item in items:
        value = dict(item)
        row_id = str(value.get("row_id") or "")
        replacement = replacements.get(row_id)
        if replacement is not None:
            original = CardIdentity.model_validate(value["identity"])
            value["trusted_prebootstrap_identity"] = canonical.legacy._identity_payload(original)
            value["identity"] = canonical.legacy._identity_payload(replacement.identity)
            value["trusted_registry_bootstrap_identity"] = canonical.legacy._identity_payload(replacement.identity)
            value["historical_metadata_registry_id"] = replacement.registry_id
            value["historical_metadata_fingerprint"] = replacement.fingerprint
            value["registry_bootstrap_source"] = (
                "unique_active_registry_identity_with_current_receipt_pending_normal_v20_revalidation"
            )
        enriched.append(value)

    elapsed = time.monotonic() - started
    print(
        "UNSEEN TRUSTED REGISTRY BOOTSTRAP: "
        f"attempted={attempts} exact={exact} reserve_goal={BOOTSTRAP_EXACT_RESERVE} "
        f"already_ready={stats['already_registry_ready']} "
        f"receipt_preserved={stats['bootstrap_receipt_preserved']} "
        f"bootstrapped_incomplete={stats['bootstrap_incomplete']} "
        f"bootstrapped_ready={stats['bootstrap_ready']} elapsed={elapsed:.1f}s "
        f"top_outcomes={stats.most_common(12)}",
        flush=True,
    )

    return await _CANONICAL_AUTHORITATIVE_HOLDOUT(
        enriched,
        target=target,
        registry_call_budget=registry_call_budget,
        gateway=gateway,
        train_ids=train_ids,
        all_dataset_ids=all_dataset_ids,
        frozen_row_ids=frozen_row_ids,
    )


def _self_test() -> int:
    assert v4._self_test() == 0

    from types import SimpleNamespace

    teacher = SimpleNamespace(
        sport="Basketball",
        league="WNBA",
        year=None,
        manufacturer=None,
        brand=None,
        set_name=None,
        subset=None,
        player="Truth Player",
        team=None,
        card_number="77",
        parallel="Base",
        variation=None,
        serial_number=None,
        serial_run=None,
        rookie=None,
        autograph=False,
        inscription=None,
        inscription_text=None,
        memorabilia=False,
        memorabilia_type=None,
    )
    item = {
        "benchmark_source": "locked_validation_holdout",
        "validation_truth_source": "current_trusted_training_example_exact_id_and_image_hash",
    }
    assert _bootstrap_eligible(item, teacher)

    data = {
        "status": "exact_match",
        "bootstrapMode": "strict_release_evidence",
        "registryIdentityId": "11111111-1111-4111-8111-111111111111",
        "registryFingerprintSha256": "a" * 64,
        "lockedFields": {
            "sport": "Basketball",
            "league": "WNBA",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Prizm",
            "setName": "Base",
            "player": "Truth Player",
            "cardNumber": "77",
            "parallel": "Base",
            "isAuto": False,
            "isRelic": False,
        },
    }
    resolved = _bootstrap_truth(data, teacher)
    assert resolved is not None
    assert resolved.identity.year == "2025"
    assert resolved.identity.brand == "Prizm"
    assert resolved.identity.set_name == "Base"
    assert resolved.registry_id == data["registryIdentityId"]
    assert resolved.fingerprint == data["registryFingerprintSha256"]

    wrong = json.loads(json.dumps(data))
    wrong["lockedFields"]["player"] = "Wrong Player"
    assert _bootstrap_truth(wrong, teacher) is None

    incomplete_item = {
        "row_id": "incomplete",
        "identity": {
            "sport": "Basketball",
            "player": "Truth Player",
            "card_number": "77",
            "parallel": "Base",
        },
    }
    ready_item = {
        "row_id": "ready",
        "identity": {
            "sport": "Basketball",
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "Truth Player",
            "card_number": "77",
            "parallel": "Base",
        },
    }
    assert [value["row_id"] for value in _bootstrap_order([ready_item, incomplete_item])] == [
        "incomplete",
        "ready",
    ]
    assert BOOTSTRAP_CONCURRENCY > 1
    assert BOOTSTRAP_PROGRESS_EVERY <= 20
    assert BOOTSTRAP_HTTP_TIMEOUT_SECONDS < 30.0
    assert BOOTSTRAP_ITEM_TIMEOUT_SECONDS <= 20.0
    assert BOOTSTRAP_WALL_BUDGET_SECONDS <= 900.0

    print("PASS unseen V5 bootstrap requires current trusted exact-image validation truth")
    print("PASS unseen V5 accepts only one UUID/fingerprint-shaped Registry bootstrap")
    print("PASS unseen V5 preserves current bootstrap UUID/fingerprint for normal V20 receipt revalidation")
    print("PASS unseen V5 prioritizes locally incomplete trusted rows before already-ready rows")
    print("PASS unseen V5 bootstrap reuses bounded parallel HTTP with hard per-item timeout")
    print("PASS unseen V5 bootstrap emits progress and has a hard wall-clock watchdog")
    print("PASS unseen V5 may repair stale release coordinates only through one unique identity")
    print("PASS unseen V5 refuses player/card drift before normal V20 revalidation")
    print("PASS unseen V5 bootstrap cannot bypass canonical V3/V20 admission")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    v4.SCHEMA = SCHEMA
    canonical.SCHEMA = SCHEMA
    canonical._authoritative_holdout = _authoritative_holdout
    return int(v4.main())


if __name__ == "__main__":
    raise SystemExit(main())
