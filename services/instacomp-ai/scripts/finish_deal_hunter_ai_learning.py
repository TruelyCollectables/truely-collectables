#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
TRAIN_FULL = SERVICE_ROOT / "scripts" / "train_lora_full_inventory.py"
VALIDATE = SERVICE_ROOT / "scripts" / "validate_lora_candidate.py"
TRAINING_RECEIPT = SERVICE_ROOT / "data" / "training" / "full-inventory-lora-latest.json"
COMPLETION_RECEIPT = SERVICE_ROOT / "data" / "training" / "deal-hunter-ai-learning-latest.json"
LORA_VENV = SERVICE_ROOT / ".venv-lora"
SERVICE_PYTHON = SERVICE_ROOT / ".venv" / "bin" / "python"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _service_python() -> Path:
    return SERVICE_PYTHON if SERVICE_PYTHON.is_file() else Path(sys.executable)


def _lora_python() -> Path:
    if sys.platform != "darwin":
        raise SystemExit("Deal Hunter locked LoRA validation requires the Apple Silicon Mac runtime.")
    path = LORA_VENV / "bin" / "python"
    if not path.is_file():
        raise SystemExit(
            f"Isolated LoRA runtime is missing: {path}. "
            "Run the full trainer first so the certified MLX-VLM runtime is created."
        )
    return path


def _run(command: list[str]) -> int:
    print("+ " + " ".join(command), flush=True)
    return subprocess.run(command, cwd=REPO_ROOT, check=False).returncode


