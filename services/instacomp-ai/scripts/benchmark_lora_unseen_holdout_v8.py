#!/usr/bin/env python3
from __future__ import annotations

import asyncio
from typing import Any

import httpx

import benchmark_lora_unseen_holdout_v7 as v7

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v8"
SCOPED_FAST_ROUTE = "/api/instacomp/registry-holdout-lock-scoped"
RECOVERY_CONCURRENCY = 3
RECOVERY_MAX_ATTEMPTS = 300
RECOVERY_HTTP_TIMEOUT_SECONDS = 5.0
RECOVERY_ITEM_TIMEOUT_SECONDS = 7.0

canonical = v7.canonical
_ORIGINAL_LOCK_IDENTITY = canonical.legacy.v20._lock_identity
_ORIGINAL_FAST_BOOTSTRAP_ONE = v7.v6._fast_bootstrap_one
_recovery_semaphore = asyncio.Semaphore(RECOVERY_CONCURRENCY)
_recovery_attempts = 0

_COORDINATE_RECOVERY_REASONS = frozenset(
    {
        "trusted_holdout_scoped_set_not_found",
        "trusted_holdout_scoped_release_not_found",
        "trusted_holdout_scoped_registry_no_identity_matches_visible_truth",
        "trusted_holdout_scoped_card_number_absent_from_release_scope",
    }
)


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _should_attempt_recovery(detail: dict[str, Any], identity: Any) -> bool:
    """Recover only a server-side input mismatch for locally V20-ready truth."""
    ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(identity)
    return ready and str(detail.get("reason") or "") == "registry_input_incomplete"


def _broad_release_scope_token(identity: Any) -> str | None:
    """Choose visible release-level text that widens only stale logical-set coordinates."""
    payload = canonical.legacy.v20.v19._identity_payload(identity)
    for key in ("brand", "league", "sport", "manufacturer"):
        value = str(payload.get(key) or "").strip()
        if value and canonical.legacy.v20._meaningful_set_tokens(value):
            return value
    return None


