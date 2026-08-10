from pathlib import Path

from app.student_comp_learning import _trusted_training_memory
from app.teacher_comp_learning import load_teacher_comp_receipts, record_teacher_comp_receipt
from app.teacher_comp_training import build_teacher_comp_training_example

# Online comp learning may calibrate the student, but verified teachers remain market truth.


def trusted_receipt() -> dict:
    identity = {
        "player": "Franklin Arias",
        "year": "2025",
        "brand": "Bowman",
        "setName": "Bowman Chrome Prospects",
        "cardNumber": "BCP-67",
        "parallel": "Reptilian Refractor",
        "gradingCompany": "PSA",
        "gradeValue": "9",
        "isRookie": True,
        "isAuto": False,
        "isRelic": False,
    }
    return {
        "schemaVersion": "tcos.instacomp.teacher-comp-receipt.v1",
        "source": "instacomp",
        "scanId": "scan-test",
        "registryIdentityId": "registry-test",
        "registryFingerprintSha256": "a" * 64,
        "canonicalIdentity": identity,
        "studentHypothesis": {
            "status": "ready",
            "studentMode": True,
            "learnMode": True,
            "pricingAuthority": False,
            "marketTruth": False,
            "model": "qwen2.5vl:7b",
            "trainingMemoryExamples": 0,
            "predictedMedian": 20,
            "predictedLow": 16,
            "predictedHigh": 25,
            "confidence": 0.35,
            "rationale": "Pre-teacher calibration guess.",
            "uncertainty": ["No prior exact sale memory."],
        },
        "teacherConsensus": {
            "configuredTeachers": ["groq", "groq_browser"],
            "requiredVotes": 2,
            "trusted": True,
            "attempts": [],
        },
        "acceptedSoldComps": [
            {
                "title": "2025 Bowman Chrome Franklin Arias BCP-67 Reptilian PSA 9",
                "price": 30,
                "itemPrice": 25,
                "shippingPrice": 5,
                "sourceCategory": "sold",
                "url": "https://www.ebay.com/itm/123456789012",
                "soldAt": "2026-07-31",
            }
        ],
        "discoverySoldComps": [],
        "discoveryActiveComps": [],
        "trustedSuggestedPrice": 30,
        "pricingEligibleSoldCount": 1,
        "studentMode": True,
        "pricingAuthority": False,
        "identityTrainingMutationAllowed": False,
        "createdAt": "2026-08-10T20:00:00Z",
    }


def test_trusted_receipt_becomes_online_student_memory(tmp_path: Path) -> None:
    db = tmp_path / "student.sqlite3"
    result = record_teacher_comp_receipt(db, trusted_receipt())
    assert result["trusted_market_truth"] is True
    rows = load_teacher_comp_receipts(db, limit=10)
    memory = _trusted_training_memory(db, trusted_receipt()["canonicalIdentity"], limit=8)
    assert len(memory) == 1
    assert memory[0]["trusted_suggested_price"] == 30
    assert memory[0]["trusted_sold_count"] == 1

    example = build_teacher_comp_training_example(rows[0])
    hypothesis = example["input"]["student_pre_teacher_hypothesis"]
    assert hypothesis["learnMode"] is True
    assert hypothesis["predictedMedian"] == 20
    assert example["target"]["trusted_suggested_price"] == 30
    assert example["boundaries"]["pricing_authority"] is False
