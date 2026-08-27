from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.teacher_comp_training import (
    build_teacher_comp_training_example,
    export_teacher_comp_training_dataset,
    teacher_comp_training_readiness,
)


def eligible_row(fingerprint: str = "f" * 64):
    return {
        "receipt_fingerprint": fingerprint,
        "trusted_market_truth": True,
        "student_training_eligible": True,
        "pricing_authority": False,
        "identity_training_mutated": False,
        "receipt": {
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
                "configuredTeachers": ["gemini", "groq"],
                "requiredVotes": 2,
                "trusted": True,
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
            "discoverySoldComps": [
                {
                    "title": "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
                    "price": 30,
                    "url": "https://www.ebay.com/itm/123456789012",
                },
                {
                    "title": "Wrong parallel Franklin Arias",
                    "price": 18,
                    "url": "https://www.ebay.com/itm/999999999999",
                },
            ],
            "discoveryActiveComps": [],
            "trustedSuggestedPrice": 30,
            "pricingEligibleSoldCount": 1,
        },
    }


def test_training_example_keeps_student_only_boundaries():
    example = build_teacher_comp_training_example(eligible_row())
    assert example["task"] == "exact_sold_comp_selection_and_pricing_evidence"
    assert example["target"]["pricing_eligible_sold_count"] == 1
    assert len(example["input"]["sold_candidates"]) == 2
    assert example["boundaries"]["pricing_authority"] is False
    assert example["boundaries"]["auto_promotion"] is False
    assert example["boundaries"]["identity_training_mutation_allowed"] is False


def test_untrusted_rows_never_export(tmp_path: Path):
    row = eligible_row()
    row["trusted_market_truth"] = False
    readiness = teacher_comp_training_readiness([row])
    assert readiness["eligible_example_count"] == 0
    assert readiness["ready_for_export"] is False
    with pytest.raises(ValueError):
        export_teacher_comp_training_dataset([row], destination_root=tmp_path)


def test_export_is_deterministic_and_separate_from_identity_dataset(tmp_path: Path):
    rows = [eligible_row("1" * 64), eligible_row("2" * 64), eligible_row("3" * 64)]
    first = export_teacher_comp_training_dataset(
        rows,
        destination_root=tmp_path / "first",
        validation_percent=20,
    )
    second = export_teacher_comp_training_dataset(
        list(reversed(rows)),
        destination_root=tmp_path / "second",
        validation_percent=20,
    )
    assert first["example_count"] == 3
    assert first["training_count"] == second["training_count"]
    assert first["validation_count"] == second["validation_count"]
    assert first["pricing_authority"] is False
    assert first["auto_promotion"] is False
    assert Path(first["train_path"]).parent.name == "teacher-comp"

    first_train = Path(first["train_path"]).read_text("utf-8")
    second_train = Path(second["train_path"]).read_text("utf-8")
    assert first_train == second_train
    for line in first_train.splitlines():
        payload = json.loads(line)
        assert payload["boundaries"]["pricing_authority"] is False
        assert payload["boundaries"]["identity_training_mutation_allowed"] is False
