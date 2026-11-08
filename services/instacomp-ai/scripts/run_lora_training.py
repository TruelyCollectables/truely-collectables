#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
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
DEFAULT_IMAGE_RESIZE_SHAPE = (768, 768)
DEFAULT_STEPS_PER_SAVE = 25


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
        "--iters",
        "--batch-size",
        "--learning-rate",
        "--lora-rank",
        "--lora-alpha",
        "--output-path",
        "--adapter-path",
        "--image-resize-shape",
    ]
    missing = [flag for flag in required if flag not in output]
    if missing:
        raise SystemExit(
            "Installed MLX-VLM LoRA CLI is incompatible; missing flags: "
            + ", ".join(missing)
        )
    return {
        "schema_version": "tcos.instacomp-ai.lora-runtime-preflight.v5",
        "status": "ready",
        "mlx_vlm_version": str(version),
        "certified_mlx_vlm_version": str(PINNED_MLX_VLM_VERSION),
        "multi_image_front_back_training": "supported",
        "checkpoint_resume": "supported_as_adapter_bundle_directory",
        "memory_bounded_image_resize": "supported",
        "runtime_isolated_from_service": True,
        "service_python": sys.executable,
        "training_python": str(training_python),
        "service_root": str(SERVICE_ROOT),
    }


def _validate_adapter_bundle(bundle: Path) -> Path:
    bundle = bundle.expanduser().resolve()
    if not bundle.is_dir():
        raise SystemExit(f"Resume adapter bundle is not a directory: {bundle}")
    config_path = bundle / "adapter_config.json"
    weights_path = bundle / "adapters.safetensors"
    if not config_path.is_file():
        raise SystemExit(f"Resume adapter bundle is missing adapter_config.json: {bundle}")
    if not weights_path.is_file() or weights_path.stat().st_size <= 0:
        raise SystemExit(f"Resume adapter bundle is missing adapters.safetensors: {bundle}")
    try:
        config = json.loads(config_path.read_text("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Resume adapter config is not valid JSON: {config_path}") from exc
    if not isinstance(config, dict) or not (
        isinstance(config.get("lora_parameters"), dict) or config.get("rank") is not None
    ):
        raise SystemExit(
            "Resume adapter config does not contain MLX-VLM LoRA parameters: "
            f"{config_path}"
        )
    return bundle


def prepare_resume_adapter_bundle(
    resume_adapter: Path | None,
    *,
    adapter_root: Path,
) -> Path | None:
    if resume_adapter is None:
        return None
    source = resume_adapter.expanduser().resolve()
    if source.is_dir():
        return _validate_adapter_bundle(source)
    if not source.is_file():
        raise SystemExit(f"Resume adapter does not exist: {source}")
    if source.suffix.lower() != ".safetensors":
        raise SystemExit(
            "Resume adapter must be an MLX-VLM adapter bundle directory or a .safetensors checkpoint."
        )

    sibling_config = source.parent / "adapter_config.json"
    if not sibling_config.is_file():
        raise SystemExit(
            "Cannot recover this legacy checkpoint because adapter_config.json is missing beside it: "
            f"{sibling_config}"
        )

    bundle = adapter_root / "resume-bundles" / source.stem
    bundle.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, bundle / "adapters.safetensors")
    shutil.copy2(sibling_config, bundle / "adapter_config.json")
    return _validate_adapter_bundle(bundle)


