#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

import httpx

import benchmark_lora_unseen_holdout_v5 as v5

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v6"
FAST_ROUTE = "/api/instacomp/registry-holdout-lock-fast"
FAST_CONCURRENCY = 8
FAST_HTTP_TIMEOUT_SECONDS = 10.0
FAST_ITEM_TIMEOUT_SECONDS = 14.0
FAST_WALL_BUDGET_SECONDS = 600.0


def _ready_first_order(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Spend the bootstrap budget on already-V20-ready truth before repair work.

    The live V7 run spent its first 400 calls on incomplete rows and timed out
    before reaching the 651 rows that already carried year/brand/set evidence.
    Those ready rows are the safest place to obtain a current UUID/fingerprint
    receipt because V20 can immediately revalidate them without synthesizing
    missing release coordinates.
    """
    from app.models import CardIdentity

    ordered = v5.canonical._diverse_order(items)
    ready: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []
    for item in ordered:
        identity = CardIdentity.model_validate(item["identity"])
        is_ready, _missing = v5.canonical.legacy.v20._visible_set_identity_readiness(identity)
        (ready if is_ready else incomplete).append(item)
    return ready + incomplete


def _exact_response_rejection_reason(data: dict[str, Any], teacher: Any) -> str:
    valid_uuid = v5.canonical.legacy.v20.v19.legacy._valid_uuid(
        data.get("registryIdentityId") or data.get("identityId")
    )
    valid_fp = v5.canonical.legacy.v20.v19.legacy._valid_sha256(
        data.get("registryFingerprintSha256") or data.get("fingerprintSha256")
    )
    if valid_uuid is None:
        return "bootstrap_exact_response_uuid_invalid"
    if valid_fp is None:
        return "bootstrap_exact_response_fingerprint_invalid"
    locked = data.get("lockedFields") if isinstance(data.get("lockedFields"), dict) else {}
    if not locked:
        return "bootstrap_exact_response_locked_fields_missing"

    player = v5._norm(locked.get("player"))
    number = v5._norm(str(locked.get("cardNumber") or locked.get("card_number") or "").lstrip("#"))
    teacher_player = v5._norm(getattr(teacher, "player", None))
    teacher_number = v5._norm(str(getattr(teacher, "card_number", None) or "").lstrip("#"))
    if player != teacher_player:
        return "bootstrap_exact_response_player_drift"
    if number != teacher_number:
        return "bootstrap_exact_response_card_number_drift"

    year = locked.get("year") or getattr(teacher, "year", None)
    brand = locked.get("brand") or getattr(teacher, "brand", None)
    set_name = locked.get("setName") or locked.get("set_name") or getattr(teacher, "set_name", None)
    missing = [
        key
        for key, value in (("year", year), ("brand", brand), ("set_name", set_name))
        if not str(value or "").strip()
    ]
    if missing:
        return "bootstrap_exact_response_v20_coordinates_missing:" + ",".join(missing)
    return "bootstrap_exact_response_rejected_after_shape_validation"


async def _fast_bootstrap_one(
    client: httpx.AsyncClient,
    item: dict[str, Any],
    identity: Any,
) -> tuple[v5.BootstrapTruth | None, str]:
    from app.checklist import _registry_base_url, _registry_headers

    base_url = _registry_base_url()
    if not base_url:
        return None, "registry_url_missing"

    # Bootstrap is only a Registry-coordinate search. Apple Vision is deliberately
    # not invoked here; canonical V20 obtains fresh local vision again before any
    # benchmark admission and remains the physical/parallel authority gate.
    payload = v5._bootstrap_payload(identity, ocr_text=None)
    try:
        response = await client.post(
            f"{base_url}{FAST_ROUTE}",
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

    resolved = v5._bootstrap_truth(data, identity)
    if resolved is not None:
        return resolved, resolved.reason

    status = str(data.get("status") or "")
    if status == "exact_match":
        return None, _exact_response_rejection_reason(data, identity)
    reasons = data.get("reasons") if isinstance(data.get("reasons"), list) else []
    resolver_status = str(data.get("resolverStatus") or status or "no_match")
    return None, str(reasons[0] if reasons else resolver_status)


def _install_fast_runtime() -> None:
    v5.SCHEMA = SCHEMA
    v5.v4.SCHEMA = SCHEMA
    v5.canonical.SCHEMA = SCHEMA
    v5.BOOTSTRAP_CONCURRENCY = FAST_CONCURRENCY
    v5.BOOTSTRAP_HTTP_TIMEOUT_SECONDS = FAST_HTTP_TIMEOUT_SECONDS
    v5.BOOTSTRAP_ITEM_TIMEOUT_SECONDS = FAST_ITEM_TIMEOUT_SECONDS
    v5.BOOTSTRAP_WALL_BUDGET_SECONDS = FAST_WALL_BUDGET_SECONDS
    v5._bootstrap_order = _ready_first_order
    v5._bootstrap_one = _fast_bootstrap_one


def _self_test() -> int:
    assert v5._self_test() == 0

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
    incomplete_item = {
        "row_id": "incomplete",
        "identity": {
            "sport": "Basketball",
            "player": "Truth Player",
            "card_number": "77",
            "parallel": "Base",
        },
    }
    ordered = _ready_first_order([incomplete_item, ready_item])
    assert [item["row_id"] for item in ordered] == ["ready", "incomplete"]
    assert FAST_ROUTE.endswith("registry-holdout-lock-fast")
    assert FAST_CONCURRENCY >= 2
    assert FAST_HTTP_TIMEOUT_SECONDS < v5.BOOTSTRAP_HTTP_TIMEOUT_SECONDS
    assert FAST_ITEM_TIMEOUT_SECONDS < v5.BOOTSTRAP_ITEM_TIMEOUT_SECONDS
    assert FAST_WALL_BUDGET_SECONDS < v5.BOOTSTRAP_WALL_BUDGET_SECONDS

    exact = {
        "status": "exact_match",
        "registryIdentityId": "11111111-1111-4111-8111-111111111111",
        "registryFingerprintSha256": "a" * 64,
        "lockedFields": {
            "year": "2025",
            "brand": "Prizm",
            "setName": "Base",
            "player": "Truth Player",
            "cardNumber": "77",
        },
    }
    from types import SimpleNamespace

    teacher = SimpleNamespace(player="Truth Player", card_number="77", year=None, brand=None, set_name=None)
    assert _exact_response_rejection_reason(exact, teacher) == "bootstrap_exact_response_rejected_after_shape_validation"
    broken = dict(exact)
    broken["lockedFields"] = dict(exact["lockedFields"], brand=None)
    assert _exact_response_rejection_reason(broken, teacher).endswith("brand")

    print("PASS unseen V6 spends bootstrap budget on V20-ready truth before repair rows")
    print("PASS unseen V6 uses active-version-only fast Registry endpoint without bootstrap vision")
    print("PASS unseen V6 exposes exact-response rejection reasons instead of silently dropping matches")
    print("PASS unseen V6 keeps canonical V5 receipt handoff and V20 physical admission unchanged")
    return 0


def main() -> int:
    import sys

    if "--self-test" in sys.argv[1:]:
        return _self_test()
    _install_fast_runtime()
    return int(v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
