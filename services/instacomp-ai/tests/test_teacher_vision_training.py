from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from app.config import Settings
from app.images import persisted_image_path
from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LearningState,
    SerialTruth,
    TrainingExample,
)
from app.teacher_vision_training import (
    PRIZM_TRAINING_RULE,
    TEACHER_SCHEMA_VERSION,
    _consensus_lesson,
    _student_prompt,
    _teacher_prompt,
    ai_learning_image_path,
    ensure_ai_learning_image,
    export_teacher_augmented_dataset,
)


def _example(*, correction_fields: list[str] | None = None) -> TrainingExample:
    confirmed = CardIdentity(
        sport="Basketball",
        year="2024",
        manufacturer="Panini",
        brand="Prizm",
        set_name="WNBA Prizm",
        player="DeWanna Bonner",
        card_number="32",
        parallel="Silver Prizm",
    )
    predicted = confirmed.model_copy(update={"parallel": "Base"})
    return TrainingExample(
        training_example_id="training-1",
        lesson_id="lesson-1",
        scan_id="scan-1",
        card_uuid="11111111-1111-1111-1111-111111111111",
        state=LearningState.CHECKLIST_CONFIRMED,
        trusted=True,
        created_at=datetime(2026, 8, 16, tzinfo=timezone.utc),
        verification_source="registry:test",
        confirmed_identity=confirmed,
        predicted_identity=predicted,
        rejected_identity=predicted,
        correction_fields=correction_fields or ["parallel"],
        local_suggestion=None,
        local_vision=None,
        checklist=ChecklistResult(
            outcome=ChecklistOutcome.EXACT_MATCH,
            identity_id="registry-silver-32",
            identity=confirmed,
            candidate_count=1,
            source_receipts=["registry_fingerprint:abc123"],
        ),
        registry_identity_id="registry-silver-32",
        registry_fingerprint_sha256="abc123",
        front_sha256="a" * 64,
        back_sha256="b" * 64,
        image_pair_sha256="c" * 64,
        serial_truth=SerialTruth(
            visible_stamp_present=False,
            checklist_print_run=None,
            physical_copy_serial=None,
        ),
    )


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        teacher_vision_models="qwen2.5vl:7b,gemma3:12b",
        teacher_vision_image_max_edge=768,
        teacher_vision_hard_example_multiplier=3,
    )


def _write_archive(path: Path, size: tuple[int, int], color: tuple[int, int, int]) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path, format="JPEG", quality=95)
    return path.read_bytes()


def test_ai_learning_image_is_cached_derivative_and_archive_is_untouched(tmp_path: Path) -> None:
    archive = tmp_path / "archive.jpg"
    before = _write_archive(archive, (1600, 1200), (120, 140, 160))
    result = ensure_ai_learning_image(
        archive_path=archive,
        destination_root=tmp_path / "teacher",
        source_sha256="a" * 64,
        side="front",
        max_edge=768,
    )

    assert archive.read_bytes() == before
    assert result["width"] <= 768
    assert result["height"] <= 768
    assert result["bytes"] < len(before)
    target = Path(result["path"])
    assert target.is_file()
    assert target == ai_learning_image_path(
        tmp_path / "teacher",
        "a" * 64,
        "front",
        768,
    )
    first_mtime = target.stat().st_mtime_ns
    second = ensure_ai_learning_image(
        archive_path=archive,
        destination_root=tmp_path / "teacher",
        source_sha256="a" * 64,
        side="front",
        max_edge=768,
    )
    assert Path(second["path"]).stat().st_mtime_ns == first_mtime


def test_teacher_sees_truth_but_student_prompt_does_not_leak_answer() -> None:
    example = _example()
    teacher_prompt = _teacher_prompt(example)
    student_prompt = _student_prompt(example)

    assert "DeWanna Bonner" in teacher_prompt
    assert "Silver Prizm" in teacher_prompt
    assert "Base" in teacher_prompt
    assert PRIZM_TRAINING_RULE in teacher_prompt

    assert "DeWanna Bonner" not in student_prompt
    assert "Silver Prizm" in student_prompt  # appears only inside the generic Prizm rule
    assert "DeWanna Bonner" not in student_prompt
    assert "registry-silver-32" not in student_prompt


