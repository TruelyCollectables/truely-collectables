from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import httpx
from PIL import Image, ImageOps

from .config import Settings
from .images import persisted_image_path
from .models import TrainingExample
from .training import latest_training_examples

TEACHER_SCHEMA_VERSION = "tcos.instacomp-ai.teacher-vision-receipt.v1"
DATASET_SCHEMA_VERSION = "tcos.instacomp-ai.teacher-vision-dataset.v1"
DEFAULT_VALIDATION_PERCENT = 15

TEACHER_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "supports_canonical_truth": {"type": "boolean"},
        "front_visible_text": {"type": "array", "items": {"type": "string"}},
        "back_visible_text": {"type": "array", "items": {"type": "string"}},
        "logos": {"type": "array", "items": {"type": "string"}},
        "colors": {"type": "array", "items": {"type": "string"}},
        "foil_or_pattern": {"type": "array", "items": {"type": "string"}},
        "serial_evidence": {"type": "array", "items": {"type": "string"}},
        "positive_cues": {"type": "array", "items": {"type": "string"}},
        "negative_cues": {"type": "array", "items": {"type": "string"}},
        "student_miss_explanation": {"type": "array", "items": {"type": "string"}},
        "field_lessons": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "uncertainty": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "supports_canonical_truth",
        "front_visible_text",
        "back_visible_text",
        "logos",
        "colors",
        "foil_or_pattern",
        "serial_evidence",
        "positive_cues",
        "negative_cues",
        "student_miss_explanation",
        "field_lessons",
        "uncertainty",
    ],
}

