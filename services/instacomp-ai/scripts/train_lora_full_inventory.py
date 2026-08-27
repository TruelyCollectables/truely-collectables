#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
SYNCER = SERVICE_ROOT / "scripts" / "sync_all_inventory_training_truth_guarded.py"
TRAINER = SERVICE_ROOT / "scripts" / "run_lora_training_checkpoint_safe.py"
IMPORT_RECEIPT = SERVICE_ROOT / "data" / "training" / "inventory-training-import-latest.json"
TRAINING_RECEIPT = SERVICE_ROOT / "data" / "training" / "full-inventory-lora-latest.json"
EXPORT_ROOT = SERVICE_ROOT / "data" / "training" / "exports"
ADAPTER_ROOT = SERVICE_ROOT / "data" / "training" / "adapters"
SERVICE_PYTHON = SERVICE_ROOT / ".venv" / "bin" / "python"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _python_executable() -> str:
    """Use the service virtualenv for dependency-heavy child processes when available."""
    if SERVICE_PYTHON.is_file():
        return str(SERVICE_PYTHON)
    return sys.executable


def _latest_manifest(root: Path) -> tuple[Path, dict] | None:
    manifests = sorted(root.glob("*/manifest.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    if not manifests:
        return None
    path = manifests[0]
    payload = json.loads(path.read_text("utf-8"))
    return path, payload


def _dataset_fingerprint(directory: Path) -> str:
    digest = hashlib.sha256()
    for name in ("train.jsonl", "validation.jsonl", "manifest.json"):
        path = directory / name
        if not path.is_file():
            continue
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _run(command: list[str]) -> int:
    print("+ " + " ".join(command), flush=True)
    return subprocess.run(command, cwd=REPO_ROOT, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Import all eligible correct inventory into trusted InstaComp lessons, require 100% "
            "inventory-training coverage, then train a fresh full-corpus LoRA adapter."
        )
    )
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--image-resize-shape", type=int, nargs=2, default=(768, 768))
    parser.add_argument("--skip-import", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.epochs <= 0:
        raise SystemExit("--epochs must be greater than zero")
    if min(args.image_resize_shape) < 224:
        raise SystemExit("--image-resize-shape values must be at least 224")

    python_executable = _python_executable()

    if not args.skip_import:
        import_command = [
            python_executable,
            str(SYNCER),
            "--receipt",
            str(IMPORT_RECEIPT),
        ]
        if args.dry_run:
            import_command.append("--dry-run")
        code = _run(import_command)
        if code != 0:
            raise SystemExit(
                "Inventory truth sync did not reach 100% eligible coverage. "
                "LoRA training is blocked until the receipt has zero eligible outstanding cards."
            )

    if not IMPORT_RECEIPT.is_file():
        raise SystemExit(f"Inventory training receipt missing: {IMPORT_RECEIPT}")
    inventory_receipt = json.loads(IMPORT_RECEIPT.read_text("utf-8"))
    training = inventory_receipt.get("training") or {}
    coverage = float(training.get("inventory_training_coverage_percent") or 0)
    outstanding = int(training.get("inventory_training_outstanding") or 0)
    eligible = int(training.get("inventory_eligible_total") or 0)
    learned = int(training.get("inventory_eligible_learned") or 0)
    if eligible <= 0:
        raise SystemExit("No eligible image-backed inventory cards were found; refusing to claim full-corpus training.")
    if coverage != 100.0 or outstanding != 0 or learned != eligible:
        raise SystemExit(
            f"Inventory learning coverage is {coverage:.2f}% ({learned}/{eligible}); "
            f"{outstanding} eligible cards remain. Refusing to start LoRA."
        )

    if args.dry_run:
        receipt = {
            "schema_version": "tcos.instacomp-ai.full-inventory-lora.v1",
            "created_at": utc_now(),
            "status": "dry_run_ready",
            "inventory_training_coverage_percent": coverage,
            "inventory_eligible_learned": learned,
            "inventory_eligible_total": eligible,
            "planned_epochs": args.epochs,
            "fresh_full_corpus_run": True,
        }
        TRAINING_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
        TRAINING_RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt, indent=2))
        return 0

    manifests_before = {path.resolve() for path in EXPORT_ROOT.glob("*/manifest.json")}
    adapter_dirs_before = {path.resolve() for path in ADAPTER_ROOT.glob("instacomp-*") if path.is_dir()}

    command = [
        python_executable,
        str(TRAINER),
        "--epochs",
        str(args.epochs),
        "--image-resize-shape",
        str(args.image_resize_shape[0]),
        str(args.image_resize_shape[1]),
    ]
    code = _run(command)
    if code != 0:
        failure = {
            "schema_version": "tcos.instacomp-ai.full-inventory-lora.v1",
            "created_at": utc_now(),
            "status": "training_failed",
            "inventory_training_coverage_percent": coverage,
            "inventory_eligible_learned": learned,
            "inventory_eligible_total": eligible,
            "fresh_full_corpus_run": True,
            "trainer_exit_code": code,
        }
        TRAINING_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
        TRAINING_RECEIPT.write_text(json.dumps(failure, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(failure, indent=2))
        return code

    newest = _latest_manifest(EXPORT_ROOT)
    if newest is None:
        raise SystemExit("LoRA finished without a training export manifest")
    manifest_path, manifest = newest
    if manifest_path.resolve() in manifests_before:
        raise SystemExit("LoRA finished without creating a fresh full-corpus dataset export")

    trusted_examples = int(manifest.get("trusted_examples") or 0)
    if trusted_examples < learned:
        raise SystemExit(
            "Fresh LoRA export contains fewer trusted examples than the 100%-covered inventory corpus: "
            f"export={trusted_examples}, inventory={learned}"
        )

    new_adapter_dirs = [
        path for path in ADAPTER_ROOT.glob("instacomp-*")
        if path.is_dir() and path.resolve() not in adapter_dirs_before
    ]
    new_adapter_dirs.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    if not new_adapter_dirs:
        raise SystemExit("LoRA finished without creating a fresh adapter directory")
    adapter_dir = new_adapter_dirs[0]
    weights = adapter_dir / "adapters.safetensors"
    if not weights.is_file() or weights.stat().st_size <= 0:
        raise SystemExit(f"Fresh adapter weights missing: {weights}")

    dataset_dir = manifest_path.parent
    receipt = {
        "schema_version": "tcos.instacomp-ai.full-inventory-lora.v1",
        "created_at": utc_now(),
        "status": "training_schedule_complete",
        "inventory_training_coverage_percent": 100.0,
        "inventory_eligible_learned": learned,
        "inventory_eligible_total": eligible,
        "trusted_examples_consumed": trusted_examples,
        "train_examples": int(manifest.get("train_examples") or 0),
        "held_out_validation_examples": int(manifest.get("validation_examples") or 0),
        "epochs_completed": args.epochs,
        "fresh_full_corpus_run": True,
        "dataset_path": str(dataset_dir),
        "dataset_sha256": _dataset_fingerprint(dataset_dir),
        "adapter_directory": str(adapter_dir),
        "adapter_weights": str(weights),
        "adapter_bytes": weights.stat().st_size,
        "promotion_status": "not_promoted_pending_locked_validation",
        "meaning_of_100_percent": (
            "100% means every eligible image-backed correct inventory card was represented in the trusted "
            "learning corpus and the planned fresh LoRA training schedule completed. It does not claim 100% "
            "recognition accuracy; accuracy is certified separately on locked unseen cards."
        ),
    }
    TRAINING_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    TRAINING_RECEIPT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
