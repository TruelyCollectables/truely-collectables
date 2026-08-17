#!/usr/bin/env python3
from __future__ import annotations

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

import app.teacher_vision_training as tvt
from app.config import Settings
from app.models import TrainingExample


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
    """Mine teacher receipts without a corpus-wide image-preparation front load.

    Cached receipts are checked first. Images are prepared only for the next card
    that actually needs a new receipt, then the receipt is written immediately.
    This preserves model-major ordering so one Ollama teacher stays hot while
    making the existing heartbeat reflect real teaching progress.
    """
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
        f"eligible_examples={len(training_examples)} models={','.join(models)}",
        flush=True,
    )

    # Model-major order intentionally remains unchanged so one local model stays
    # resident/hot while it teaches the corpus. The only change is WHEN images
    # are prepared: after a missing receipt is identified, never before.
    for model in models:
        teacher = tvt.OllamaVisionTeacher(settings, model)
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
                if model_generated <= 3 or model_generated % 10 == 0:
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
    }


def main() -> int:
    # build_teacher_augmented_dataset resolves this global from the module at run
    # time, so swapping only the miner leaves export, truth authority, validation,
    # Prizm rules, and LoRA training behavior untouched.
    tvt.mine_teacher_vision_lessons = mine_teacher_vision_lessons_lazy

    import run_teacher_vision_lora_training as runner

    return runner.main()


if __name__ == "__main__":
    raise SystemExit(main())
