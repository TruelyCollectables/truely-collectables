from __future__ import annotations

from pathlib import Path

from app.teacher_comp_learning import (
    load_teacher_comp_receipts,
    record_teacher_comp_receipt,
    teacher_comp_learning_stats,
)


def receipt(*, trusted: bool, configured: list[str], required_votes: int, sold_count: int = 1):
    sold = [
        {
            "title": "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
            "price": 30,
            "itemPrice": 25,
            "shippingPrice": 5,
            "url": "https://www.ebay.com/itm/123456789012",
            "soldAt": "2026-07-31",
            "flags": ["outside teacher consensus"],
        }
    ] if sold_count else []
    return {
        "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
        "source": "instacomp",
        "scanId": "scan-123",
        "registryIdentityId": "registry-123",
        "registryFingerprintSha256": "a" * 64,
        "canonicalIdentity": {
            "player": "Franklin Arias",
            "year": "2025",
            "brand": "Bowman Chrome",
            "setName": "Prospects",
            "cardNumber": "BCP-67",
        },
        "teacherConsensus": {
            "configuredTeachers": configured,
            "requiredVotes": required_votes,
            "trusted": trusted,
            "attempts": [],
        },
        "acceptedSoldComps": sold,
        "discoverySoldComps": sold,
        "discoveryActiveComps": [],
        "trustedSuggestedPrice": 30 if sold_count else None,
        "pricingEligibleSoldCount": sold_count,
    }


def test_teacher_receipt_trusted_consensus_becomes_student_training(tmp_path: Path):
    db = tmp_path / "instacomp.sqlite3"
    result = record_teacher_comp_receipt(
        db,
        receipt(
            trusted=True,
            configured=["gemini", "anthropic"],
            required_votes=2,
        ),
    )
    assert result["status"] == "saved"
    assert result["trusted_market_truth"] is True
    assert result["student_training_eligible"] is True
    assert result["pricing_authority"] is False
    assert result["identity_training_mutated"] is False

    stats = teacher_comp_learning_stats(db)
    assert stats["receipt_count"] == 1
    assert stats["trusted_teacher_receipt_count"] == 1
    assert stats["trusted_exact_sold_comp_count"] == 1
    assert stats["pricing_authority"] is False


def test_one_teacher_can_never_become_training_truth(tmp_path: Path):
    db = tmp_path / "instacomp.sqlite3"
    result = record_teacher_comp_receipt(
        db,
        receipt(trusted=True, configured=["gemini"], required_votes=2),
    )
    assert result["trusted_market_truth"] is False
    assert result["student_training_eligible"] is False


def test_disagreement_receipt_is_retained_but_not_training_truth(tmp_path: Path):
    db = tmp_path / "instacomp.sqlite3"
    result = record_teacher_comp_receipt(
        db,
        receipt(
            trusted=False,
            configured=["gemini", "anthropic"],
            required_votes=2,
            sold_count=0,
        ),
    )
    assert result["status"] == "saved"
    assert result["trusted_market_truth"] is False
    rows = load_teacher_comp_receipts(db, limit=10)
    assert len(rows) == 1
    assert rows[0]["student_training_eligible"] is False
    assert rows[0]["receipt"]["teacherConsensus"]["trusted"] is False


def test_teacher_receipts_are_idempotent(tmp_path: Path):
    db = tmp_path / "instacomp.sqlite3"
    body = receipt(
        trusted=True,
        configured=["gemini", "anthropic"],
        required_votes=2,
    )
    first = record_teacher_comp_receipt(db, body)
    second = record_teacher_comp_receipt(db, body)
    assert first["status"] == "saved"
    assert second["status"] == "duplicate"
    assert teacher_comp_learning_stats(db)["receipt_count"] == 1
