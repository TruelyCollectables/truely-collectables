from __future__ import annotations

from pathlib import Path

from app.teacher_comp_learning import record_teacher_comp_receipt


def test_teacher_agreement_without_registry_binding_is_not_training_truth(tmp_path: Path):
    result = record_teacher_comp_receipt(
        tmp_path / "instacomp.sqlite3",
        {
            "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
            "source": "instacomp",
            "canonicalIdentity": {
                "player": "Franklin Arias",
                "year": "2025",
                "brand": "Bowman Chrome",
                "setName": "Prospects",
                "cardNumber": "BCP-67",
            },
            "teacherConsensus": {
                "configuredTeachers": ["gemini", "anthropic"],
                "requiredVotes": 2,
                "trusted": True,
                "attempts": [],
            },
            "acceptedSoldComps": [
                {
                    "title": "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
                    "price": 30,
                    "itemPrice": 25,
                    "shippingPrice": 5,
                    "url": "https://www.ebay.com/itm/123456789012",
                    "soldAt": "2026-07-31",
                }
            ],
            "trustedSuggestedPrice": 30,
            "pricingEligibleSoldCount": 1,
        },
    )
    assert result["trusted_market_truth"] is False
    assert result["student_training_eligible"] is False
    assert result["pricing_authority"] is False
    assert result["identity_training_mutated"] is False