def _coordinate_recovery_candidates(identity: Any) -> list[tuple[str, Any]]:
    """Build bounded fail-closed retries for stale release/set packaging only.

    Every candidate keeps year, player, card number, parallel/variation, serial,
    autograph/relic, and sport. We may widen logical set to release-level visible
    text, prefer manufacturer when brand coordinates drift, and drop league only
    as a final release-coordinate relaxation. The scoped server must still return
    exactly one current Registry UUID/fingerprint before V20 receipt revalidation.
    """
    from app.models import CardIdentity

    source = canonical.legacy.v20.v19._identity_payload(identity)
    broad_set = _broad_release_scope_token(identity)
    manufacturer = str(source.get("manufacturer") or "").strip() or None
    brand = str(source.get("brand") or "").strip() or None
    league = str(source.get("league") or "").strip() or None

    candidates: list[tuple[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    def add(label: str, **updates: Any) -> None:
        payload = dict(source)
        payload.update(updates)
        candidate = CardIdentity.model_validate(payload)
        ready, _missing = canonical.legacy.v20._visible_set_identity_readiness(candidate)
        if not ready:
            return
        key = (
            _norm(getattr(candidate, "brand", None)),
            _norm(getattr(candidate, "set_name", None)),
            _norm(getattr(candidate, "league", None)),
        )
        original_key = (
            _norm(getattr(identity, "brand", None)),
            _norm(getattr(identity, "set_name", None)),
            _norm(getattr(identity, "league", None)),
        )
        if key == original_key or key in seen:
            return
        seen.add(key)
        candidates.append((label, candidate))

    if broad_set:
        add("release_scope_set", set_name=broad_set)

    if league:
        add("league_relaxed", league=None)
        if broad_set:
            add("release_scope_set_league_relaxed", set_name=broad_set, league=None)

    if manufacturer and _norm(manufacturer) != _norm(brand):
        add("manufacturer_brand_scope", brand=manufacturer, league=None)
        if broad_set:
            add(
                "manufacturer_brand_release_scope_set",
                brand=manufacturer,
                set_name=broad_set,
                league=None,
            )

    return candidates[:4]


async def _coordinate_recovering_fast_bootstrap_one(
    client: httpx.AsyncClient,
    item: dict[str, Any],
    identity: Any,
):
    """Strict scoped bootstrap first, then bounded stale-coordinate recovery.

    This never accepts a broadened query directly. The server must still resolve
    one unique current identity, and callers preserve the normal V20
    UUID/fingerprint receipt revalidation plus physical witness admission.
    """
    resolved, reason = await _ORIGINAL_FAST_BOOTSTRAP_ONE(client, item, identity)
    if resolved is not None or reason not in _COORDINATE_RECOVERY_REASONS:
        return resolved, reason

    trail = [reason]
    for label, candidate in _coordinate_recovery_candidates(identity):
        recovered, recovered_reason = await _ORIGINAL_FAST_BOOTSTRAP_ONE(
            client,
            item,
            candidate,
        )
        trail.append(f"{label}:{recovered_reason}")
        if recovered is not None:
            return recovered, f"coordinate_recovery:{label}:{recovered.reason}"

    return None, "coordinate_recovery_exhausted:" + "|".join(trail[:5])


async def _recovering_lock_identity(
    item: dict[str, Any],
    identity: Any,
    *,
    gateway: Any,
    vision: Any | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """Recover one current receipt, then require normal V20 revalidation + physics.

    The first pass is the unchanged canonical V20 lock. Only when Production says
    input_incomplete for an identity that the local V20 readiness contract says is
    complete do we ask the release-scoped holdout resolver for one exact current
    Registry UUID/fingerprint. The scoped bootstrap may make bounded
    stale-coordinate retries, but no broadened result is authoritative by itself:
    the UUID/fingerprint is immediately sent back through /registry-lock receipt
    revalidation and the unchanged V20 physical witness gate. Ambiguity, stale
    receipts, fingerprint drift, physical conflicts, timeouts, and every other
    failure remain fail-closed.
    """
    global _recovery_attempts

    normalized = canonical.legacy.v20.v19._normalize_identity_shape(identity)
    if vision is None:
        vision = await canonical.legacy.v20.v19._local_vision_for_item(item)

    locked, detail = await _ORIGINAL_LOCK_IDENTITY(
        item,
        normalized,
        gateway=gateway,
        vision=vision,
    )
    if locked is not None or not _should_attempt_recovery(detail, normalized):
        return locked, detail

    # A row that already carried a trusted historical receipt has already had
    # canonical receipt revalidation plus resolver fallback. Do not nest or
    # replace that authority path with a second bootstrap receipt.
    if isinstance(gateway, canonical._ReceiptAwareGateway):
        value = dict(detail)
        value["registry_input_recovery"] = "skipped_existing_receipt_path"
        return None, value

    if _recovery_attempts >= RECOVERY_MAX_ATTEMPTS:
        value = dict(detail)
        value["registry_input_recovery"] = "attempt_budget_exhausted"
        return None, value

    async with _recovery_semaphore:
        if _recovery_attempts >= RECOVERY_MAX_ATTEMPTS:
            value = dict(detail)
            value["registry_input_recovery"] = "attempt_budget_exhausted"
            return None, value
        _recovery_attempts += 1
        attempt = _recovery_attempts

        timeout = httpx.Timeout(RECOVERY_HTTP_TIMEOUT_SECONDS)
        limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)
        try:
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                bootstrap, bootstrap_reason = await asyncio.wait_for(
                    v7.v6._fast_bootstrap_one(client, item, normalized),
                    timeout=RECOVERY_ITEM_TIMEOUT_SECONDS,
                )
        except TimeoutError:
            value = dict(detail)
            value.update(
                {
                    "registry_input_recovery_attempted": True,
                    "registry_input_recovery_attempt": attempt,
                    "registry_input_recovery": "bootstrap_timeout",
                }
            )
            return None, value

    if bootstrap is None:
        value = dict(detail)
        value.update(
            {
                "registry_input_recovery_attempted": True,
                "registry_input_recovery_attempt": attempt,
                "registry_input_recovery": f"bootstrap_reject:{bootstrap_reason}",
            }
        )
        return None, value

    receipt_gateway = canonical._ReceiptAwareGateway(
        gateway,
        bootstrap.registry_id,
        bootstrap.fingerprint,
    )
    retried, retry_detail = await _ORIGINAL_LOCK_IDENTITY(
        item,
        bootstrap.identity,
        gateway=receipt_gateway,
        vision=vision,
    )
    accepted = bool(
        receipt_gateway.last_diagnostics.get("registry_receipt_revalidation_accepted")
    )
    merged = dict(retry_detail)
    merged.update(
        {
            "registry_input_recovery_attempted": True,
            "registry_input_recovery_attempt": attempt,
            "registry_input_recovery_bootstrap_reason": bootstrap.reason,
            "registry_input_recovery_registry_id": bootstrap.registry_id,
            "registry_input_recovery_receipt_revalidation_accepted": accepted,
        }
    )

    # The recovery branch is intentionally stricter than ordinary resolution:
    # the bootstrap UUID/fingerprint must itself survive CURRENT receipt
    # revalidation. A fallback exact resolver result is not enough here.
    if retried is None or not accepted:
        if retried is not None and not accepted:
            merged["reason"] = "registry_bootstrap_receipt_revalidation_not_accepted"
        merged["registry_input_recovery"] = "canonical_revalidation_or_physical_reject"
        return None, merged

    retried["registry_lock_source"] = (
        "current_registry_bootstrap_receipt_revalidated_plus_v20_physical_witness"
    )
    merged["registry_input_recovery"] = "accepted"
    return retried, merged


def _install_runtime() -> None:
    # Install the coordinate wrapper before V7/V6 wires V5's bootstrap function.
    # Then explicitly preserve it after install so both initial bootstrap and V8
    # input-incomplete recovery share the exact same bounded scoped behavior.
    v7.v6._fast_bootstrap_one = _coordinate_recovering_fast_bootstrap_one
    v7._install_runtime()
    v7.v6.FAST_ROUTE = SCOPED_FAST_ROUTE
    v7.v6.v5._bootstrap_one = _coordinate_recovering_fast_bootstrap_one
    canonical.legacy.v20._lock_identity = _recovering_lock_identity
    v7.v6.v5.SCHEMA = SCHEMA
    v7.v6.v5.v4.SCHEMA = SCHEMA
    canonical.SCHEMA = SCHEMA


def _self_test() -> int:
    assert v7._self_test() == 0

    from app.models import CardIdentity

    ready = CardIdentity(
        sport="Basketball",
        league="WNBA",
        year="2025",
        manufacturer="Panini",
        brand="Prizm",
        set_name="Stale Insert Name",
        player="Truth Player",
        card_number="77",
        parallel="Base",
    )
    incomplete = CardIdentity(
        sport="Basketball",
        player="Truth Player",
        card_number="77",
        parallel="Base",
    )
    assert _should_attempt_recovery({"reason": "registry_input_incomplete"}, ready)
    assert not _should_attempt_recovery({"reason": "registry_input_incomplete"}, incomplete)
    assert not _should_attempt_recovery({"reason": "registry_no_exact_match"}, ready)
    assert SCOPED_FAST_ROUTE.endswith("registry-holdout-lock-scoped")
    assert RECOVERY_CONCURRENCY < v7.PREFLIGHT_CONCURRENCY
    assert RECOVERY_MAX_ATTEMPTS < 500
    assert RECOVERY_HTTP_TIMEOUT_SECONDS < v7.v6.FAST_HTTP_TIMEOUT_SECONDS
    assert RECOVERY_ITEM_TIMEOUT_SECONDS < v7.PREFLIGHT_ITEM_TIMEOUT_SECONDS

    recovery_candidates = _coordinate_recovery_candidates(ready)
    assert recovery_candidates
    assert len(recovery_candidates) <= 4
    for _label, candidate in recovery_candidates:
        assert _norm(candidate.player) == _norm(ready.player)
        assert _norm(candidate.card_number) == _norm(ready.card_number)
        assert _norm(candidate.year) == _norm(ready.year)
        assert _norm(candidate.parallel) == _norm(ready.parallel)
        assert _norm(candidate.sport) == _norm(ready.sport)
    assert any(
        _norm(candidate.set_name) != _norm(ready.set_name)
        for _label, candidate in recovery_candidates
    )

    _install_runtime()
    assert v7.v6.FAST_ROUTE == SCOPED_FAST_ROUTE
    assert v7.v6._fast_bootstrap_one is _coordinate_recovering_fast_bootstrap_one
    assert v7.v6.v5._bootstrap_one is _coordinate_recovering_fast_bootstrap_one
    assert canonical.legacy.v20._lock_identity is _recovering_lock_identity
    assert v7.v6.v5._CANONICAL_AUTHORITATIVE_HOLDOUT is v7._bounded_authoritative_holdout

    print("PASS unseen V8 recovers only server input_incomplete on locally V20-ready truth")
    print("PASS unseen V8 routes bootstrap/recovery through release-scoped Registry lookup")
    print("PASS unseen V8 bounds stale set/release coordinate widening and keeps year/player/card/variant/sport fixed")
    print("PASS unseen V8 bounds recovery concurrency, attempts, HTTP time, and item time")
    print("PASS unseen V8 requires the bootstrap UUID/fingerprint to pass CURRENT canonical receipt revalidation")
    print("PASS unseen V8 preserves V20 physical witness, UUID/fingerprint, unseen-image, and diversity gates")
    return 0


def main() -> int:
    import sys

    if "--self-test" in sys.argv[1:]:
        return _self_test()
    _install_runtime()
    return int(v7.v6.v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
