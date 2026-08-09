from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from .images import persisted_image_path
from .models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LearningState,
    LessonRecord,
    LocalVisionEvidence,
    ModelSuggestion,
    SerialTruth,
    TrainingExample,
)

IDENTITY_FIELDS = [
    "sport",
    "league",
    "year",
    "manufacturer",
    "brand",
    "set_name",
    "subset",
    "player",
    "team",
    "card_number",
    "parallel",
    "variation",
    "serial_number",
    "serial_run",
    "rookie",
    "autograph",
    "inscription",
    "inscription_text",
    "memorabilia",
    "memorabilia_type",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def latest_training_examples(
    examples: Iterable[TrainingExample],
) -> list[TrainingExample]:
    """Keep only the newest trusted truth for each physical card.

    card_uuid survives rescans, so a later correction supersedes stale labels
    even if the card was scanned again under a new scan_id. Legacy examples
    without card_uuid continue to deduplicate by scan_id.
    """
    ordered = sorted(examples, key=lambda example: example.created_at, reverse=True)
    latest: list[TrainingExample] = []
    seen_card_keys: set[str] = set()
    for example in ordered:
        key = example.card_uuid or f"scan:{example.scan_id}"
        if key in seen_card_keys:
            continue
        seen_card_keys.add(key)
        latest.append(example)
    return latest


def changed_fields(
    predicted: CardIdentity | None,
    confirmed: CardIdentity,
) -> list[str]:
    if predicted is None:
        return [field for field in IDENTITY_FIELDS if getattr(confirmed, field) is not None]
    values: list[str] = []
    for field in IDENTITY_FIELDS:
        before = getattr(predicted, field)
        after = getattr(confirmed, field)
        if before != after:
            values.append(field)
    return values


def _registry_receipts(checklist: ChecklistResult) -> tuple[str | None, str | None]:
    identity_id = checklist.identity_id
    fingerprint = None
    for receipt in checklist.source_receipts:
        if receipt.startswith("registry_identity:"):
            identity_id = receipt.split(":", 1)[1] or identity_id
        elif receipt.startswith("registry_fingerprint:"):
            fingerprint = receipt.split(":", 1)[1] or None
    return identity_id, fingerprint


def build_serial_truth(
    *,
    identity: CardIdentity,
    local_vision: LocalVisionEvidence | None,
) -> SerialTruth:
    visible = local_vision.serial if local_vision else None
    return SerialTruth(
        visible_stamp_present=bool(visible and visible.stamp_present),
        visible_exact_stamp=visible.exact_stamp if visible else None,
        visible_numerator=visible.numerator if visible else None,
        visible_denominator=visible.visible_denominator if visible else None,
        checklist_print_run=identity.serial_run,
        physical_copy_serial=identity.serial_number,
        numerator_is_card_specific=True,
        denominator_is_configuration_level=True,
    )


def build_training_example(
    *,
    lesson: LessonRecord,
    scan: dict,
) -> TrainingExample:
    local_suggestion = (
        ModelSuggestion.model_validate(scan["local_suggestion"])
        if scan.get("local_suggestion")
        else None
    )
    local_vision = (
        LocalVisionEvidence.model_validate(scan["local_vision"])
        if scan.get("local_vision")
        else None
    )
    checklist_payload = scan.get("checklist")
    if isinstance(checklist_payload, dict) and checklist_payload.get("outcome"):
        checklist = ChecklistResult.model_validate(checklist_payload)
    else:
        checklist_confirmed = lesson.state == LearningState.CHECKLIST_CONFIRMED
        checklist = ChecklistResult(
            outcome=(
                ChecklistOutcome.EXACT_MATCH
                if checklist_confirmed
                else ChecklistOutcome.INPUT_INCOMPLETE
            ),
            identity_id=None,
            identity=lesson.identity if checklist_confirmed else None,
            candidate_count=1 if checklist_confirmed else 0,
            reasons=[
                "Legacy scan did not preserve a Checklist Registry receipt."
            ],
            source_receipts=["legacy_scan_checklist_receipt_missing"],
        )
    registry_identity_id, registry_fingerprint = _registry_receipts(checklist)
    predicted = lesson.rejected_identity or (
        local_suggestion.identity if local_suggestion else None
    )
    return TrainingExample(
        training_example_id=str(uuid4()),
        lesson_id=lesson.lesson_id,
        scan_id=lesson.scan_id,
        card_uuid=scan.get("card_uuid"),
        state=lesson.state,
        trusted=lesson.trusted,
        created_at=lesson.created_at,
        verification_source=lesson.verification_source,
        operator_id=lesson.operator_id,
        notes=lesson.notes,
        confirmed_identity=lesson.identity,
        predicted_identity=predicted,
        rejected_identity=lesson.rejected_identity,
        correction_fields=changed_fields(predicted, lesson.identity),
        local_suggestion=local_suggestion,
        local_vision=local_vision,
        checklist=checklist,
        registry_identity_id=registry_identity_id,
        registry_fingerprint_sha256=registry_fingerprint,
        front_sha256=scan["front_sha256"],
        back_sha256=scan.get("back_sha256"),
        image_pair_sha256=scan["image_pair_sha256"],
        front_perceptual_hash=scan.get("front_perceptual_hash"),
        back_perceptual_hash=scan.get("back_perceptual_hash"),
        serial_truth=build_serial_truth(
            identity=lesson.identity,
            local_vision=local_vision,
        ),
    )


def _training_prompt(example: TrainingExample) -> str:
    evidence = example.local_vision
    payload = {
        "task": "Read one trading card from front and back and return the exact structured identity and visible evidence.",
        "rules": [
            "Use only visible evidence plus the supplied checklist candidate space.",
            "Keep a physical stamped numerator separate from the checklist print-run denominator.",
            "Do not invent a stamp when only a checklist print run exists.",
            "Describe color and foil geometry such as velocity lines or cracked-ice facets.",
            "Return null for unknown values.",
        ],
        "deterministic_evidence": evidence.model_dump(mode="json") if evidence else None,
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _training_answer(example: TrainingExample) -> str:
    payload = {
        "identity": example.confirmed_identity.model_dump(mode="json"),
        "serial_truth": example.serial_truth.model_dump(mode="json"),
        "checklist_identity_id": example.registry_identity_id,
        "checklist_fingerprint_sha256": example.registry_fingerprint_sha256,
        "correction_fields": example.correction_fields,
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def _dataset_row(
    example: TrainingExample,
    *,
    image_store_path: Path,
) -> dict:
    front_path = persisted_image_path(
        image_store_path,
        example.front_sha256,
        "front",
    )
    images = [str(front_path)]
    if example.back_sha256:
        images.append(
            str(
                persisted_image_path(
                    image_store_path,
                    example.back_sha256,
                    "back",
                )
            )
        )
    return {
        "id": example.training_example_id,
        "images": images,
        "messages": [
            {
                "role": "user",
                "content": [
                    *[
                        {"type": "image", "image": image_path}
                        for image_path in images
                    ],
                    {"type": "text", "text": _training_prompt(example)},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": _training_answer(example)}
                ],
            },
        ],
        "metadata": {
            "scan_id": example.scan_id,
            "card_uuid": example.card_uuid,
            "lesson_id": example.lesson_id,
            "verification_source": example.verification_source,
            "state": example.state.value,
            "registry_identity_id": example.registry_identity_id,
            "registry_fingerprint_sha256": example.registry_fingerprint_sha256,
            "correction_fields": example.correction_fields,
        },
    }


def _split(example_id: str, validation_percent: int) -> str:
    bucket = int(hashlib.sha256(example_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "validation" if bucket < validation_percent else "train"


def export_training_dataset(
    examples: Iterable[TrainingExample],
    *,
    image_store_path: Path,
    destination_root: Path,
    validation_percent: int = 15,
) -> dict:
    if not 0 <= validation_percent <= 50:
        raise ValueError("validation_percent must be between 0 and 50")
    latest = latest_training_examples(examples)
    trusted = [example for example in latest if example.trusted]
    timestamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    destination = destination_root / timestamp
    destination.mkdir(parents=True, exist_ok=False)

    rows = [
        (_split(example.training_example_id, validation_percent), _dataset_row(example, image_store_path=image_store_path))
        for example in trusted
    ]
    counts = {"train": 0, "validation": 0}
    for split in counts:
        path = destination / f"{split}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row_split, row in rows:
                if row_split != split:
                    continue
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
                counts[split] += 1

    manifest = {
        "schema_version": "tcos.instacomp-ai.training-export.v1",
        "created_at": utc_now().isoformat(),
        "destination": str(destination),
        "trusted_examples": len(trusted),
        "train_examples": counts["train"],
        "validation_examples": counts["validation"],
        "validation_percent": validation_percent,
        "format": "mlx-vlm-compatible-chat-jsonl",
        "safety": {
            "trusted_states_only": [
                LearningState.OPERATOR_CONFIRMED.value,
                LearningState.CHECKLIST_CONFIRMED.value,
            ],
            "latest_teacher_truth_per_scan_only": True,
            "latest_teacher_truth_per_physical_card_when_uuid_present": True,
            "card_uuid_is_tracking_metadata_not_visual_label": True,
            "physical_serial_numerator_separate_from_print_run": True,
            "unconfirmed_examples_excluded": True,
        },
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def training_readiness(examples: Iterable[TrainingExample]) -> dict:
    latest = latest_training_examples(examples)
    trusted = [example for example in latest if example.trusted]
    operator = [
        example
        for example in trusted
        if example.state == LearningState.OPERATOR_CONFIRMED
    ]
    checklist = [
        example
        for example in trusted
        if example.state == LearningState.CHECKLIST_CONFIRMED
    ]
    with_boxes = [
        example
        for example in trusted
        if example.local_vision
        and (
            example.local_vision.front.ocr
            or (example.local_vision.back and example.local_vision.back.ocr)
        )
    ]
    with_pattern = [
        example
        for example in trusted
        if example.local_vision
        and example.local_vision.front.pattern.label != "unknown"
    ]
    with_serial = [
        example
        for example in trusted
        if example.serial_truth.visible_stamp_present
        or example.serial_truth.checklist_print_run
    ]
    minimum = 50
    recommended = 250
    return {
        "schema_version": "tcos.instacomp-ai.training-readiness.v1",
        "trusted_examples": len(trusted),
        "operator_confirmed": len(operator),
        "checklist_confirmed": len(checklist),
        "with_ocr_boxes": len(with_boxes),
        "with_pattern_labels": len(with_pattern),
        "with_serial_truth": len(with_serial),
        "minimum_lora_examples": minimum,
        "recommended_lora_examples": recommended,
        "ready_for_trial_lora": len(trusted) >= minimum and len(with_boxes) >= minimum // 2,
        "ready_for_production_candidate": len(trusted) >= recommended,
        "promotion_requires_locked_validation_improvement": True,
        "latest_teacher_truth_per_scan_only": True,
    }
