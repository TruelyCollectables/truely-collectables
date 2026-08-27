from __future__ import annotations

from pathlib import Path

from app.teacher_comp_learning import record_teacher_comp_receipt


def receipt(required_votes: int):
    return {
        "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
        "source": "instacomp",
        "scanId": "scan-majority",
        "registryIdentityId": "registry-majority",
        "registryFingerprintSha256": "b" * 64,
        "canonicalIdentity": {
            "player": "Franklin Arias",
            "year": "2025",
            "brand": "Bowman Chrome",
            "setName": "Prospects",
            "cardNumber": "BCP-67",
        },
        "teacherConsensus": {
            "configuredTeachers": ["gemini", "anthropic", "xai", "groq"],
            "requiredVotes": required_votes,
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
    }


def test_four_teachers_require_three_votes(tmp_path: Path):
    weak = record_teacher_comp_receipt(tmp_path / "weak.sqlite3", receipt(2))
    assert weak["trusted_market_truth"] is False
    assert weak["student_training_eligible"] is False

    majority = record_teacher_comp_receipt(tmp_path / "majority.sqlite3", receipt(3))
    assert majority["trusted_market_truth"] is True
    assert majority["student_training_eligible"] is True
    assert majority["pricing_authority"] is False
    assert majority["identity_training_mutated"] is False
