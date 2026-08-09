#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from packaging.version import InvalidVersion, Version

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.storage import MemoryStore
from app.training import export_training_dataset, training_readiness

DEFAULT_MODEL = "mlx-community/Qwen3-VL-2B-Instruct-4bit"
PINNED_MLX_VLM_VERSION = Version("0.6.8")
LORA_VENV = SERVICE_ROOT / ".venv-lora"
LORA_REQUIREMENTS = SERVICE_ROOT / "requirements-lora-runtime.txt"


def _validated_mlx_vlm_version(raw_version: str) -> Version:
    try:
        parsed = Version(raw_version)
    except InvalidVersion as exc:
        raise SystemExit(
            f"Installed mlx-vlm version is invalid: {raw_version!r}. "
            "Rebuild the isolated LoRA runtime."
        ) from exc
    if parsed < PINNED_MLX_VLM_VERSION:
        raise SystemExit(
            "Installed mlx-vlm is too old for InstaComp front+back training. "
            f"Found {parsed}; require >= {PINNED_MLX_VLM_VERSION}. "
            "Older releases contain the confirmed Qwen3-VL multi-image SFT "
            "image_grid_thw collation bug that crashes at the first training step."
        )
    return parsed


def _lora_python() -> Path:
    if sys.platform == "win32":
        return LORA_VENV / "Scripts" / "python.exe"
    return LORA_VENV / "bin" / "python"


def _probe_mlx_vlm_version(python_bin: Path) -> str | None:
    if not python_bin.is_file():
        return None
    probe = subprocess.run(
        [
            str(python_bin),
            "-c",
            "from importlib.metadata import version; print(version('mlx-vlm'))",
        ],
        cwd=SERVICE_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if probe.returncode != 0:
        return None
    value = probe.stdout.strip()
    return value or None


def ensure_training_runtime() -> tuple[Path, Version]:
    if sys.platform != "darwin":
        raise SystemExit("InstaComp MLX LoRA training requires the Apple Silicon Mac runtime.")
    if not LORA_REQUIREMENTS.is_file():
        raise SystemExit(f"LoRA runtime requirements missing: {LORA_REQUIREMENTS}")

    python_bin = _lora_python()
    if not python_bin.is_file():
        print(f"Creating isolated LoRA runtime: {LORA_VENV}", flush=True)
        subprocess.run(
            [sys.executable, "-m", "venv", str(LORA_VENV)],
            cwd=SERVICE_ROOT,
            check=True,
        )

    raw_version = _probe_mlx_vlm_version(python_bin)
    parsed = None
    if raw_version is not None:
        try:
            parsed = Version(raw_version)
        except InvalidVersion:
            parsed = None

    if parsed != PINNED_MLX_VLM_VERSION:
        print(
            f"Installing isolated MLX-VLM {PINNED_MLX_VLM_VERSION} training runtime...",
            flush=True,
        )
        subprocess.run(
            [
                str(python_bin),
                "-m",
                "pip",
                "install",
                "--upgrade",
                "-r",
                str(LORA_REQUIREMENTS),
            ],
            cwd=SERVICE_ROOT,
            check=True,
        )
        raw_version = _probe_mlx_vlm_version(python_bin)

    if raw_version is None:
        raise SystemExit("Isolated LoRA runtime did not install mlx-vlm successfully.")
    version = _validated_mlx_vlm_version(raw_version)
    if version != PINNED_MLX_VLM_VERSION:
        raise SystemExit(
            "Isolated LoRA runtime is not on the certified version. "
            f"Found {version}; expected {PINNED_MLX_VLM_VERSION}."
        )
    return python_bin, version


def preflight_training_runtime() -> dict:
    training_python, version = ensure_training_runtime()
    probe = subprocess.run(
        [str(training_python), "-m", "mlx_vlm.lora", "--help"],
        cwd=SERVICE_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    output = "\n".join(filter(None, [probe.stdout, probe.stderr]))
    if probe.returncode != 0:
        raise SystemExit(
            "MLX-VLM LoRA preflight failed before dataset export.\n" + output[-2000:]
        )
    required = [
        "--model-path",
        "--dataset",
        "--epochs",
        "--batch-size",
        "--learning-rate",
        "--lora-rank",
        "--lora-alpha",
        "--output-path",
    ]
    missing = [flag for flag in required if flag not in output]
    if missing:
        raise SystemExit(
            "Installed MLX-VLM LoRA CLI is incompatible; missing flags: "
            + ", ".join(missing)
        )
    return {
        "schema_version": "tcos.instacomp-ai.lora-runtime-preflight.v3",
        "status": "ready",
        "mlx_vlm_version": str(version),
        "certified_mlx_vlm_version": str(PINNED_MLX_VLM_VERSION),
        "multi_image_front_back_training": "supported",
        "runtime_isolated_from_service": True,
        "service_python": sys.executable,
        "training_python": str(training_python),
        "service_root": str(SERVICE_ROOT),
    }


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
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()

    runtime = preflight_training_runtime()
    print(json.dumps(runtime, indent=2))
    if args.preflight_only:
        return 0

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
    training_python = runtime["training_python"]

    command = [
        training_python,
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
        "schema_version": "tcos.instacomp-ai.lora-plan.v2",
        "runtime": runtime,
        "readiness": readiness,
        "dataset": manifest,
        "model": args.model,
        "adapter_path": str(adapter_path),
        "command": command,
        "held_out_validation": {
            "examples": manifest.get("validation_examples", 0),
            "policy": "reserved for locked post-training validation; not fed to the trainer",
        },
        "promotion_rule": "Do not deploy unless the locked five-card and held-out validation suites improve with zero critical regressions.",
    }
    print(json.dumps(plan, indent=2))
    if args.dry_run:
        return 0

    completed = subprocess.run(command, cwd=SERVICE_ROOT, check=False)
    if completed.returncode != 0:
        return completed.returncode
    if not adapter_path.is_file():
        raise SystemExit("Training command finished without producing the expected adapter.")
    print(json.dumps({"status": "trained", "adapter_path": str(adapter_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
