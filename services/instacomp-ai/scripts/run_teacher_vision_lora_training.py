#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SERVICE_VENV = SERVICE_ROOT / ".venv"
SERVICE_PYTHON = SERVICE_VENV / "bin" / "python"


def _bootstrap_service_runtime() -> None:
    """Run teacher mining under the certified InstaComp service environment on macOS.

    The teacher pipeline imports the normal InstaComp vision stack (including OpenCV)
    before it hands LoRA training to the separate `.venv-lora` runtime. A user may
    legitimately launch this script with Homebrew `python3`, so re-exec into the
    already-installed service `.venv` before importing any app modules.
    """

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
            "`bash services/instacomp-ai/scripts/install-macos.sh` once, then rerun "
            "this teacher command."
        )

    os.execv(
        str(SERVICE_PYTHON),
        [str(SERVICE_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
    )


_bootstrap_service_runtime()

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.storage import MemoryStore
from app.teacher_vision_prompt_evidence import compact_training_examples_for_prompt
from app.teacher_vision_training import build_teacher_augmented_dataset
from app.training import training_readiness
from run_lora_training import (
    DEFAULT_MODEL,
    DEFAULT_STEPS_PER_SAVE,
    build_lora_command,
    preflight_training_runtime,
    prepare_resume_adapter_bundle,
)


def _configured_teacher_models() -> list[str]:
    return list(
        dict.fromkeys(
            value.strip()
            for value in settings.teacher_vision_models.split(",")
            if value.strip()
        )
    )


def _safe_model_dir(model: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", model.strip())
    return value.strip("-") or "teacher"


def _receipt_snapshot(teacher_root: Path, models: list[str], *, started_wall: float) -> dict:
    counts: dict[str, int] = {}
    written_this_run: dict[str, int] = {}
    newest_mtime = 0.0
    for model in models:
        root = teacher_root / "teacher-receipts" / _safe_model_dir(model)
        count = 0
        recent = 0
        if root.is_dir():
            for path in root.glob("*.json"):
                try:
                    stat = path.stat()
                except OSError:
                    continue
                count += 1
                newest_mtime = max(newest_mtime, stat.st_mtime)
                if stat.st_mtime >= started_wall:
                    recent += 1
        counts[model] = count
        written_this_run[model] = recent
    return {
        "receipt_counts": counts,
        "total_receipts": sum(counts.values()),
        "written_this_run": written_this_run,
        "total_written_this_run": sum(written_this_run.values()),
        "newest_receipt_mtime": newest_mtime or None,
    }


def _start_teacher_heartbeat(
    *,
    teacher_root: Path,
    models: list[str],
    trusted_examples: int,
    interval_seconds: float = 15.0,
) -> tuple[threading.Event, threading.Thread]:
    stop = threading.Event()
    started_monotonic = time.monotonic()
    started_wall = time.time()

    def worker() -> None:
        while not stop.wait(interval_seconds):
            snapshot = _receipt_snapshot(
                teacher_root,
                models,
                started_wall=started_wall,
            )
            payload = {
                "status": "teacher_mining_alive",
                "elapsed_seconds": round(time.monotonic() - started_monotonic, 1),
                "trusted_examples_loaded": trusted_examples,
                "teacher_models": models,
                "request_timeout_seconds": settings.teacher_vision_timeout_seconds,
                "image_max_edge": settings.teacher_vision_image_max_edge,
                **snapshot,
            }
            print("TEACHER MINING HEARTBEAT " + json.dumps(payload, sort_keys=True), flush=True)

    thread = threading.Thread(
        target=worker,
        name="instacomp-teacher-mining-heartbeat",
        daemon=True,
    )
    thread.start()
    return stop, thread


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Mine trusted card truth with local Ollama vision teachers, build reusable "
            "768px AI-learning images, export teacher-augmented SFT data, and train "
            "the private InstaComp LoRA student."
        )
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--teacher-models", default=None)
    parser.add_argument("--teacher-limit", type=int, default=None)
    parser.add_argument("--force-teacher", action="store_true")
    parser.add_argument("--allow-partial-teachers", action="store_true")
    parser.add_argument("--mine-only", action="store_true")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--iters", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--resume-adapter", type=Path, default=None)
    parser.add_argument("--allow-small-dataset", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()

    if args.teacher_models:
        settings.teacher_vision_models = args.teacher_models
    if args.teacher_limit is not None and args.teacher_limit < 1:
        raise SystemExit("--teacher-limit must be greater than zero")
    if args.teacher_limit is not None and not args.mine_only:
        raise SystemExit(
            "A limited teacher pass is a smoke test only. Use --mine-only with "
            "--teacher-limit, then rerun without the limit for full training."
        )

    runtime = preflight_training_runtime()
    print(json.dumps(runtime, indent=2), flush=True)
    if args.preflight_only:
        return 0

    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    examples = store.list_training_examples(trusted_only=True, limit=100_000)
    readiness = training_readiness(examples)
    if not readiness["ready_for_trial_lora"] and not args.allow_small_dataset:
        print(json.dumps(readiness, indent=2), flush=True)
        raise SystemExit(
            "Training blocked: collect at least 50 trusted examples with OCR evidence. "
            "Use --allow-small-dataset only for a disposable engineering smoke test."
        )

    # Preserve the raw TrainingExample/LocalVisionEvidence in SQLite. The teacher
    # pipeline receives a prompt-only copy whose OCR/CV evidence is bounded by the
    # same compact serializer used by the established local vision reader. This
    # keeps the useful text/color/pattern/serial evidence while dropping context-
    # wasting coordinate arrays from every repeated teacher/student prompt.
    prompt_examples = compact_training_examples_for_prompt(examples)

    image_store = settings.resolve_local_path(settings.image_store_path)
    teacher_root = settings.resolve_local_path("./data/training/teacher-vision")
    teacher_root.mkdir(parents=True, exist_ok=True)
    export_root = settings.resolve_local_path(settings.training_export_path)
    teacher_models = _configured_teacher_models()
    started_wall = time.time()
    before = _receipt_snapshot(teacher_root, teacher_models, started_wall=started_wall)
    print(
        "TEACHER MINING START "
        + json.dumps(
            {
                "trusted_examples_loaded": len(prompt_examples),
                "teacher_models": teacher_models,
                "teacher_limit": args.teacher_limit,
                "force_teacher": args.force_teacher,
                "image_max_edge": settings.teacher_vision_image_max_edge,
                "request_timeout_seconds": settings.teacher_vision_timeout_seconds,
                "heartbeat_seconds": 15,
                "existing_receipts": before["receipt_counts"],
                "resumable_receipts": True,
            },
            sort_keys=True,
        ),
        flush=True,
    )
    heartbeat_stop, heartbeat_thread = _start_teacher_heartbeat(
        teacher_root=teacher_root,
        models=teacher_models,
        trusted_examples=len(prompt_examples),
        interval_seconds=15.0,
    )
    try:
        mining, manifest = build_teacher_augmented_dataset(
            prompt_examples,
            settings=settings,
            image_store_path=image_store,
            destination_root=export_root,
            teacher_root=teacher_root,
            validation_percent=15,
            force_teacher=args.force_teacher,
            teacher_limit=args.teacher_limit,
        )
    finally:
        heartbeat_stop.set()
        heartbeat_thread.join(timeout=2.0)
    after = _receipt_snapshot(teacher_root, teacher_models, started_wall=started_wall)
    print(
        "TEACHER MINING COMPLETE "
        + json.dumps(
            {
                "receipt_counts": after["receipt_counts"],
                "written_this_run": after["written_this_run"],
                "total_written_this_run": after["total_written_this_run"],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    print(json.dumps({"teacher_mining": mining, "dataset": manifest}, indent=2), flush=True)

    if mining.get("failed") and not args.allow_partial_teachers:
        raise SystemExit(
            "Teacher mining had failures. Receipts are cached and resumable; rerun the same "
            "command to fill only the missing teacher lessons, or explicitly use "
            "--allow-partial-teachers for an engineering-only run."
        )
    if args.mine_only:
        return 0

    # Hard pre-training gate: LoRA may start only when the complete configured
    # teacher set is accounted for and the combined dataset reports no missing
    # teacher receipts. This is independent of the miner's failure counter.
    if not args.allow_partial_teachers:
        expected_receipts = int(mining.get("expected_receipts") or 0)
        completed_receipts = (
            int(mining.get("generated") or 0)
            + int(mining.get("cached") or 0)
        )
        failed_receipts = int(mining.get("failed") or 0)
        missing_teacher_receipts = int(
            manifest.get("missing_teacher_receipts") or 0
        )

        manifest_models = set(manifest.get("teacher_models") or [])
        configured_models = set(teacher_models)

        if (
            failed_receipts != 0
            or expected_receipts <= 0
            or completed_receipts != expected_receipts
            or missing_teacher_receipts != 0
            or manifest_models != configured_models
        ):
            raise SystemExit(
                "STRICT TEACHER TRAINING GATE BLOCKED LoRA: "
                f"failed={failed_receipts}, "
                f"completed={completed_receipts}, "
                f"expected={expected_receipts}, "
                f"missing_teacher_receipts={missing_teacher_receipts}, "
                f"configured_models={sorted(configured_models)}, "
                f"manifest_models={sorted(manifest_models)}. "
                "Teacher receipts remain cached; LoRA was not started."
            )

        print(
            "STRICT TEACHER TRAINING GATE PASSED "
            f"completed={completed_receipts}/{expected_receipts} "
            f"missing_teacher_receipts={missing_teacher_receipts} "
            f"models={','.join(sorted(configured_models))}",
            flush=True,
        )

    adapter_root = settings.resolve_local_path("./data/training/adapters")
    adapter_root.mkdir(parents=True, exist_ok=True)
    resume_adapter_input = args.resume_adapter.expanduser().resolve() if args.resume_adapter else None
    resume_bundle = prepare_resume_adapter_bundle(
        resume_adapter_input,
        adapter_root=adapter_root,
    )

    dataset_path = Path(manifest["destination"])
    adapter_bundle = adapter_root / f"instacomp-{dataset_path.name}"
    adapter_path = adapter_bundle / "adapters.safetensors"

    # MLX-VLM 0.6.8 resume writes adapter weights to the new output path but
    # does not recreate adapter_config.json there. Seed the known-good config
    # from the validated resume bundle before training starts so every resumed
    # checkpoint/output remains a complete recoverable adapter bundle.
    adapter_bundle.mkdir(parents=True, exist_ok=True)
    if resume_bundle is not None:
        resume_config = resume_bundle / "adapter_config.json"
        output_config = adapter_bundle / "adapter_config.json"
        if not resume_config.is_file():
            raise SystemExit(
                f"Resume bundle lost adapter_config.json: {resume_config}"
            )
        shutil.copy2(resume_config, output_config)
        print(
            f"RESUME ADAPTER CONFIG SEEDED {output_config}",
            flush=True,
        )

    resize_shape = (
        settings.teacher_vision_image_max_edge,
        settings.teacher_vision_image_max_edge,
    )
    command = build_lora_command(
        training_python=runtime["training_python"],
        model=args.model,
        dataset_path=dataset_path,
        output_path=adapter_path,
        batch_size=args.batch_size,
        epochs=args.epochs,
        iters=args.iters,
        learning_rate=args.learning_rate,
        lora_rank=args.lora_rank,
        lora_alpha=args.lora_alpha,
        image_resize_shape=resize_shape,
        resume_adapter=resume_bundle,
    )
    plan = {
        "schema_version": "tcos.instacomp-ai.teacher-vision-lora-plan.v1",
        "student_model": args.model,
        "student_is_primary_ai": True,
        "teacher_models": manifest["teacher_models"],
        "teachers_are_training_only": True,
        "teacher_identity_authority": False,
        "teacher_pricing_authority": False,
        "teacher_auto_promotion": False,
        "raw_local_vision_preserved_in_database": True,
        "teacher_prompt_uses_compact_local_vision": True,
        "original_archived_images_mutated": False,
        "ai_learning_image_max_edge": settings.teacher_vision_image_max_edge,
        "teacher_mining": mining,
        "dataset": manifest,
        "runtime": runtime,
        "readiness": readiness,
        "adapter_path": str(adapter_bundle),
        "adapter_weights": str(adapter_path),
        "resume_adapter_input": str(resume_adapter_input) if resume_adapter_input else None,
        "resume_adapter_bundle": str(resume_bundle) if resume_bundle else None,
        "training_schedule": {
            "epochs": None if args.iters is not None else args.epochs,
            "iters": args.iters,
            "steps_per_save": DEFAULT_STEPS_PER_SAVE,
        },
        "validation_policy": (
            "Held-out validation rows receive no teacher lesson and are never oversampled; "
            "post-training Frozen promotion must run with teachers disabled."
        ),
        "command": command,
    }
    print(json.dumps(plan, indent=2), flush=True)
    if args.dry_run:
        return 0

    completed = subprocess.run(command, cwd=SERVICE_ROOT, check=False)
    if completed.returncode != 0:
        return completed.returncode
    config_path = adapter_bundle / "adapter_config.json"
    if not adapter_path.is_file() or not config_path.is_file():
        raise SystemExit(
            "Training command finished without producing a complete adapter bundle "
            "(adapter_config.json + adapters.safetensors)."
        )
    print(
        json.dumps(
            {
                "status": "trained",
                "student_model": args.model,
                "teacher_models": manifest["teacher_models"],
                "adapter_path": str(adapter_bundle),
                "adapter_weights": str(adapter_path),
                "teachers_used_at_runtime": False,
                "raw_local_vision_preserved_in_database": True,
                "teacher_prompt_uses_compact_local_vision": True,
            },
            indent=2,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())