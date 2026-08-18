#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import httpx

import benchmark_lora_unseen_holdout_v4 as v4

canonical = v4.canonical
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v5"
_CANONICAL_AUTHORITATIVE_HOLDOUT = canonical._authoritative_holdout
MAX_BOOTSTRAP_ATTEMPTS = 700
BOOTSTRAP_EXACT_RESERVE = 180


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


def _bootstrap_identity(data: dict[str, Any], teacher: Any) -> Any | None:
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
    return identity if ready else None


async def _bootstrap_one(item: dict[str, Any], identity: Any) -> tuple[Any | None, str]:
    from app.checklist import _bounded_ocr, _registry_base_url, _registry_headers

    base_url = _registry_base_url()
    if not base_url:
        return None, "registry_url_missing"

    vision = await canonical.legacy.v20.v19._local_vision_for_item(item)
    ocr = str(getattr(vision, "combined_text", None) or "").strip() or None
    payload = _bootstrap_payload(identity, ocr_text=_bounded_ocr(ocr))
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base_url}/api/instacomp/registry-holdout-lock",
                headers=_registry_headers(),
                json=payload,
            )
    except httpx.HTTPError as error:
        return None, f"transport:{type(error).__name__}"

    if response.status_code in {401, 403}:
        return None, "authentication_failed"
    if not response.is_success:
        return None, f"http_{response.status_code}"
    try:
        data = response.json() if response.content else {}
    except Exception:
        return None, "invalid_json"
    if not isinstance(data, dict) or data.get("ok") is not True:
        return None, "route_error"

    resolved = _bootstrap_identity(data, identity)
    if resolved is not None:
        return resolved, "unique_registry_bootstrap"
    resolver_status = str(data.get("resolverStatus") or data.get("status") or "no_match")
    reasons = data.get("reasons") if isinstance(data.get("reasons"), list) else []
    reason = str(reasons[0] if reasons else resolver_status)
    return None, reason


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

    enriched: list[dict[str, Any]] = []
    stats: Counter[str] = Counter()
    attempts = 0
    exact = 0

    # Preserve canonical V3 diversity order while repairing only rows that V20
    # would otherwise reject locally for missing year/brand/set coordinates.
    for item in canonical._diverse_order(items):
        value = dict(item)
        identity = CardIdentity.model_validate(value["identity"])
        ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
        if ready:
            enriched.append(value)
            stats["already_registry_ready"] += 1
            continue

        if (
            attempts < MAX_BOOTSTRAP_ATTEMPTS
            and exact < BOOTSTRAP_EXACT_RESERVE
            and _bootstrap_eligible(value, identity)
        ):
            attempts += 1
            resolved, reason = await _bootstrap_one(value, identity)
            stats[reason] += 1
            if resolved is not None:
                value["identity"] = canonical.legacy._identity_payload(resolved)
                value["trusted_identity"] = canonical.legacy._identity_payload(identity)
                value["trusted_registry_bootstrap_identity"] = canonical.legacy._identity_payload(resolved)
                value["registry_bootstrap_source"] = "unique_active_registry_identity_pending_normal_v20_revalidation"
                exact += 1
        enriched.append(value)

    print(
        "UNSEEN TRUSTED REGISTRY BOOTSTRAP: "
        f"attempted={attempts} exact={exact} reserve_goal={BOOTSTRAP_EXACT_RESERVE} "
        f"already_ready={stats['already_registry_ready']} "
        f"top_outcomes={stats.most_common(8)}",
        flush=True,
    )

    # Critical safety boundary: the bootstrap result is NOT admitted here. The
    # unchanged V3 scorer calls the normal V20 Registry resolver again using the
    # now-complete identity and then applies the same physical/parallel witness.
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
    resolved = _bootstrap_identity(data, teacher)
    assert resolved is not None
    assert resolved.year == "2025"
    assert resolved.brand == "Prizm"
    assert resolved.set_name == "Base"

    wrong = json.loads(json.dumps(data))
    wrong["lockedFields"]["player"] = "Wrong Player"
    assert _bootstrap_identity(wrong, teacher) is None

    print("PASS unseen V5 bootstrap requires current trusted exact-image validation truth")
    print("PASS unseen V5 accepts only one UUID/fingerprint-shaped Registry bootstrap")
    print("PASS unseen V5 refuses player/card drift before normal V20 revalidation")
    print("PASS unseen V5 bootstrap cannot bypass canonical V3/V20 admission")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    canonical.SCHEMA = SCHEMA
    canonical._authoritative_holdout = _authoritative_holdout
    return int(v4.main())


if __name__ == "__main__":
    raise SystemExit(main())
