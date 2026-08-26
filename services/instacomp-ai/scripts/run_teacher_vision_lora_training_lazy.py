#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path
from typing import Iterable

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICE_VENV = SERVICE_ROOT / ".venv"
SERVICE_PYTHON = SERVICE_VENV / "bin" / "python"


def _bootstrap_service_runtime() -> None:
    if sys.platform != "darwin":
        return
    try:
        already_in_service_venv = Path(sys.prefix).resolve() == SERVICE_VENV.resolve()
    except OSError:
        already_in_service_venv = False
    if already_in_service_venv:
        return
    if not SERVICE_PYTHON.is_file():
        raise SystemExit(
            "InstaComp service runtime is missing. Run "
            "`bash services/instacomp-ai/scripts/install-macos.sh` once, then rerun."
        )
    os.execv(
        str(SERVICE_PYTHON),
        [str(SERVICE_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
    )


_bootstrap_service_runtime()

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import httpx

import app.teacher_vision_training as tvt
from app.config import Settings
from app.models import TrainingExample


COMPACT_TEXT_ARRAY = {
    "type": "array",
    "maxItems": 3,
    "items": {"type": "string", "maxLength": 180},
}

COMPACT_TEACHER_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "supports_canonical_truth": {"type": "boolean"},
        "front_visible_text": COMPACT_TEXT_ARRAY,
        "back_visible_text": COMPACT_TEXT_ARRAY,
        "logos": COMPACT_TEXT_ARRAY,
        "colors": COMPACT_TEXT_ARRAY,
        "foil_or_pattern": COMPACT_TEXT_ARRAY,
        "serial_evidence": COMPACT_TEXT_ARRAY,
        "positive_cues": COMPACT_TEXT_ARRAY,
        "negative_cues": COMPACT_TEXT_ARRAY,
        "student_miss_explanation": COMPACT_TEXT_ARRAY,
        "field_lessons": {
            "type": "object",
            "maxProperties": 6,
            "additionalProperties": {"type": "string", "maxLength": 240},
        },
        "uncertainty": {
            "type": "array",
            "maxItems": 2,
            "items": {"type": "string", "maxLength": 180},
        },
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


QWEN_MICRO_OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "supports_canonical_truth": {"type": "boolean"},
        "evidence": {"type": "string", "maxLength": 64},
        "student_miss": {"type": "string", "maxLength": 64},
    },
    "required": [
        "supports_canonical_truth",
        "evidence",
        "student_miss",
    ],
    "additionalProperties": False,
}


def _qwen_micro_prompt(example: TrainingExample) -> str:
    payload = {
        "task": (
            "Inspect the attached card images and return a tiny teaching record "
            "about the already-reviewed canonical identity."
        ),
        "canonical_truth": example.confirmed_identity.model_dump(mode="json"),
        "correction_fields": list(example.correction_fields),
        "rules": [
            "Do not change canonical identity.",
            "Return JSON only.",
            "Return exactly three keys.",
            "evidence must be six words or fewer.",
            "student_miss must be six words or fewer.",
            "No arrays.",
            "No nested objects.",
            "No markdown.",
            "No explanation.",
            "Close the JSON object immediately.",
        ],
    }
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def _compact_prompt(example: TrainingExample, *, retry: bool) -> str:
    suffix = (
        "\nOUTPUT SIZE CONTRACT: Return JSON only. Keep every array to at most 3 short visible-evidence "
        "phrases, each under 20 words. Keep field_lessons to at most 6 one-sentence lessons. "
        "Do not repeat canonical metadata. Do not write prose outside the JSON object."
    )
    if retry:
        suffix += (
            "\nRETRY COMPACT MODE: Your previous JSON was malformed or truncated. Be much shorter: "
            "at most 1 short phrase per array and at most 3 field_lessons. Finish the JSON object "
            "before adding detail."
        )
    return tvt._teacher_prompt(example) + suffix