def build_lora_command(
    *,
    training_python: str,
    model: str,
    dataset_path: Path,
    output_path: Path,
    batch_size: int,
    epochs: int,
    iters: int | None,
    learning_rate: float,
    lora_rank: int,
    lora_alpha: int,
    image_resize_shape: tuple[int, int],
    resume_adapter: Path | None,
) -> list[str]:
    height, width = image_resize_shape
    if height < 224 or width < 224:
        raise SystemExit("Training image resize shape must be at least 224x224.")
    if iters is not None and iters <= 0:
        raise SystemExit("--iters must be greater than zero.")
    if epochs <= 0:
        raise SystemExit("--epochs must be greater than zero.")
    if resume_adapter is not None:
        _validate_adapter_bundle(resume_adapter)

    command = [
        training_python,
        "-m",
        "mlx_vlm.lora",
        "--model-path",
        model,
        "--dataset",
        str(dataset_path),
        "--split",
        "train",
        "--batch-size",
        str(batch_size),
    ]
    if iters is not None:
        command.extend(["--iters", str(iters)])
    else:
        command.extend(["--epochs", str(epochs)])
    command.extend([
        "--learning-rate",
        str(learning_rate),
        "--lora-rank",
        str(lora_rank),
        "--lora-alpha",
        str(lora_alpha),
        "--lora-dropout",
        "0.05",
        "--gradient-accumulation-steps",
        "4",
        "--grad-checkpoint",
        "--train-on-completions",
        "--image-resize-shape",
        str(height),
        str(width),
        "--steps-per-report",
        "5",
        "--steps-per-eval",
        "25",
        "--steps-per-save",
        str(DEFAULT_STEPS_PER_SAVE),
        "--output-path",
        str(output_path),
    ])
    if resume_adapter is not None:
        command.extend(["--adapter-path", str(resume_adapter)])
    return command


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Train a private InstaComp vision LoRA adapter on trusted examples."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument(
        "--iters",
        type=int,
        default=None,
        help="Run an exact number of additional training iterations instead of epochs.",
    )
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--lora-rank", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument(
        "--image-resize-shape",
        type=int,
        nargs=2,
        metavar=("HEIGHT", "WIDTH"),
        default=DEFAULT_IMAGE_RESIZE_SHAPE,
        help="Memory-bound every training image before VLM encoding (default: 768 768).",
    )
    parser.add_argument(
        "--resume-adapter",
        type=Path,
        default=None,
        help=(
            "Warm-start from an MLX-VLM adapter bundle directory or a legacy .safetensors "
            "checkpoint that still has adapter_config.json beside it."
        ),
    )
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

    adapter_root = settings.resolve_local_path("./data/training/adapters")
    adapter_root.mkdir(parents=True, exist_ok=True)
    resume_adapter_input = args.resume_adapter.expanduser().resolve() if args.resume_adapter else None
    resume_bundle = prepare_resume_adapter_bundle(
        resume_adapter_input,
        adapter_root=adapter_root,
    )

    manifest = export_training_dataset(
        examples,
        image_store_path=settings.resolve_local_path(settings.image_store_path),
        destination_root=settings.resolve_local_path(settings.training_export_path),
        validation_percent=15,
    )
    dataset_path = Path(manifest["destination"])
    adapter_bundle = adapter_root / f"instacomp-{dataset_path.name}"
    adapter_path = adapter_bundle / "adapters.safetensors"
    training_python = runtime["training_python"]
    resize_shape = (int(args.image_resize_shape[0]), int(args.image_resize_shape[1]))

    command = build_lora_command(
        training_python=training_python,
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
        "schema_version": "tcos.instacomp-ai.lora-plan.v4",
        "runtime": runtime,
        "readiness": readiness,
        "dataset": manifest,
        "model": args.model,
        "adapter_path": str(adapter_bundle),
        "adapter_weights": str(adapter_path),
        "resume_adapter_input": str(resume_adapter_input) if resume_adapter_input else None,
        "resume_adapter_bundle": str(resume_bundle) if resume_bundle else None,
        "resume_semantics": (
            "warm_start_weights_only_optimizer_and_data_cursor_restart"
            if resume_bundle
            else None
        ),
        "training_schedule": {
            "epochs": None if args.iters is not None else args.epochs,
            "iters": args.iters,
            "steps_per_save": DEFAULT_STEPS_PER_SAVE,
        },
        "memory_profile": {
            "image_resize_shape": list(resize_shape),
            "original_archived_images_untouched": True,
            "reason": "Bound VLM image-token memory on the Mac while preserving the trusted image archive.",
        },
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
    config_path = adapter_bundle / "adapter_config.json"
    if not adapter_path.is_file() or not config_path.is_file():
        raise SystemExit(
            "Training command finished without producing a complete adapter bundle "
            "(adapter_config.json + adapters.safetensors)."
        )
    print(json.dumps({
        "status": "trained",
        "adapter_path": str(adapter_bundle),
        "adapter_weights": str(adapter_path),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
