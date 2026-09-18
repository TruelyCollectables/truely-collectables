from __future__ import annotations

from pathlib import Path

import pytest

from app.student_comp_learning import _market_observation_memory
from app.teacher_comp_learning import (
    append_market_observation_outcome,
    load_market_observations,
    record_teacher_comp_receipt,
)
from app.teacher_comp_training import export_teacher_comp_training_dataset


def base_receipt(**overrides):
    receipt = {
        "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
        "source": "instacomp",
        "researchId": "research-1",
        "scanId": "scan-1",
        "registryIdentityId": "registry-1",
        "registryFingerprintSha256": "a" * 64,
        "canonicalIdentity": {
            "player": "Paige Bueckers",
            "year": "2025",
            "brand": "Panini",
            "setName": "WNBA Prizm",
            "cardNumber": "1",
        },
        "teacherConsensus": {
            "configuredTeachers": ["teacher-a", "teacher-b"],
            "requiredVotes": 2,
            "trusted": False,
        },
        "acceptedSoldComps": [],
        "discoverySoldComps": [],
        "discoveryActiveComps": [],
        "trustedSuggestedPrice": None,
        "pricingEligibleSoldCount": 0,
    }
    receipt.update(overrides)
    return receipt


def test_good_deal_bad_deal_and_pass_are_saved(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    result = record_teacher_comp_receipt(db, base_receipt(
        decision="PASS",
        decisionRecord={"decision": "PASS", "valuationLow": 18, "valuationMedian": 21, "valuationHigh": 24, "buyCeiling": 10.5, "confidence": 0.62},
        discoveryActiveComps=[
            {"marketplace": "mercari", "listingId": "good", "title": "2025 WNBA lot", "price": 7.5, "decision": "GOOD_DEAL"},
            {"marketplace": "mercari", "listingId": "bad", "title": "Overpriced 2025 WNBA lot", "price": 99, "decision": "TOO_HIGH"},
        ],
    ))
    assert result["market_observations_saved"] == 3
    rows = load_market_observations(db, research_id="research-1", limit=10)
    assert {row["listing_id"] for row in rows if row["listing_id"]} == {"good", "bad"}
    assert any(row["event_class"] == "DECISION" and row["decision"] == "PASS" for row in rows)


def test_rejected_comp_saved_with_reason(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(
        discoverySoldComps=[{"marketplace": "ebay", "listingId": "wrong-parallel", "title": "Silver Prizm", "price": 20, "rejected": True, "rejectionReason": "wrong parallel"}],
    ))
    [row] = load_market_observations(db, limit=10)
    assert row["event_class"] == "REJECTED"
    assert row["rejection_reason"] == "wrong parallel"
    assert row["pricing_training_eligible"] == 0


def test_active_ask_retained_but_not_verified_sold_truth(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(discoveryActiveComps=[{"marketplace": "ebay", "listingId": "active-1", "title": "Active ask", "price": 40}]))
    [row] = load_market_observations(db, limit=10)
    assert row["observation_type"] == "ACTIVE_ASK"
    assert row["verified_pricing_truth"] == 0
    assert row["pricing_training_eligible"] == 0


def test_verified_sold_comp_can_become_pricing_training_eligible(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    result = record_teacher_comp_receipt(db, base_receipt(
        teacherConsensus={"configuredTeachers": ["teacher-a", "teacher-b"], "requiredVotes": 2, "trusted": True},
        acceptedSoldComps=[{"marketplace": "ebay", "listingId": "sold-1", "title": "Exact sold", "price": 22, "soldAt": "2026-08-20"}],
        discoverySoldComps=[{"marketplace": "ebay", "listingId": "sold-1", "title": "Exact sold", "price": 22, "soldAt": "2026-08-20"}],
        trustedSuggestedPrice=22,
        pricingEligibleSoldCount=1,
    ))
    assert result["student_training_eligible"] is True
    rows = load_market_observations(db, limit=10)
    verified = [row for row in rows if row["event_class"] == "VERIFIED_PRICING"]
    assert len(verified) == 1
    assert verified[0]["pricing_training_eligible"] == 1


def test_unverified_marketplace_identity_cannot_mutate_identity_training(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(
        discoveryActiveComps=[{"marketplace": "mercari", "listingId": "guess", "title": "Seller says rare gold 1/1 maybe", "price": 1000}],
    ))
    [row] = load_market_observations(db, limit=10)
    assert row["verified_identity_truth"] == 0
    assert row["identity_training_mutated"] == 0


def test_lot_saves_parent_and_identifiable_child_observations(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(
        researchId="miss-mels-lot-1",
        decision="BUY",
        lot={
            "title": "Miss Mel 2025 WNBA lot",
            "decision": "BUY",
            "price": 7.5,
            "valuationLow": 18,
            "valuationMedian": 21,
            "valuationHigh": 24,
            "buyCeiling": 10.5,
            "children": [
                {"title": "Paige Bueckers base", "confidence": 0.8},
                {"title": "Kiki Iriafen rookie", "confidence": 0.7},
            ],
        },
    ))
    rows = load_market_observations(db, research_id="miss-mels-lot-1", limit=10)
    assert sum(row["lot_role"] == "PARENT" for row in rows) == 1
    assert sum(row["lot_role"] == "CHILD" for row in rows) == 2


def test_later_auction_outcome_attaches_to_prior_research(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(discoveryActiveComps=[{"marketplace": "ebay", "listingId": "auction-1", "title": "Auction", "price": 5.5}]))
    prior = load_market_observations(db, limit=10)[0]
    result = append_market_observation_outcome(db, prior_observation_fingerprint=prior["observation_fingerprint"], outcome={"finalPrice": 12.5, "decision": "LOST_AUCTION"})
    assert result["status"] == "saved"
    rows = load_market_observations(db, limit=10)
    outcome = [row for row in rows if row["event_class"] == "OUTCOME"][0]
    assert outcome["parent_observation_fingerprint"] == prior["observation_fingerprint"]


def test_immediate_memory_retrieves_prior_market_observations(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, base_receipt(discoveryActiveComps=[{"marketplace": "mercari", "listingId": "active-memory", "title": "Remember this active ask", "price": 12}]))
    memory = _market_observation_memory(db, {"registryIdentityId": "registry-1"}, limit=5)
    assert len(memory) == 1
    assert memory[0]["listing_title"] == "Remember this active ask"
    assert memory[0]["verified_pricing_truth"] is False


def test_scheduled_training_consumes_only_verified_eligible_lessons(tmp_path: Path):
    untrusted = base_receipt(discoveryActiveComps=[{"marketplace": "ebay", "listingId": "active", "title": "Active only", "price": 99}])
    trusted = base_receipt(
        teacherConsensus={"configuredTeachers": ["teacher-a", "teacher-b"], "requiredVotes": 2, "trusted": True},
        acceptedSoldComps=[{"marketplace": "ebay", "listingId": "sold-2", "title": "Exact sold", "price": 18, "soldAt": "2026-08-20"}],
        trustedSuggestedPrice=18,
        pricingEligibleSoldCount=1,
    )
    db = tmp_path / "market.sqlite3"
    record_teacher_comp_receipt(db, untrusted)
    record_teacher_comp_receipt(db, trusted)
    from app.teacher_comp_learning import load_teacher_comp_receipts
    manifest = export_teacher_comp_training_dataset(load_teacher_comp_receipts(db, limit=20), destination_root=tmp_path)
    assert manifest["example_count"] == 1


def test_missing_prior_outcome_fails_closed(tmp_path: Path):
    with pytest.raises(ValueError):
        append_market_observation_outcome(tmp_path / "market.sqlite3", prior_observation_fingerprint="missing", outcome={"finalPrice": 1})


def test_price_guide_snapshot_and_weekly_points_are_retained_as_market_memory(tmp_path: Path):
    db = tmp_path / "market.sqlite3"
    receipt = base_receipt(
        priceGuideSnapshot={
            "source": "ebay_price_guide",
            "listingUrl": "https://www.ebay.com/itm/307148671682",
            "cardTitle": "2025 Panini Prizm WNBA - Signatures Aneesah Morrow #SG-AM Green Prizm (AU, RC)",
            "period": "3 months",
            "medianSoldPrice": 10.0,
            "soldPriceLow": 2.25,
            "soldPriceHigh": 16.99,
            "capturedAt": "2026-09-18T02:00:00+00:00",
            "weeklyMedianSeries": [
                {"timestamp": 1782086400000, "value": 16.99},
                {"timestamp": 1782691200000, "value": 10.5},
            ],
            "recentSales": [
                {
                    "title": "Exact Morrow Green Auto",
                    "itemPrice": 11.0,
                    "shippingPrice": 1.36,
                    "format": "Offer accepted",
                    "date": "Aug 23, 2026",
                }
            ],
        },
    )
    record_teacher_comp_receipt(db, receipt)
    rows = load_market_observations(db, identity={"registryIdentityId": "registry-1"}, limit=20)
    types = [row["observation_type"] for row in rows]
    assert "EBAY_PRICE_GUIDE_SNAPSHOT" in types
    assert types.count("EBAY_PRICE_GUIDE_WEEKLY_MEDIAN") == 2
    assert types.count("EBAY_PRICE_GUIDE_RECENT_SALE") == 1
    price_guide_sale = next(row for row in rows if row["observation_type"] == "EBAY_PRICE_GUIDE_RECENT_SALE")
    assert price_guide_sale["total_price"] == 12.36
    assert price_guide_sale["pricing_training_eligible"] == 0
    snapshot = next(row for row in rows if row["observation_type"] == "EBAY_PRICE_GUIDE_SNAPSHOT")
    assert snapshot["valuation_median"] == 10.0
    assert snapshot["marketplace"] == "eBay"