class CompactRetryOllamaVisionTeacher(tvt.OllamaVisionTeacher):
    """Bound teacher output and retry once when Ollama returns truncated JSON."""

    async def _request(self, example: TrainingExample, images: list[dict], *, retry: bool) -> dict:
        encoded = [
            base64.b64encode(Path(image["path"]).read_bytes()).decode("ascii")
            for image in images
        ]
        qwen_micro = retry and self.model.startswith("qwen2.5vl")
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        _qwen_micro_prompt(example)
                        if qwen_micro
                        else _compact_prompt(example, retry=retry)
                    ),
                    "images": encoded,
                }
            ],
            "stream": False,
            "format": (
                QWEN_MICRO_OUTPUT_SCHEMA
                if qwen_micro
                else COMPACT_TEACHER_OUTPUT_SCHEMA
            ),
            "keep_alive": self.settings.teacher_vision_keep_alive,
            "options": {
                "temperature": 0.0,
                "num_ctx": 8192,
                "num_predict": (
                    384 if qwen_micro else (1536 if retry else 1280)
                ),
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
            return response.json()

    async def analyze(self, example: TrainingExample, images: list[dict]) -> dict:
        last_error: Exception | None = None
        envelope: dict | None = None
        parsed: dict | None = None
        attempts = 0

        for retry in (False, True):
            attempts += 1
            envelope = await self._request(example, images, retry=retry)
            message = envelope.get("message") or {}
            raw_content = str(message.get("content") or "").strip()
            done_reason = str(envelope.get("done_reason") or "").strip().lower()
            try:
                parsed_value = json.loads(raw_content)
                if not isinstance(parsed_value, dict):
                    raise json.JSONDecodeError("Teacher JSON root is not an object", raw_content, 0)
                if done_reason == "length":
                    raise json.JSONDecodeError("Teacher JSON hit generation length limit", raw_content, len(raw_content))
                if retry and self.model.startswith("qwen2.5vl"):
                    evidence = str(
                        parsed_value.get("evidence") or ""
                    ).strip()
                    student_miss = str(
                        parsed_value.get("student_miss") or ""
                    ).strip()

                    parsed_value = {
                        "supports_canonical_truth": bool(
                            parsed_value.get("supports_canonical_truth")
                        ),
                        "front_visible_text": [],
                        "back_visible_text": [],
                        "logos": [],
                        "colors": [],
                        "foil_or_pattern": [],
                        "serial_evidence": [],
                        "positive_cues": [evidence] if evidence else [],
                        "negative_cues": [],
                        "student_miss_explanation": (
                            [student_miss] if student_miss else []
                        ),
                        "field_lessons": {},
                        "uncertainty": [],
                    }

                parsed = parsed_value
                break
            except json.JSONDecodeError as exc:
                last_error = exc
                if retry:
                    break
                print(
                    "TEACHER JSON RETRY "
                    f"model={self.model} training_example_id={example.training_example_id} "
                    f"done_reason={done_reason or 'unknown'} raw_chars={len(raw_content)} "
                    f"error={str(exc)[:180]}",
                    flush=True,
                )

        if parsed is None or envelope is None:
            if last_error is not None:
                raise last_error
            raise RuntimeError("Teacher returned no parseable JSON")

        normalized = tvt._normalize_teacher_output(parsed)
        return {
            "schema_version": tvt.TEACHER_SCHEMA_VERSION,
            "created_at": tvt.utc_now_iso(),
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
                "compact_output_contract": True,
                "json_attempts": attempts,
            },
        }