PRIZM_TRAINING_RULE = (
    "For Panini Prizm-family cards: no qualifying bold black standalone PRIZM on the back "
    "means Base. A qualifying back PRIZM mark means at least Silver Prizm. Stronger named "
    "parallels require stronger front color/foil/pattern evidence such as Green, Red, Blue, "
    "Ice, Velocity, etc."
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def configured_teacher_models(settings: Settings) -> list[str]:
    models = [value.strip() for value in settings.teacher_vision_models.split(",")]
    return list(dict.fromkeys(value for value in models if value))


def _safe_model_dir(model: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", model.strip())
    return value.strip("-") or "teacher"


def _stable_split(example: TrainingExample, validation_percent: int) -> str:
    key = example.card_uuid or example.training_example_id
    bucket = int(hashlib.sha256(key.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "validation" if bucket < validation_percent else "train"


def _teacher_priority(example: TrainingExample) -> tuple[int, str]:
    # Hard mistakes first, especially parallel mistakes; then the remaining corpus.
    corrections = set(example.correction_fields)
    if "parallel" in corrections:
        return (0, example.training_example_id)
    if corrections:
        return (1, example.training_example_id)
    return (2, example.training_example_id)


def ai_learning_image_path(
    root: Path,
    source_sha256: str,
    side: str,
    max_edge: int,
) -> Path:
    normalized_sha = source_sha256.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", normalized_sha):
        raise ValueError("Invalid source image hash")
    if side not in {"front", "back"}:
        raise ValueError("AI learning image side must be front or back")
    return (
        root
        / "ai-images"
        / str(max_edge)
        / normalized_sha[:2]
        / normalized_sha[2:4]
        / f"{normalized_sha}-{side}-ai-{max_edge}.jpg"
    )


def ensure_ai_learning_image(
    *,
    archive_path: Path,
    destination_root: Path,
    source_sha256: str,
    side: str,
    max_edge: int,
) -> dict:
    if max_edge < 512:
        raise ValueError("AI learning images must keep at least a 512px max edge")
    target = ai_learning_image_path(destination_root, source_sha256, side, max_edge)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_file():
        if not archive_path.is_file():
            raise FileNotFoundError(f"Archived {side} image is missing: {archive_path}")
        with Image.open(archive_path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            image.save(
                target,
                format="JPEG",
                quality=88,
                optimize=True,
                progressive=True,
                subsampling=0,
            )
    content = target.read_bytes()
    with Image.open(target) as prepared:
        width, height = prepared.size
    return {
        "path": str(target),
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
        "width": width,
        "height": height,
        "source_sha256": source_sha256,
        "side": side,
        "max_edge": max_edge,
    }


def prepare_learning_images(
    example: TrainingExample,
    *,
    image_store_path: Path,
    destination_root: Path,
    max_edge: int,
) -> list[dict]:
    images = [
        ensure_ai_learning_image(
            archive_path=persisted_image_path(
                image_store_path,
                example.front_sha256,
                "front",
            ),
            destination_root=destination_root,
            source_sha256=example.front_sha256,
            side="front",
            max_edge=max_edge,
        )
    ]
    if example.back_sha256:
        images.append(
            ensure_ai_learning_image(
                archive_path=persisted_image_path(
                    image_store_path,
                    example.back_sha256,
                    "back",
                ),
                destination_root=destination_root,
                source_sha256=example.back_sha256,
                side="back",
                max_edge=max_edge,
            )
        )
    return images


def _teacher_prompt(example: TrainingExample) -> str:
    payload = {
        "role": "offline_training_teacher_only",
        "authority": {
            "identity_authority": False,
            "registry_mutation_allowed": False,
            "card_uuid_mutation_allowed": False,
            "pricing_authority": False,
            "inventory_mutation_allowed": False,
            "auto_promotion": False,
        },
        "task": (
            "Study the front and back images and explain the visible evidence that teaches a "
            "smaller student vision model why the already-reviewed canonical identity is correct, "
            "and what visible cue the student missed. Do not replace or revise canonical truth."
        ),
        "canonical_truth": example.confirmed_identity.model_dump(mode="json"),
        "student_prediction": (
            example.predicted_identity.model_dump(mode="json")
            if example.predicted_identity
            else None
        ),
        "correction_fields": list(example.correction_fields),
        "serial_truth": example.serial_truth.model_dump(mode="json"),
        "deterministic_local_vision": (
            example.local_vision.model_dump(mode="json")
            if example.local_vision
            else None
        ),
        "rules": [
            "Return visible evidence and teaching explanations only; never return a replacement identity.",
            "If the pixels do not support canonical truth, set supports_canonical_truth=false and explain uncertainty.",
            "Keep front text and back text separate.",
            "Mine logos, card number, player/team text, manufacturer/set cues, rookie marks, serial stamps, autograph, inscription, memorabilia, colors, foil, and surface geometry.",
            "Explain negative evidence: what is absent that rules out the student's wrong answer or a stronger parallel.",
            PRIZM_TRAINING_RULE,
            "A visible serial numerator is physical-copy truth; the print-run denominator is configuration-level truth.",
            "Do not invent facts that are not visible in the images or deterministic evidence.",
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _normalize_text_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = re.sub(r"\s+", " ", str(item or "")).strip()
        if text and text not in result:
            result.append(text[:500])
    return result[:100]


def _normalize_teacher_output(value: object) -> dict:
    payload = value if isinstance(value, dict) else {}
    fields = [
        "front_visible_text",
        "back_visible_text",
        "logos",
        "colors",
        "foil_or_pattern",
        "serial_evidence",
        "positive_cues",
        "negative_cues",
        "student_miss_explanation",
        "uncertainty",
    ]
    normalized = {
        "supports_canonical_truth": bool(payload.get("supports_canonical_truth")),
        **{field: _normalize_text_list(payload.get(field)) for field in fields},
    }
    raw_lessons = payload.get("field_lessons")
    lessons: dict[str, str] = {}
    if isinstance(raw_lessons, dict):
        for key, raw_value in raw_lessons.items():
            field = re.sub(r"[^A-Za-z0-9_]+", "_", str(key)).strip("_")[:80]
            text = re.sub(r"\s+", " ", str(raw_value or "")).strip()[:1000]
            if field and text:
                lessons[field] = text
    normalized["field_lessons"] = lessons
    return normalized


class OllamaVisionTeacher:
    def __init__(self, settings: Settings, model: str):
        self.settings = settings
        self.model = model

    async def analyze(self, example: TrainingExample, images: list[dict]) -> dict:
        encoded = [
            base64.b64encode(Path(image["path"]).read_bytes()).decode("ascii")
            for image in images
        ]
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": _teacher_prompt(example),
                    "images": encoded,
                }
            ],
            "stream": False,
            "format": TEACHER_OUTPUT_SCHEMA,
            "keep_alive": self.settings.teacher_vision_keep_alive,
            "options": {
                "temperature": 0.0,
                "num_ctx": 8192,
                "num_predict": 2048,
                "seed": 0,
            },
        }
        async with httpx.AsyncClient(
            timeout=self.settings.teacher_vision_timeout_seconds
        ) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        message = envelope.get("message") or {}
        raw_content = str(message.get("content") or "").strip()
        parsed = json.loads(raw_content)
        normalized = _normalize_teacher_output(parsed)
        return {
            "schema_version": TEACHER_SCHEMA_VERSION,
            "created_at": utc_now_iso(),
            "role": "offline_training_teacher_only",
            "student_mode": True,
            "identity_authority": False,
            "registry_mutation_allowed": False,
            "card_uuid_mutation_allowed": False,
            "pricing_authority": False,
            "inventory_mutation_allowed": False,
            "auto_promotion": False,
            "model": self.model,
            "training_example_id": example.training_example_id,
            "scan_id": example.scan_id,
            "card_uuid": example.card_uuid,
            "registry_identity_id": example.registry_identity_id,
            "registry_fingerprint_sha256": example.registry_fingerprint_sha256,
            "front_sha256": example.front_sha256,
            "back_sha256": example.back_sha256,
            "image_pair_sha256": example.image_pair_sha256,
            "correction_fields": list(example.correction_fields),
            "prepared_images": images,
            "lesson": normalized,
            "transport": {
                "provider": "local_ollama",
                "endpoint": "/api/chat",
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
            },
        }


async def _available_ollama_models(settings: Settings) -> set[str]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
        response.raise_for_status()
        payload = response.json()
    available: set[str] = set()
    for item in payload.get("models") or []:
        if not isinstance(item, dict):
            continue
        for field in ("name", "model"):
            value = str(item.get(field) or "").strip()
            if value:
                available.add(value)
    return available


def _receipt_path(root: Path, model: str, example_id: str) -> Path:
    return root / "teacher-receipts" / _safe_model_dir(model) / f"{example_id}.json"


def _receipt_is_current(path: Path, example: TrainingExample, model: str) -> bool:
    if not path.is_file():
        return False
    try:
        payload = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return bool(
        payload.get("schema_version") == TEACHER_SCHEMA_VERSION
        and payload.get("model") == model
        and payload.get("training_example_id") == example.training_example_id
        and payload.get("front_sha256") == example.front_sha256
        and payload.get("back_sha256") == example.back_sha256
        and payload.get("registry_identity_id") == example.registry_identity_id
        and payload.get("registry_fingerprint_sha256") == example.registry_fingerprint_sha256
    )


def _write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), "utf-8")
    temp.replace(path)


async def mine_teacher_vision_lessons(
    examples: Iterable[TrainingExample],
    *,
    settings: Settings,
    image_store_path: Path,
    teacher_root: Path,
    validation_percent: int = DEFAULT_VALIDATION_PERCENT,
    force: bool = False,
    limit: int | None = None,
) -> dict:
    if not settings.teacher_vision_enabled:
        return {
            "schema_version": TEACHER_SCHEMA_VERSION,
            "enabled": False,
            "models": [],
            "eligible_examples": 0,
            "generated": 0,
            "cached": 0,
            "failed": 0,
        }
    models = configured_teacher_models(settings)
    if not models:
        raise RuntimeError("Teacher vision is enabled but no teacher models are configured")

    available = await _available_ollama_models(settings)
    missing = [model for model in models if model not in available]
    if missing:
        raise RuntimeError(
            "Configured local teacher models are not installed in Ollama: " + ", ".join(missing)
        )

    latest = [example for example in latest_training_examples(examples) if example.trusted]
    training_examples = [
        example
        for example in latest
        if _stable_split(example, validation_percent) == "train"
    ]
    training_examples.sort(key=_teacher_priority)
    if limit is not None:
        training_examples = training_examples[: max(0, limit)]

    prepared_by_id: dict[str, list[dict]] = {}
    for example in training_examples:
        prepared_by_id[example.training_example_id] = prepare_learning_images(
            example,
            image_store_path=image_store_path,
            destination_root=teacher_root,
            max_edge=settings.teacher_vision_image_max_edge,
        )

    generated = 0
    cached = 0
    failures: list[dict] = []
    # Model-major order keeps one local model hot while it teaches the whole corpus.
    for model in models:
        teacher = OllamaVisionTeacher(settings, model)
        for example in training_examples:
            receipt_path = _receipt_path(
                teacher_root,
                model,
                example.training_example_id,
            )
            if not force and _receipt_is_current(receipt_path, example, model):
                cached += 1
                continue
            try:
                receipt = await teacher.analyze(
                    example,
                    prepared_by_id[example.training_example_id],
                )
                _write_json_atomic(receipt_path, receipt)
                generated += 1
            except Exception as exc:  # receipt records stay resumable; one card does not poison the run
                failures.append(
                    {
                        "model": model,
                        "training_example_id": example.training_example_id,
                        "error": f"{type(exc).__name__}:{str(exc)[:400]}",
                    }
                )

    return {
        "schema_version": TEACHER_SCHEMA_VERSION,
        "enabled": True,
        "models": models,
        "available_models": sorted(available),
        "eligible_examples": len(training_examples),
        "expected_receipts": len(training_examples) * len(models),
        "generated": generated,
        "cached": cached,
        "failed": len(failures),
        "failures": failures[:100],
        "teacher_root": str(teacher_root),
        "image_max_edge": settings.teacher_vision_image_max_edge,
        "hard_examples_first": True,
    }


def _load_teacher_receipts(
    example: TrainingExample,
    *,
    teacher_root: Path,
    models: list[str],
) -> list[dict]:
    receipts: list[dict] = []
    for model in models:
        path = _receipt_path(teacher_root, model, example.training_example_id)
        if not _receipt_is_current(path, example, model):
            continue
        try:
            payload = json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        lesson = payload.get("lesson") or {}
        if lesson.get("supports_canonical_truth") is not True:
            continue
        receipts.append(payload)
    return receipts


def _consensus_lesson(receipts: list[dict]) -> dict | None:
    if not receipts:
        return None
    list_fields = [
        "front_visible_text",
        "back_visible_text",
        "logos",
        "colors",
        "foil_or_pattern",
        "serial_evidence",
        "positive_cues",
        "negative_cues",
        "student_miss_explanation",
        "uncertainty",
    ]
    merged: dict[str, object] = {
        "teacher_role": "advisory_training_target_only",
        "teacher_models": [receipt.get("model") for receipt in receipts],
        "identity_authority": False,
        "registry_mutation_allowed": False,
        "pricing_authority": False,
    }
    for field in list_fields:
        values: list[str] = []
        for receipt in receipts:
            lesson = receipt.get("lesson") or {}
            for value in lesson.get(field) or []:
                text = str(value).strip()
                if text and text not in values:
                    values.append(text)
        merged[field] = values[:150]
    field_lessons: dict[str, list[str]] = {}
    for receipt in receipts:
        lesson = receipt.get("lesson") or {}
        for field, text in (lesson.get("field_lessons") or {}).items():
            field_lessons.setdefault(str(field), [])
            normalized = str(text).strip()
            if normalized and normalized not in field_lessons[str(field)]:
                field_lessons[str(field)].append(normalized)
    merged["field_lessons"] = field_lessons
    return merged


def _student_prompt(example: TrainingExample) -> str:
    payload = {
        "task": "Read one trading card from front and back and return the exact structured identity and visible evidence.",
        "rules": [
            "Use the images and deterministic evidence; the images are the primary visual source.",
            "Keep front-only text and back-only text separate.",
            "Keep a physical stamped numerator separate from the checklist print-run denominator.",
            "Do not invent a stamp when only a checklist print run exists.",
            "Describe color and foil geometry such as velocity lines or cracked-ice facets.",
            PRIZM_TRAINING_RULE,
            "Return null for unknown values.",
        ],
        "deterministic_evidence": (
            example.local_vision.model_dump(mode="json")
            if example.local_vision
            else None
        ),
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _student_answer(example: TrainingExample, teacher_lesson: dict | None) -> str:
    payload = {
        "identity": example.confirmed_identity.model_dump(mode="json"),
        "serial_truth": example.serial_truth.model_dump(mode="json"),
        "checklist_identity_id": example.registry_identity_id,
        "checklist_fingerprint_sha256": example.registry_fingerprint_sha256,
        "correction_fields": list(example.correction_fields),
        # Teacher analysis is learned as an answer-side rationale, never as input truth.
        "teacher_visual_lesson": teacher_lesson,
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _dataset_row(
    example: TrainingExample,
    *,
    images: list[dict],
    teacher_lesson: dict | None,
    row_id: str,
) -> dict:
    image_paths = [image["path"] for image in images]
    return {
        "id": row_id,
        "images": image_paths,
        "messages": [
            {
                "role": "user",
                "content": [
                    *[
                        {"type": "image", "image": image_path}
                        for image_path in image_paths
                    ],
                    {"type": "text", "text": _student_prompt(example)},
                ],
            },
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": _student_answer(example, teacher_lesson),
                    }
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
            "correction_fields": list(example.correction_fields),
            "teacher_models": (
                list(teacher_lesson.get("teacher_models") or [])
                if teacher_lesson
                else []
            ),
            "teacher_identity_authority": False,
            "ai_learning_images": images,
        },
    }


def export_teacher_augmented_dataset(
    examples: Iterable[TrainingExample],
    *,
    settings: Settings,
    image_store_path: Path,
    destination_root: Path,
    teacher_root: Path,
    validation_percent: int = DEFAULT_VALIDATION_PERCENT,
) -> dict:
    if not 0 <= validation_percent <= 50:
        raise ValueError("validation_percent must be between 0 and 50")
    latest = [example for example in latest_training_examples(examples) if example.trusted]
    models = configured_teacher_models(settings)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = destination_root / f"teacher-{timestamp}"
    destination.mkdir(parents=True, exist_ok=False)

    counts = {"train": 0, "validation": 0}
    base_examples = {"train": 0, "validation": 0}
    hard_examples = 0
    teacher_enriched = 0
    missing_teacher_receipts = 0
    derivative_bytes = 0

    handles = {
        split: (destination / f"{split}.jsonl").open("w", encoding="utf-8")
        for split in counts
    }
    try:
        for example in latest:
            split = _stable_split(example, validation_percent)
            base_examples[split] += 1
            images = prepare_learning_images(
                example,
                image_store_path=image_store_path,
                destination_root=teacher_root,
                max_edge=settings.teacher_vision_image_max_edge,
            )
            derivative_bytes += sum(int(image["bytes"]) for image in images)
            teacher_lesson = None
            multiplier = 1
            if split == "train":
                receipts = _load_teacher_receipts(
                    example,
                    teacher_root=teacher_root,
                    models=models,
                )
                teacher_lesson = _consensus_lesson(receipts)
                if teacher_lesson:
                    teacher_enriched += 1
                else:
                    missing_teacher_receipts += 1
                if example.correction_fields:
                    hard_examples += 1
                    multiplier = max(1, settings.teacher_vision_hard_example_multiplier)
                    if "parallel" in set(example.correction_fields):
                        multiplier += 1

            # Validation remains teacher-free and is never oversampled. Frozen/held-out
            # proof therefore measures the student without teacher assistance.
            for copy_index in range(multiplier):
                suffix = "" if copy_index == 0 else f":hard:{copy_index}"
                row = _dataset_row(
                    example,
                    images=images,
                    teacher_lesson=teacher_lesson if split == "train" else None,
                    row_id=f"{example.training_example_id}{suffix}",
                )
                handles[split].write(json.dumps(row, ensure_ascii=False) + "\n")
                counts[split] += 1
    finally:
        for handle in handles.values():
            handle.close()

    manifest = {
        "schema_version": DATASET_SCHEMA_VERSION,
        "created_at": utc_now_iso(),
        "destination": str(destination),
        "train_examples": counts["train"],
        "validation_examples": counts["validation"],
        "base_train_examples": base_examples["train"],
        "base_validation_examples": base_examples["validation"],
        "hard_examples": hard_examples,
        "teacher_enriched_train_examples": teacher_enriched,
        "missing_teacher_receipts": missing_teacher_receipts,
        "teacher_models": models,
        "teacher_identity_authority": False,
        "teacher_registry_mutation_allowed": False,
        "teacher_pricing_authority": False,
        "teacher_auto_promotion": False,
        "student_validation_teacher_disabled": True,
        "hard_example_multiplier": settings.teacher_vision_hard_example_multiplier,
        "parallel_hard_example_bonus": 1,
        "ai_learning_image_max_edge": settings.teacher_vision_image_max_edge,
        "ai_learning_derivative_bytes_referenced": derivative_bytes,
        "original_archived_images_mutated": False,
        "prizm_rule": PRIZM_TRAINING_RULE,
    }
    (destination / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        "utf-8",
    )
    return manifest


def build_teacher_augmented_dataset(
    examples: Iterable[TrainingExample],
    *,
    settings: Settings,
    image_store_path: Path,
    destination_root: Path,
    teacher_root: Path,
    validation_percent: int = DEFAULT_VALIDATION_PERCENT,
    force_teacher: bool = False,
    teacher_limit: int | None = None,
) -> tuple[dict, dict]:
    examples_list = list(examples)
    mining = asyncio.run(
        mine_teacher_vision_lessons(
            examples_list,
            settings=settings,
            image_store_path=image_store_path,
            teacher_root=teacher_root,
            validation_percent=validation_percent,
            force=force_teacher,
            limit=teacher_limit,
        )
    )
    dataset = export_teacher_augmented_dataset(
        examples_list,
        settings=settings,
        image_store_path=image_store_path,
        destination_root=destination_root,
        teacher_root=teacher_root,
        validation_percent=validation_percent,
    )
    return mining, dataset