def _read_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SystemExit(f"Required receipt is missing: {path}")
    try:
        payload = json.loads(path.read_text("utf-8"))
    except Exception as exc:
        raise SystemExit(f"Required receipt is not valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise SystemExit(f"Required receipt is not a JSON object: {path}")
    return payload


def _write_completion(payload: dict[str, Any]) -> None:
    COMPLETION_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    temp = COMPLETION_RECEIPT.with_suffix(COMPLETION_RECEIPT.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp.replace(COMPLETION_RECEIPT)


def _validation_receipt(adapter: Path, dataset: Path) -> Path:
    return adapter / f"validation-{dataset.name}.json"


def _training_gate(receipt: dict[str, Any], required_examples: int) -> tuple[Path, Path]:
    status = str(receipt.get("status") or "")
    coverage = float(receipt.get("inventory_training_coverage_percent") or 0.0)
    learned = int(receipt.get("inventory_eligible_learned") or 0)
    eligible = int(receipt.get("inventory_eligible_total") or 0)
    held_out = int(receipt.get("held_out_validation_examples") or 0)
    if status != "training_schedule_complete":
        raise SystemExit(f"Full inventory LoRA training did not complete: status={status!r}")
    if coverage != 100.0 or learned <= 0 or learned != eligible:
        raise SystemExit(
            f"Full inventory LoRA receipt failed coverage gate: {coverage:.2f}% ({learned}/{eligible})"
        )
    if held_out != required_examples:
        raise SystemExit(
            f"Locked validation split mismatch: expected {required_examples}, training receipt has {held_out}."
        )

    adapter = Path(str(receipt.get("adapter_directory") or "")).expanduser().resolve()
    dataset = Path(str(receipt.get("dataset_path") or "")).expanduser().resolve()
    weights = adapter / "adapters.safetensors"
    config = adapter / "adapter_config.json"
    manifest = dataset / "manifest.json"
    validation = dataset / "validation.jsonl"
    missing = [
        str(path)
        for path in (weights, config, manifest, validation)
        if not path.is_file() or (path in (weights, config) and path.stat().st_size <= 0)
    ]
    if missing:
        raise SystemExit("Fresh training artifacts are incomplete: " + ", ".join(missing))
    return adapter, dataset


def _final_gate(
    *,
    training_receipt: dict[str, Any],
    validation_receipt: dict[str, Any],
    adapter: Path,
    dataset: Path,
    required_examples: int,
) -> dict[str, Any]:
    held_out = int(validation_receipt.get("held_out_examples") or 0)
    score = validation_receipt.get("score") or {}
    gates = score.get("gates") or {}
    promotion = validation_receipt.get("promotion") or {}
    regressions = score.get("critical_regressions") or []

    checks = {
        "training_schedule_complete": training_receipt.get("status") == "training_schedule_complete",
        "inventory_training_coverage_100": float(training_receipt.get("inventory_training_coverage_percent") or 0.0) == 100.0,
        "eligible_inventory_fully_learned": int(training_receipt.get("inventory_eligible_learned") or 0) > 0
        and int(training_receipt.get("inventory_eligible_learned") or 0)
        == int(training_receipt.get("inventory_eligible_total") or 0),
        "held_out_examples_exact": held_out == required_examples,
        "strict_improvement": bool(gates.get("strict_improvement")),
        "no_critical_regressions": bool(gates.get("no_critical_regressions")) and len(regressions) == 0,
        "parse_not_worse": bool(gates.get("parse_not_worse")),
        "candidate_not_worse_exact": bool(gates.get("candidate_not_worse_exact")),
        "promotion_candidate": bool(gates.get("promotion_candidate")),
        "runtime_candidate_eligible": bool(promotion.get("eligible_for_runtime_candidate")),
        "automatic_deployment_disabled": promotion.get("automatic_deployment") is False,
    }
    complete = all(checks.values())
    return {
        "schema_version": "tcos.instacomp-ai.deal-hunter-learning-completion.v1",
        "created_at": utc_now(),
        "status": "complete_and_validated" if complete else "validation_gate_failed",
        "complete": complete,
        "checks": checks,
        "inventory_eligible_learned": int(training_receipt.get("inventory_eligible_learned") or 0),
        "inventory_eligible_total": int(training_receipt.get("inventory_eligible_total") or 0),
        "held_out_validation_examples": held_out,
        "adapter_directory": str(adapter),
        "dataset_path": str(dataset),
        "validation_receipt": str(_validation_receipt(adapter, dataset)),
        "critical_regressions": len(regressions),
        "automatic_deployment": False,
        "meaning": (
            "Learning is complete only when the full eligible inventory corpus trained successfully and the "
            "fresh adapter strictly beat the untouched base model on exactly the locked held-out examples with "
            "zero critical regressions. This receipt does not automatically deploy the candidate."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Finish Deal Hunter/InstaComp AI learning in one guarded path: authoritative inventory sync, "
            "full-corpus LoRA training, then locked held-out validation using the isolated MLX-VLM runtime."
        )
    )
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--image-resize-shape", type=int, nargs=2, default=(768, 768))
    parser.add_argument("--required-examples", type=int, default=30)
    parser.add_argument("--max-tokens", type=int, default=768)
    parser.add_argument("--allow-vercel-env-pull", action="store_true")
    args = parser.parse_args()

    if args.epochs <= 0:
        raise SystemExit("--epochs must be greater than zero")
    if min(args.image_resize_shape) < 224:
        raise SystemExit("--image-resize-shape values must be at least 224")
    if args.required_examples <= 0:
        raise SystemExit("--required-examples must be greater than zero")
    if args.max_tokens <= 0:
        raise SystemExit("--max-tokens must be greater than zero")

    train_command = [
        str(_service_python()),
        str(TRAIN_FULL),
        "--epochs",
        str(args.epochs),
        "--image-resize-shape",
        str(args.image_resize_shape[0]),
        str(args.image_resize_shape[1]),
    ]
    if args.allow_vercel_env_pull:
        train_command.append("--allow-vercel-env-pull")

    train_code = _run(train_command)
    if train_code != 0:
        failure = {
            "schema_version": "tcos.instacomp-ai.deal-hunter-learning-completion.v1",
            "created_at": utc_now(),
            "status": "training_or_inventory_sync_failed",
            "complete": False,
            "train_exit_code": train_code,
            "automatic_deployment": False,
        }
        _write_completion(failure)
        return train_code

    training_receipt = _read_json(TRAINING_RECEIPT)
    adapter, dataset = _training_gate(training_receipt, args.required_examples)
    validation_receipt_path = _validation_receipt(adapter, dataset)
    if validation_receipt_path.exists():
        validation_receipt_path.unlink()

    lora_python = _lora_python()
    base_validation_command = [
        str(lora_python),
        str(VALIDATE),
        "--adapter",
        str(adapter),
        "--dataset-export",
        str(dataset),
        "--required-examples",
        str(args.required_examples),
        "--max-tokens",
        str(args.max_tokens),
    ]

    preflight_code = _run(base_validation_command + ["--preflight-only"])
    if preflight_code != 0:
        failure = {
            "schema_version": "tcos.instacomp-ai.deal-hunter-learning-completion.v1",
            "created_at": utc_now(),
            "status": "locked_validation_preflight_failed",
            "complete": False,
            "validation_preflight_exit_code": preflight_code,
            "adapter_directory": str(adapter),
            "dataset_path": str(dataset),
            "automatic_deployment": False,
        }
        _write_completion(failure)
        return preflight_code

    validation_code = _run(base_validation_command)
    if not validation_receipt_path.is_file():
        failure = {
            "schema_version": "tcos.instacomp-ai.deal-hunter-learning-completion.v1",
            "created_at": utc_now(),
            "status": "locked_validation_missing_receipt",
            "complete": False,
            "validation_exit_code": validation_code,
            "adapter_directory": str(adapter),
            "dataset_path": str(dataset),
            "automatic_deployment": False,
        }
        _write_completion(failure)
        return validation_code if validation_code != 0 else 96

    validation_receipt = _read_json(validation_receipt_path)
    final = _final_gate(
        training_receipt=training_receipt,
        validation_receipt=validation_receipt,
        adapter=adapter,
        dataset=dataset,
        required_examples=args.required_examples,
    )
    final["validation_exit_code"] = validation_code
    _write_completion(final)
    print(json.dumps(final, indent=2), flush=True)

    if validation_code != 0:
        return validation_code
    return 0 if final["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
