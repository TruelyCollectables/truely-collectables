from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .teacher_comp_learning import (
    load_market_observations,
    record_teacher_comp_receipt,
)

SCHEMA_VERSION = "tcos.instacomp.manual-market-ingestion.v1"


def _text(value: object, maximum: int = 1000) -> str:
    return str(value or "").strip()[:maximum]


def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def _normalize_listing(value: dict[str, Any], *, default_marketplace: str | None = None) -> dict[str, Any]:
    listing = dict(value)
    if default_marketplace and not listing.get("marketplace"):
        listing["marketplace"] = default_marketplace
    return listing


def _manual_receipt(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Manual InstaComp ingestion body must be an object.")

    marketplace = _text(body.get("marketplace"), 80) or None
    research_id = _text(body.get("researchId") or body.get("research_id"), 160)
    if not research_id:
        raise ValueError("researchId is required for manual InstaComp ingestion.")

    canonical_identity = _dict(body.get("canonicalIdentity") or body.get("canonical_identity"))
    identity_verified = bool(body.get("identityVerified") or body.get("identity_verified"))
    pricing_verified = bool(body.get("pricingVerified") or body.get("pricing_verified"))
    registry_identity_id = _text(body.get("registryIdentityId") or body.get("registry_identity_id"), 160) or None
    registry_fingerprint = _text(body.get("registryFingerprintSha256") or body.get("registry_fingerprint_sha256"), 128) or None

    accepted_sold = [_normalize_listing(item, default_marketplace=marketplace) for item in _list(body.get("verifiedSoldComps") or body.get("verified_sold_comps")) if isinstance(item, dict)]
    discovery_sold = [_normalize_listing(item, default_marketplace=marketplace) for item in _list(body.get("soldCandidates") or body.get("sold_candidates")) if isinstance(item, dict)]
    rejected = [_normalize_listing({**item, "rejected": True}, default_marketplace=marketplace) for item in _list(body.get("rejectedComps") or body.get("rejected_comps")) if isinstance(item, dict)]
    active = [_normalize_listing(item, default_marketplace=marketplace) for item in _list(body.get("activeListings") or body.get("active_listings") or body.get("activeAsks") or body.get("active_asks")) if isinstance(item, dict)]

    trusted_price = _number(body.get("trustedSuggestedPrice") or body.get("trusted_suggested_price") or body.get("valuationMedian") or body.get("valuation_median"))
    can_be_verified_pricing = bool(
        pricing_verified
        and identity_verified
        and registry_identity_id
        and registry_fingerprint
        and accepted_sold
        and all(_text(canonical_identity.get(field), 300) for field in ("player", "year", "brand", "setName", "cardNumber"))
    )

    lot = _dict(body.get("lot") or body.get("lotRecord") or body.get("lot_record"))
    if lot:
        lot = dict(lot)
        if marketplace and not lot.get("marketplace"):
            lot["marketplace"] = marketplace

    return {
        "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
        "source": _text(body.get("source") or "manual-chatgpt-instacomp", 100),
        "researchId": research_id,
        "scanId": _text(body.get("scanId") or body.get("scan_id"), 120) or None,
        "registryIdentityId": registry_identity_id if identity_verified else None,
        "registryFingerprintSha256": registry_fingerprint if identity_verified else None,
        "canonicalIdentity": canonical_identity if identity_verified else {},
        "teacherConsensus": {
            "configuredTeachers": ["manual-operator", "manual-comp-evidence"] if can_be_verified_pricing else [],
            "requiredVotes": 2,
            "trusted": can_be_verified_pricing,
            "manualIngestion": True,
        },
        "acceptedSoldComps": accepted_sold if can_be_verified_pricing else [],
        "discoverySoldComps": [*discovery_sold, *rejected],
        "discoveryActiveComps": active,
        "trustedSuggestedPrice": trusted_price if can_be_verified_pricing else None,
        "pricingEligibleSoldCount": len(accepted_sold) if can_be_verified_pricing else 0,
        "decision": _text(body.get("decision"), 60) or None,
        "decisionRecord": _dict(body.get("decisionRecord") or body.get("decision_record")) or {
            key: value
            for key, value in {
                "decision": body.get("decision"),
                "valuationLow": body.get("valuationLow") or body.get("valuation_low"),
                "valuationMedian": body.get("valuationMedian") or body.get("valuation_median"),
                "valuationHigh": body.get("valuationHigh") or body.get("valuation_high"),
                "buyCeiling": body.get("buyCeiling") or body.get("buy_ceiling"),
                "confidence": body.get("confidence"),
            }.items()
            if value is not None
        },
        "lot": lot,
        "outcome": _dict(body.get("outcome") or body.get("outcomeRecord") or body.get("outcome_record")),
        "valuationLow": _number(body.get("valuationLow") or body.get("valuation_low")),
        "valuationHigh": _number(body.get("valuationHigh") or body.get("valuation_high")),
        "buyCeiling": _number(body.get("buyCeiling") or body.get("buy_ceiling")),
        "confidence": _number(body.get("confidence")),
        "createdAt": _text(body.get("observedAt") or body.get("observed_at") or body.get("createdAt") or body.get("created_at"), 80) or None,
    }


def record_manual_instacomp_market_research(path: Path, body: dict[str, Any]) -> dict[str, Any]:
    receipt = _manual_receipt(body)
    result = record_teacher_comp_receipt(path, receipt)
    rows = load_market_observations(path, research_id=receipt["researchId"], limit=200)
    return {
        "ok": True,
        "schema_version": SCHEMA_VERSION,
        "research_id": receipt["researchId"],
        "receipt": result,
        "market_observation_count": len(rows),
        "verified_pricing_truth_count": sum(1 for row in rows if row.get("verified_pricing_truth")),
        "pricing_training_eligible_count": sum(1 for row in rows if row.get("pricing_training_eligible")),
        "identity_training_mutated": False,
        "observations": rows,
    }


def manual_ingestion_contract() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "endpoint": "/v1/training/manual-instacomp",
        "required": ["researchId"],
        "retains": ["activeListings", "soldCandidates", "rejectedComps", "decisionRecord", "lot", "outcome"],
        "verified_pricing_requires": ["pricingVerified", "identityVerified", "registryIdentityId", "registryFingerprintSha256", "canonicalIdentity", "verifiedSoldComps"],
        "marketplace_identity_becomes_truth": False,
        "identity_training_mutation_allowed": False,
    }