def test_consensus_teacher_lesson_never_grants_identity_authority() -> None:
    receipts = [
        {
            "model": "qwen2.5vl:7b",
            "lesson": {
                "supports_canonical_truth": True,
                "front_visible_text": ["BONNER"],
                "back_visible_text": ["PRIZM", "No. 32"],
                "logos": ["Panini"],
                "colors": ["silver"],
                "foil_or_pattern": ["refractor sheen"],
                "serial_evidence": [],
                "positive_cues": ["bold black PRIZM on back"],
                "negative_cues": ["no green parallel color"],
                "student_miss_explanation": ["Base ignored the back PRIZM marker"],
                "field_lessons": {"parallel": "Use the back PRIZM marker before front color."},
                "uncertainty": [],
            },
        },
        {
            "model": "gemma3:12b",
            "lesson": {
                "supports_canonical_truth": True,
                "front_visible_text": ["BONNER"],
                "back_visible_text": ["PRIZM"],
                "logos": [],
                "colors": ["silver"],
                "foil_or_pattern": [],
                "serial_evidence": [],
                "positive_cues": ["PRIZM is visible on back"],
                "negative_cues": [],
                "student_miss_explanation": [],
                "field_lessons": {},
                "uncertainty": [],
            },
        },
    ]
    merged = _consensus_lesson(receipts)
    assert merged is not None
    assert merged["identity_authority"] is False
    assert merged["registry_mutation_allowed"] is False
    assert merged["pricing_authority"] is False
    assert merged["teacher_models"] == ["qwen2.5vl:7b", "gemma3:12b"]
    assert "PRIZM" in merged["back_visible_text"]


def test_export_uses_ai_derivatives_and_oversamples_parallel_hard_miss(
    tmp_path: Path,
    monkeypatch,
) -> None:
    example = _example()
    image_store = tmp_path / "images"
    teacher_root = tmp_path / "teacher"
    export_root = tmp_path / "exports"

    front_archive = persisted_image_path(image_store, example.front_sha256, "front")
    back_archive = persisted_image_path(image_store, example.back_sha256 or "", "back")
    _write_archive(front_archive, (1600, 1200), (100, 120, 140))
    _write_archive(back_archive, (1600, 1200), (150, 150, 150))

    monkeypatch.setattr(
        "app.teacher_vision_training._stable_split",
        lambda _example, _percent: "train",
    )

    for model in ["qwen2.5vl:7b", "gemma3:12b"]:
        safe = model.replace(":", "-")
        receipt_path = teacher_root / "teacher-receipts" / safe / "training-1.json"
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(
            json.dumps(
                {
                    "schema_version": TEACHER_SCHEMA_VERSION,
                    "model": model,
                    "training_example_id": example.training_example_id,
                    "front_sha256": example.front_sha256,
                    "back_sha256": example.back_sha256,
                    "registry_identity_id": example.registry_identity_id,
                    "registry_fingerprint_sha256": example.registry_fingerprint_sha256,
                    "lesson": {
                        "supports_canonical_truth": True,
                        "front_visible_text": [],
                        "back_visible_text": ["PRIZM"],
                        "logos": [],
                        "colors": [],
                        "foil_or_pattern": [],
                        "serial_evidence": [],
                        "positive_cues": ["back PRIZM marker"],
                        "negative_cues": [],
                        "student_miss_explanation": ["missed back marker"],
                        "field_lessons": {"parallel": "Back marker is decisive."},
                        "uncertainty": [],
                    },
                }
            ),
            "utf-8",
        )

    manifest = export_teacher_augmented_dataset(
        [example],
        settings=_settings(),
        image_store_path=image_store,
        destination_root=export_root,
        teacher_root=teacher_root,
        validation_percent=15,
    )

    assert manifest["base_train_examples"] == 1
    assert manifest["hard_examples"] == 1
    assert manifest["train_examples"] == 4  # 3x hard miss + 1x parallel bonus
    assert manifest["teacher_enriched_train_examples"] == 1
    assert manifest["original_archived_images_mutated"] is False

    rows = [
        json.loads(line)
        for line in (Path(manifest["destination"]) / "train.jsonl").read_text("utf-8").splitlines()
    ]
    assert len(rows) == 4
    for row in rows:
        assert all("-ai-768.jpg" in path for path in row["images"])
        answer = json.loads(row["messages"][1]["content"][0]["text"])
        assert answer["identity"]["parallel"] == "Silver Prizm"
        assert answer["teacher_visual_lesson"]["identity_authority"] is False


def test_validation_row_is_teacher_free_and_not_oversampled(tmp_path: Path, monkeypatch) -> None:
    example = _example()
    image_store = tmp_path / "images"
    teacher_root = tmp_path / "teacher"
    export_root = tmp_path / "exports"
    _write_archive(
        persisted_image_path(image_store, example.front_sha256, "front"),
        (1000, 700),
        (100, 100, 100),
    )
    _write_archive(
        persisted_image_path(image_store, example.back_sha256 or "", "back"),
        (1000, 700),
        (100, 100, 100),
    )
    monkeypatch.setattr(
        "app.teacher_vision_training._stable_split",
        lambda _example, _percent: "validation",
    )

    manifest = export_teacher_augmented_dataset(
        [example],
        settings=_settings(),
        image_store_path=image_store,
        destination_root=export_root,
        teacher_root=teacher_root,
    )
    assert manifest["validation_examples"] == 1
    assert manifest["train_examples"] == 0
    row = json.loads(
        (Path(manifest["destination"]) / "validation.jsonl").read_text("utf-8").strip()
    )
    answer = json.loads(row["messages"][1]["content"][0]["text"])
    assert answer["teacher_visual_lesson"] is None
