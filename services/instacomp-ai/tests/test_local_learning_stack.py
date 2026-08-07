from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    ColorEvidence,
    LearningState,
    LessonCreate,
    LocalVisionEvidence,
    OCRBox,
    OCRObservation,
    PatternEvidence,
    SerialEvidence,
    SideVisionEvidence,
)
from app.local_vision import parse_serial_evidence
from app.storage import MemoryStore
from app.training import export_training_dataset, training_readiness


def observation(text: str, side: str = "back") -> OCRObservation:
    return OCRObservation(
        text=text,
        confidence=0.98,
        box=OCRBox(x=0.1, y=0.1, width=0.3, height=0.05),
        side=side,
        source="test",
    )


def side_evidence(side: str, ocr: list[OCRObservation]) -> SideVisionEvidence:
    return SideVisionEvidence(
        side=side,
        width=800,
        height=1100,
        ocr=ocr,
        colors=ColorEvidence(
            dominant_colors=["blue", "silver"],
            proportions={"blue": 0.44, "silver": 0.21},
            mean_saturation=0.45,
            mean_brightness=0.71,
            metallic_score=0.24,
        ),
        pattern=PatternEvidence(
            label="velocity",
            confidence=0.91,
            scores={"velocity": 0.91, "cracked_ice": 0.24},
            geometry=["directional diagonal line geometry"],
            line_count=37,
            polygon_count=4,
            edge_density=0.12,
            dominant_angle=45.0,
            angle_concentration=0.44,
            angle_entropy=0.33,
        ),
    )


def test_visible_serial_stamp_is_separate_from_checklist_print_run() -> None:
    exact = parse_serial_evidence([observation("017 / 299")])
    assert exact.stamp_present is True
    assert exact.exact_stamp == "17/299"
    assert exact.numerator == 17
    assert exact.visible_denominator == 299

    denominator_only = parse_serial_evidence([observation("Parallel print run /99")])
    assert denominator_only.stamp_present is False
    assert denominator_only.numerator is None
    assert denominator_only.visible_denominator == 99


def test_operator_lesson_creates_full_trusted_training_example(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    front = side_evidence("front", [observation("SONIA CITRON", "front")])
    back = side_evidence(
        "back",
        [
            observation("NO. 122"),
            observation("2025 PANINI WNBA PRIZM"),
            observation("17/99"),
        ],
    )
    local = LocalVisionEvidence(
        schema_version="tcos.instacomp-ai.local-vision.v1",
        front=front,
        back=back,
        serial=SerialEvidence(
            stamp_present=True,
            exact_stamp="17/99",
            numerator=17,
            visible_denominator=99,
            side="back",
            confidence=0.98,
            source_text="17/99",
            box=OCRBox(x=0.1, y=0.1, width=0.2, height=0.04),
        ),
        identity_hints=CardIdentity(
            year="2025",
            manufacturer="Panini",
            player="Sonia Citron",
            card_number="122",
            parallel="Blue Velocity Prizm",
            serial_number="17/99",
            serial_run=99,
        ),
        combined_text="SONIA CITRON\nNO. 122\n2025 PANINI WNBA PRIZM\n17/99",
        apple_vision_available=True,
        opencv_available=True,
    )
    checklist = ChecklistResult(
        outcome=ChecklistOutcome.EXACT_MATCH,
        identity_id="registry-122-blue-velocity",
        identity=local.identity_hints,
        candidate_count=1,
        source_receipts=[
            "registry_identity:registry-122-blue-velocity",
            "registry_fingerprint:" + "a" * 64,
        ],
    )
    store.save_scan(
        scan_id="scan-1",
        created_at=datetime.now(timezone.utc),
        front_sha256="1" * 64,
        back_sha256="2" * 64,
        image_pair_sha256="3" * 64,
        front_reference_sha256="4" * 64,
        back_reference_sha256="5" * 64,
        front_perceptual_hash="0" * 16,
        back_perceptual_hash="f" * 16,
        local_suggestion=None,
        local_vision=local.model_dump(mode="json"),
        checklist=checklist.model_dump(mode="json"),
        status="needs_review",
    )

    lesson = store.create_lesson(
        LessonCreate(
            scan_id="scan-1",
            state=LearningState.OPERATOR_CONFIRMED,
            identity=CardIdentity(
                year="2025",
                manufacturer="Panini",
                set_name="Prizm WNBA",
                player="Sonia Citron",
                card_number="122",
                parallel="Blue Velocity Prizm",
                serial_number="17/99",
                serial_run=99,
            ),
            rejected_identity=CardIdentity(
                year="2025",
                manufacturer="Panini",
                set_name="Prizm WNBA",
                player="Sonia Citron",
                card_number="122",
                parallel="Blue Cracked Ice Prizm",
            ),
            verification_source="operator:kingmaker",
            operator_id="david",
        )
    )
    assert lesson.training_example_id

    examples = store.list_training_examples(trusted_only=True)
    assert len(examples) == 1
    example = examples[0]
    assert example.serial_truth.visible_stamp_present is True
    assert example.serial_truth.visible_numerator == 17
    assert example.serial_truth.visible_denominator == 99
    assert example.serial_truth.checklist_print_run == 99
    assert "parallel" in example.correction_fields
    assert example.local_vision.front.pattern.label == "velocity"
    assert example.registry_fingerprint_sha256 == "a" * 64


def test_dataset_export_uses_only_trusted_examples(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    checklist = ChecklistResult(
        outcome=ChecklistOutcome.EXACT_MATCH,
        identity_id="identity-1",
        identity=CardIdentity(
            year="2025",
            manufacturer="Panini",
            set_name="Select WNBA",
            player="Paige Bueckers",
            card_number="5",
            parallel="Base",
        ),
        candidate_count=1,
        source_receipts=["registry_identity:identity-1", "registry_fingerprint:" + "b" * 64],
    )
    store.save_scan(
        scan_id="scan-2",
        created_at=datetime.now(timezone.utc),
        front_sha256="6" * 64,
        back_sha256="7" * 64,
        image_pair_sha256="8" * 64,
        local_suggestion=None,
        local_vision=None,
        checklist=checklist.model_dump(mode="json"),
        status="trusted_memory_match",
    )
    store.create_lesson(
        LessonCreate(
            scan_id="scan-2",
            state=LearningState.CHECKLIST_CONFIRMED,
            identity=checklist.identity,
            verification_source="registry:identity-1",
        )
    )
    examples = store.list_training_examples(trusted_only=True)
    image_root = tmp_path / "images"
    for sha, side in [("6" * 64, "front"), ("7" * 64, "back")]:
        target = image_root / sha[:2] / sha[2:4] / f"{sha}-{side}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"test")

    manifest = export_training_dataset(
        examples,
        image_store_path=image_root,
        destination_root=tmp_path / "exports",
        validation_percent=0,
    )
    assert manifest["trusted_examples"] == 1
    assert manifest["train_examples"] == 1
    train = Path(manifest["destination"]) / "train.jsonl"
    row = json.loads(train.read_text(encoding="utf-8").strip())
    assert len(row["images"]) == 2
    assert row["metadata"]["registry_identity_id"] == "identity-1"
    readiness = training_readiness(examples)
    assert readiness["trusted_examples"] == 1
    assert readiness["ready_for_trial_lora"] is False