async def mine_teacher_vision_lessons_lazy(
    examples: Iterable[TrainingExample],
    *,
    settings: Settings,
    image_store_path: Path,
    teacher_root: Path,
    validation_percent: int = tvt.DEFAULT_VALIDATION_PERCENT,
    force: bool = False,
    limit: int | None = None,
) -> dict:
    """Mine teacher receipts without a corpus-wide image-preparation front load."""
    if not settings.teacher_vision_enabled:
        return {
            "schema_version": tvt.TEACHER_SCHEMA_VERSION,
            "enabled": False,
            "models": [],
            "eligible_examples": 0,
            "generated": 0,
            "cached": 0,
            "failed": 0,
            "lazy_image_preparation": True,
            "compact_teacher_json": True,
        }

    models = tvt.configured_teacher_models(settings)
    if not models:
        raise RuntimeError("Teacher vision is enabled but no teacher models are configured")

    available = await tvt._available_ollama_models(settings)
    missing = [model for model in models if model not in available]
    if missing:
        raise RuntimeError(
            "Configured local teacher models are not installed in Ollama: " + ", ".join(missing)
        )

    latest = [example for example in tvt.latest_training_examples(examples) if example.trusted]
    training_examples = [
        example
        for example in latest
        if tvt._stable_split(example, validation_percent) == "train"
    ]
    training_examples.sort(key=tvt._teacher_priority)
    if limit is not None:
        training_examples = training_examples[: max(0, limit)]

    generated = 0
    cached = 0
    failures: list[dict] = []

    print(
        "TEACHER LAZY MINER ACTIVE "
        f"eligible_examples={len(training_examples)} models={','.join(models)} compact_json=true",
        flush=True,
    )

    for model in models:
        teacher = CompactRetryOllamaVisionTeacher(settings, model)
        model_generated = 0
        model_cached = 0
        print(
            f"TEACHER MODEL START model={model} eligible_examples={len(training_examples)}",
            flush=True,
        )
        for index, example in enumerate(training_examples, start=1):
            receipt_path = tvt._receipt_path(
                teacher_root,
                model,
                example.training_example_id,
            )
            if not force and tvt._receipt_is_current(receipt_path, example, model):
                cached += 1
                model_cached += 1
                continue

            print(
                "TEACHER CARD START "
                f"model={model} position={index}/{len(training_examples)} "
                f"training_example_id={example.training_example_id}",
                flush=True,
            )
            try:
                images = tvt.prepare_learning_images(
                    example,
                    image_store_path=image_store_path,
                    destination_root=teacher_root,
                    max_edge=settings.teacher_vision_image_max_edge,
                )
                receipt = await teacher.analyze(example, images)
                tvt._write_json_atomic(receipt_path, receipt)
                generated += 1
                model_generated += 1
                print(
                    "TEACHER RECEIPT WRITTEN "
                    f"model={model} generated_for_model={model_generated} "
                    f"cached_for_model={model_cached} position={index}/{len(training_examples)} "
                    f"training_example_id={example.training_example_id}",
                    flush=True,
                )
            except Exception as exc:
                failures.append(
                    {
                        "model": model,
                        "training_example_id": example.training_example_id,
                        "error": f"{type(exc).__name__}:{str(exc)[:400]}",
                    }
                )
                print(
                    "TEACHER RECEIPT FAILURE "
                    f"model={model} position={index}/{len(training_examples)} "
                    f"training_example_id={example.training_example_id} "
                    f"error={type(exc).__name__}:{str(exc)[:200]}",
                    flush=True,
                )

        print(
            "TEACHER MODEL COMPLETE "
            f"model={model} generated={model_generated} cached={model_cached}",
            flush=True,
        )

    return {
        "schema_version": tvt.TEACHER_SCHEMA_VERSION,
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
        "lazy_image_preparation": True,
        "compact_teacher_json": True,
    }


def main() -> int:
    # build_teacher_augmented_dataset resolves this global at runtime, so replacing
    # only the miner preserves Registry truth, validation, Prizm rules, export,
    # and LoRA behavior while making teacher generation resumable and bounded.
    tvt.mine_teacher_vision_lessons = mine_teacher_vision_lessons_lazy

    import run_teacher_vision_lora_training as runner

    return runner.main()


if __name__ == "__main__":
    raise SystemExit(main())
