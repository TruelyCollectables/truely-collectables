from __future__ import annotations

from pathlib import Path

from app.manual_instacomp_ingestion import (
    manual_ingestion_contract,
    record_manual_instacomp_market_research,
)
from app.teacher_comp_learning import load_teacher_comp_receipts
from app.teacher_comp_training import export_teacher_comp_training_dataset


def test_manual_chatgpt_instacomp_saves_all_market_research_without_truth_promotion(tmp_path: Path):
    db = tmp_path / "manual.sqlite3"
    result = record_manual_instacomp_market_research(db, {
        "researchId": "chatgpt-research-1",
        "marketplace": "mercari",
        "decision": "PASS",
        "valuationLow": 15,
        "valuationMedian": 18,
        "valuationHigh": 21,
        "buyCeiling": 9.5,
        "confidence": 0.4,
        "activeListings": [
            {"listingId": "active-good", "title": "Possible good lot", "price": 6.5},
            {"listingId": "active-bad", "title": "Way too high lot", "price": 55, "decision": "TOO_HIGH"},
        ],
        "soldCandidates": [{"listingId": "sold-candidate", "title": "Loose sold candidate", "price": 14}],
        "rejectedComps": [{"listingId": "reject-1", "title": "Wrong card", "price": 30, "rejectionReason": "wrong player"}],
    })

    assert result["market_observation_count"] == 5
    assert result["verified_pricing_truth_count"] == 0
    assert result["pricing_training_eligible_count"] == 0
    assert result["identity_training_mutated"] is False
    rows = result["observations"]
    assert any(row["observation_type"] == "ACTIVE_ASK" and row["listing_id"] == "active-bad" for row in rows)
    assert any(row["event_class"] == "REJECTED" and row["rejection_reason"] == "wrong player" for row in rows)
    assert any(row["event_class"] == "DECISION" and row["decision"] == "PASS" for row in rows)


def test_manual_ingestion_can_create_verified_pricing_only_with_full_trust_bundle(tmp_path: Path):
    db = tmp_path / "manual.sqlite3"
    result = record_manual_instacomp_market_research(db, {
        "researchId": "verified-manual-1",
        "identityVerified": True,
        "pricingVerified": True,
        "registryIdentityId": "registry-verified",
        "registryFingerprintSha256": "b" * 64,
        "canonicalIdentity": {
            "player": "Paige Bueckers",
            "year": "2025",
            "brand": "Panini",
            "setName": "WNBA Prizm",
            "cardNumber": "1",
        },
        "verifiedSoldComps": [{"marketplace": "ebay", "listingId": "sold-verified", "title": "Exact sold", "price": 19.5, "soldAt": "2026-08-26"}],
        "trustedSuggestedPrice": 19.5,
    })

    assert result["verified_pricing_truth_count"] == 1
    assert result["pricing_training_eligible_count"] == 1
    receipts = load_teacher_comp_receipts(db, limit=10)
    assert receipts[0]["trusted_market_truth"] is True
    manifest = export_teacher_comp_training_dataset(receipts, destination_root=tmp_path)
    assert manifest["example_count"] == 1


def test_manual_ingestion_contract_documents_chatgpt_bridge_requirements():
    contract = manual_ingestion_contract()
    assert contract["endpoint"] == "/v1/training/manual-instacomp"
    assert "researchId" in contract["required"]
    assert "rejectedComps" in contract["retains"]
    assert contract["marketplace_identity_becomes_truth"] is False
    assert contract["identity_training_mutation_allowed"] is False


def test_manual_instacomp_route_persists_market_memory(tmp_path: Path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.storage import MemoryStore
    from app.training_routes import build_training_router

    store = MemoryStore(tmp_path / "route.sqlite3")
    store.initialize()
    app = FastAPI()

    def require_api_key() -> None:
        return None

    app.include_router(build_training_router(require_api_key, store, image_store_path=tmp_path / "images", training_export_path=tmp_path / "training"))
    client = TestClient(app)

    response = client.post("/v1/training/manual-instacomp", json={
        "researchId": "route-research-1",
        "marketplace": "mercari",
        "decision": "PASS",
        "activeListings": [{"listingId": "route-active", "title": "Route active ask", "price": 25}],
    })

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["schema_version"] == "tcos.instacomp.manual-market-ingestion.v1"
    assert payload["market_observation_count"] == 2

    listed = client.get("/v1/training/market-observations?research_id=route-research-1")
    assert listed.status_code == 200, listed.text
    assert listed.json()["count"] == 2
