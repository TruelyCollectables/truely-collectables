from __future__ import annotations

from datetime import datetime, timezone

from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LearningState,
    LocalVisionEvidence,
    OCRBox,
    OCRObservation,
    SerialTruth,
    SideVisionEvidence,
    TrainingExample,
)
from app.teacher_vision_prompt_evidence import compact_training_example_for_prompt


def _example_with_large_ocr() -> TrainingExample:
    observations = [
        OCRObservation(
            text=f"VISIBLE-{index:03d}",
            confidence=0.99,
            box=OCRBox(x=0.1, y=0.1, width=0.2, height=0.05),
            side="front",
            source="test",
        )
        for index in range(100)
    ]
    local_vision = LocalVisionEvidence(
        front=SideVisionEvidence(
            side="front",
            width=1600,
            height=1200,
            ocr=observations,
        ),
        identity_hints=CardIdentity(card_number="32", parallel="Silver Prizm"),
        combined_text=" ".join(item.text for item in observations),
        apple_vision_available=True,
        opencv_available=True,
    )
    return TrainingExample(
        training_example_id="training-large-evidence",
        lesson_id="lesson-large-evidence",
        scan_id="scan-large-evidence",
        card_uuid="11111111-1111-1111-1111-111111111111",
        state=LearningState.CHECKLIST_CONFIRMED,
        trusted=True,
        created_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
        verification_source="registry:test",
        confirmed_identity=CardIdentity(
            brand="Prizm",
            player="DeWanna Bonner",
            card_number="32",
            parallel="Silver Prizm",
        ),
        predicted_identity=CardIdentity(
            brand="Prizm",
            player="DeWanna Bonner",
            card_number="32",
            parallel="Base",
        ),
        correction_fields=["parallel"],
        local_vision=local_vision,
        checklist=ChecklistResult(
            outcome=ChecklistOutcome.EXACT_MATCH,
            identity_id="registry-silver-32",
            identity=CardIdentity(
                brand="Prizm",
                player="DeWanna Bonner",
                card_number="32",
                parallel="Silver Prizm",
            ),
            candidate_count=1,
            source_receipts=["registry_fingerprint:abc123"],
        ),
        registry_identity_id="registry-silver-32",
        registry_fingerprint_sha256="abc123",
        front_sha256="a" * 64,
        image_pair_sha256="c" * 64,
        serial_truth=SerialTruth(visible_stamp_present=False),
    )


def test_prompt_view_caps_ocr_and_preserves_raw_training_example() -> None:
    original = _example_with_large_ocr()
    assert original.local_vision is not None
    assert len(original.local_vision.front.ocr) == 100
    assert original.local_vision.front.ocr[0].box.x == 0.1

    compact = compact_training_example_for_prompt(original)
    digest = compact.local_vision.model_dump(mode="json")  # type: ignore[union-attr]

    assert compact is not original
    assert len(digest["front"]["ocr"]) == 40
    assert digest["front"]["ocr"][0] == {
        "text": "VISIBLE-000",
        "confidence": 0.99,
    }
    assert all("box" not in item for item in digest["front"]["ocr"])
    assert digest["identity_hints"]["card_number"] == "32"
    assert digest["identity_hints"]["parallel"] == "Silver Prizm"

    # Compaction is prompt-only. The source example still owns every observation
    # and bounding box for future mining/reprocessing.
    assert len(original.local_vision.front.ocr) == 100
    assert original.local_vision.front.ocr[-1].text == "VISIBLE-099"
    assert original.local_vision.front.ocr[-1].box.width == 0.2
