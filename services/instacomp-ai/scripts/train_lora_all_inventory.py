#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
SYNC = SERVICE_ROOT / "scripts" / "sync_all_inventory_training_truth_v2.py"
TRAIN = SERVICE_ROOT / "scripts" / "train_lora_full_inventory.py"


def _run(command: list[str]) -> int:
    print("+ " + " ".join(command), flush=True)
    return subprocess.run(command, cwd=REPO_ROOT, check=False).returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "One command: reconcile every detected correct inventory card into trusted InstaComp learning, "
            "certify 100% row coverage, then run a fresh full-corpus LoRA schedule. Missing legacy card_uuid "
            "values are resolved from the stable inventory row ID without mutating Production."
        )
    )
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--image-resize-shape", type=int, nargs=2, default=(768, 768))
    parser.add_argument("--allow-vercel-env-pull", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sync_command = [sys.executable, str(SYNC)]
    if args.allow_vercel_env_pull:
        sync_command.append("--allow-vercel-env-pull")
    if args.dry_run:
        sync_command.append("--dry-run")
    sync_code = _run(sync_command)
    if sync_code != 0:
        return sync_code

    train_command = [
        sys.executable,
        str(TRAIN),
        "--skip-import",
        "--epochs",
        str(args.epochs),
        "--image-resize-shape",
        str(args.image_resize_shape[0]),
        str(args.image_resize_shape[1]),
    ]
    if args.dry_run:
        train_command.append("--dry-run")
    return _run(train_command)


if __name__ == "__main__":
    raise SystemExit(main())
