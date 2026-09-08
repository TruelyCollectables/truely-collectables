from __future__ import annotations

import unicodedata
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .local_registry_store import LocalRegistryStore


def _text(value: Any, max_length: int) -> str | None:
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    normalized = " ".join(normalized.split()).strip()
    return normalized[:max_length] or None


def _optional_boolean(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _locked_fields(match: dict[str, Any] | None) -> dict[str, Any] | None:
    if not match:
        return None
    return {
        "sport": match.get("sport") or None,
        "league": match.get("league") or None,
        "year": match.get("year") or None,
        "manufacturer": match.get("manufacturer") or None,
        "brand": match.get("brand") or None,
        "setName": match.get("product") or match.get("brand") or match.get("setName") or None,
        "subset": match.get("setName") or None,
        "player": match.get("player") or None,
        "team": match.get("team") or None,
        "cardNumber": match.get("cardNumber") or None,
        "parallel": match.get("parallel") or None,
        "variation": match.get("variation") or None,
        "serialRun": match.get("serialRun") or None,
        "isAuto": match.get("isAuto") if isinstance(match.get("isAuto"), bool) else None,
        "isRelic": match.get("isRelic") if isinstance(match.get("isRelic"), bool) else None,
    }


def _checklist_first_response(decision: dict[str, Any]) -> dict[str, Any]:
    match = decision.get("match") if isinstance(decision.get("match"), dict) else None
    status = str(decision.get("status") or "")
    return {
        "ok": True,
        "checklistFirst": True,
        "status": "exact_match" if status == "internal_exact_match" else "review_required",
        "aiRequired": status != "internal_exact_match",
        "match": match,
        "candidates": [match] if match else [],
        "reasons": decision.get("reasons") or [],
        "registryIdentityId": (match or {}).get("identityId"),
        "identityId": (match or {}).get("identityId"),
        "registryFingerprintSha256": (match or {}).get("fingerprintSha256"),
        "fingerprintSha256": (match or {}).get("fingerprintSha256"),
        "candidateCount": int(decision.get("candidateCount") or (1 if match else 0)),
        "lockedFields": _locked_fields(match),
        "identificationPath": "checklist_only" if match else "ai_fallback_allowed",
    }


def _registry_lock_response(decision: dict[str, Any], *, receipt_attempted: bool = False) -> dict[str, Any]:
    match = decision.get("match") if isinstance(decision.get("match"), dict) else None
    status = str(decision.get("status") or "lookup_unavailable")
    return {
        "ok": True,
        "registryLock": True,
        "resolver": "resolveLocalChecklistRegistry",
        "resolverStatus": status,
        "status": (
            "exact_match"
            if status == "internal_exact_match"
            else "set_absent"
            if status == "internal_set_absent"
            else "input_incomplete"
            if status == "input_incomplete"
            else "set_present_no_exact_match"
        ),
        "reasons": decision.get("reasons") or [],
        "candidateCount": int(decision.get("candidateCount") or 0),
        "registryIdentityId": (match or {}).get("identityId"),
        "identityId": (match or {}).get("identityId"),
        "registryFingerprintSha256": (match or {}).get("fingerprintSha256"),
        "fingerprintSha256": (match or {}).get("fingerprintSha256"),
        "receiptRevalidationAttempted": receipt_attempted,
        "receiptRevalidationAccepted": False,
        "directExactRecoveryAccepted": False,
        "lockedFields": _locked_fields(match),
        "identificationPath": (
            "authoritative_registry_exact_lock" if match else "review_required"
        ),
    }


def build_registry_router(
    require_api_key: Callable[..., None],
    store: LocalRegistryStore,
) -> APIRouter:
    router = APIRouter(
        prefix="/api/instacomp",
        tags=["InstaComp AI Registry"],
        dependencies=[Depends(require_api_key)],
    )

    @router.post("/checklist-lookup")
    async def checklist_lookup(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        decision = store.resolve(
            {
                "year": _text(body.get("year"), 20),
                "manufacturer": _text(body.get("manufacturer"), 120),
                "brand": _text(body.get("brand"), 160),
                "setName": _text(body.get("setName") or body.get("set_name"), 180),
                "subset": _text(body.get("subset"), 180),
                "cardNumber": _text(body.get("cardNumber"), 80),
                "player": _text(body.get("player"), 240),
                "serialNumber": _text(body.get("serialNumber"), 80),
                "serialRun": body.get("serialRun"),
                "isAuto": _optional_boolean(body.get("isAuto")),
                "isRelic": _optional_boolean(body.get("isRelic")),
                "parallel": _text(body.get("parallel"), 180),
                "variation": _text(body.get("variation"), 180),
                "ocrText": _text(body.get("ocrText"), 12_000),
            }
        )
        return JSONResponse(_checklist_first_response(decision))

    @router.post("/registry-stats")
    async def registry_stats() -> JSONResponse:
        return JSONResponse({"ok": True, **store.stats()})

    @router.post("/registry-lock")
    async def registry_lock(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        probe = {
            "year": _text(body.get("year"), 20),
            "manufacturer": _text(body.get("manufacturer"), 120),
            "brand": _text(body.get("brand"), 160),
            "setName": _text(body.get("setName") or body.get("set_name"), 180),
            "subset": _text(body.get("subset"), 180),
            "cardNumber": _text(body.get("cardNumber"), 80),
            "player": _text(body.get("player"), 240),
            "team": _text(body.get("team"), 180),
            "sport": _text(body.get("sport"), 120),
            "league": _text(body.get("league"), 120),
            "serialNumber": _text(body.get("serialNumber"), 80),
            "isAuto": _optional_boolean(body.get("isAuto")),
            "isRelic": _optional_boolean(body.get("isRelic")),
            "parallel": _text(body.get("parallel"), 180),
            "variation": _text(body.get("variation"), 180),
            "registryVisibleText": _text(body.get("registryVisibleText") or body.get("ocrText"), 12_000),
        }
        identity_id = _text(
            body.get("registryIdentityId")
            or body.get("identityId")
            or body.get("expectedRegistryIdentityId"),
            80,
        )
        fingerprint = _text(
            body.get("registryFingerprintSha256")
            or body.get("fingerprintSha256")
            or body.get("expectedRegistryFingerprintSha256"),
            80,
        )
        if identity_id and fingerprint:
            decision = store.revalidate_receipt(probe, identity_id, fingerprint)
            if decision is None:
                decision = store.resolve(probe)
        else:
            decision = store.resolve(probe)
        return JSONResponse(
            _registry_lock_response(
                decision,
                receipt_attempted=bool(identity_id and fingerprint),
            )
        )

    return router
