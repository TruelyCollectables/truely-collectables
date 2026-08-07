#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from app.config import settings
from app.storage import MemoryStore
from app.training import export_training_dataset, training_readiness

DEFAULT_MODEL = "mlx-community/Qwen3-VL-2B-Instruct-4bit"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train a private InstaComp vision LoRA adapter on trusted examples."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--allow-small-dataset", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    examples = store.list_training_examples(trusted_only=True, limit=100_000)
    readiness = training_readiness(examples)
    if not readiness["ready_for_trial_lora"] and not args.allow_small_dataset:
        print(json.dumps(readiness, indent=2))
        raise SystemExit(
            "Training blocked: collect at least 50 trusted examples with OCR evidence. "
            "Use --allow-small-dataset only for a disposable engineering smoke test."
        )

    manifest = export_training_dataset(
        examples,
        image_store_path=settings.resolve_local_path(settings.image_store_path),
        destination_root=settings.resolve_local_path(settings.training_export_path),
        validation_percent=15,
    )
    dataset_path = Path(manifest["destination"])
    adapter_root = settings.resolve_local_path("./data/training/adapters")
    adapter_root.mkdir(parents=True, exist_ok=True)
    adapter_path = adapter_root / f"instacomp-{dataset_path.name}.safetensors"

    command = [
        sys.executable,
        "-m",
        "mlx_vlm.lora",
        "--model-path",
        args.model,
        "--dataset",
        str(dataset_path),
        "--split",
        "train",
        "--batch-size",
        str(args.batch_size),
        "--epochs",
        str(args.epochs),
        "--learning-rate",
        str(args.learning_rate),
        "--lora-rank",
        str(args.lora_rank),
        "--lora-alpha",
        str(args.lora_alpha),
        "--lora-dropout",
        "0.05",
        "--gradient-accumulation-steps",
        "4",
        "--grad-checkpoint",
        "--train-on-completions",
        "--steps-per-report",
        "5",
        "--steps-per-eval",
        "25",
        "--steps-per-save",
        "50",
        "--output-path",
        str(adapter_path),
    ]
    plan = {
        "schema_version": "tcos.instacomp-ai.lora-plan.v1",
        "readiness": readiness,
        "dataset": manifest,
        "model": args.model,
        "adapter_path": str(adapter_path),
        "command": command,
        "promotion_rule": "Do not deploy unless the locked five-card and held-out validation suites improve with zero critical regressions.",
    }
    print(json.dumps(plan, indent=2))
    if args.dry_run:
        return 0

    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        return completed.returncode
    if not adapter_path.is_file():
        raise SystemExit("Training command finished without producing the expected adapter.")
    print(json.dumps({"status": "trained", "adapter_path": str(adapter_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
