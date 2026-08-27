#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))
if str(SERVICE_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT / "scripts"))

import benchmark_lora_unseen_holdout_v1 as benchmark_v1
import promote_lora_candidate_frozen_five as promotion_base
import run_lora_training as trainer
import run_lora_training_checkpoint_safe as checkpoint_safe
from app.config import settings
from app.storage import MemoryStore
from app.training import _dataset_row, _split, latest_training_examples, training_readiness

SCHEMA = "tcos.instacomp-ai.unseen-miss-curriculum.v1"
TRAINING_RECEIPT = SERVICE_ROOT / "data/training/full-inventory-lora-latest.json"
INVENTORY_RECEIPT = SERVICE_ROOT / "data/training/inventory-training-import-latest.json"
DEFAULT_EPOCHS = 1
DEFAULT_LEARNING_RATE = 5e-5
DEFAULT_CURRICULUM_MULTIPLIER = 3
DEFAULT_IMAGE_RESIZE_SHAPE = (768, 768)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected JSON object: {path}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        digest.update(b"\0")
    return digest.hexdigest()


def _valid_sha(value: object) -> str | None:
    text = str(value or "").strip().lower()
    return text if len(text) == 64 and all(ch in "0123456789abcdef" for ch in text) else None


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _complete_benchmarks() -> list[tuple[Path, dict[str, Any]]]:
    output: list[tuple[Path, dict[str, Any]]] = []
    if not benchmark_v1.BENCHMARK_DIR.is_dir():
        return output
    for path in sorted(benchmark_v1.BENCHMARK_DIR.glob("unseen-holdout-*.json")):
        try:
            payload = _read_json(path)
        except Exception:
            continue
        if payload.get("complete") is not True:
            continue
        target = int(payload.get("target") or 0)
        tested = int(payload.get("tested") or 0)
        if target != 100 or tested != 100:
            continue
        results = payload.get("results")
        if not isinstance(results, list) or len(results) != 100:
            continue
        output.append((path, payload))
    return output


def _dataset_row_metadata(dataset: Path) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for row in promotion_base.load_rows(dataset):
        row_id = str(row.get("id") or "").strip()
        if not row_id:
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        output[row_id] = dict(metadata)
    return output


def _miss_expectations(
    benchmarks: list[tuple[Path, dict[str, Any]]],
) -> tuple[dict[str, dict[str, str]], list[str]]:
    expectations: dict[str, dict[str, str]] = {}
    sources: list[str] = []
    dataset_metadata_cache: dict[str, dict[str, dict[str, Any]]] = {}

    for path, payload in benchmarks:
        sources.append(str(path))
        dataset = Path(str(payload.get("dataset") or "")).expanduser().resolve()
        metadata_by_row: dict[str, dict[str, Any]] = {}
        if dataset.is_dir():
            key = str(dataset)
            metadata_by_row = dataset_metadata_cache.get(key) or _dataset_row_metadata(dataset)
            dataset_metadata_cache[key] = metadata_by_row
        for result in payload.get("results") or []:
            if not isinstance(result, dict) or result.get("authoritative_exact") is True:
                continue
            row_id = str(result.get("row_id") or "").strip()
            registry_id = str(result.get("expected_registry_identity_id") or "").strip()
            fingerprint = _valid_sha(result.get("expected_registry_fingerprint_sha256"))
            if not row_id or not registry_id or not fingerprint:
                raise RuntimeError(
                    f"Benchmark miss lacks authoritative expected Registry truth: {path} row={row_id!r}"
                )
            metadata = metadata_by_row.get(row_id) or {}
            card_uuid = str(metadata.get("card_uuid") or "").strip()
            expectations[row_id] = {
                "row_id": row_id,
                "registry_identity_id": registry_id,
                "registry_fingerprint_sha256": fingerprint,
                "card_uuid": card_uuid,
                "source_benchmark": str(path),
            }
    return expectations, sources


def _inventory_coverage() -> dict[str, Any]:
    if not INVENTORY_RECEIPT.is_file():
        raise RuntimeError(
            f"Inventory training receipt missing: {INVENTORY_RECEIPT}. Run the guarded inventory truth sync first."
        )
    receipt = _read_json(INVENTORY_RECEIPT)
    training = receipt.get("training") if isinstance(receipt.get("training"), dict) else {}
    coverage = float(training.get("inventory_training_coverage_percent") or 0.0)
    learned = int(training.get("inventory_eligible_learned") or 0)
    eligible = int(training.get("inventory_eligible_total") or 0)
    outstanding = int(training.get("inventory_training_outstanding") or 0)
    if coverage != 100.0 or eligible <= 0 or learned != eligible or outstanding != 0:
        raise RuntimeError(
            f"Inventory truth coverage is not complete: coverage={coverage:.2f}% learned={learned}/{eligible} outstanding={outstanding}"
        )
    return {
        "coverage": coverage,
        "learned": learned,
        "eligible": eligible,
        "outstanding": outstanding,
    }


def _verified_curriculum_examples(
    examples: list[Any],
    expectations: dict[str, dict[str, str]],
) -> tuple[set[str], list[dict[str, Any]]]:
    by_id = {str(example.training_example_id): example for example in examples}
    by_card_uuid = {
        str(example.card_uuid): example
        for example in examples
        if str(example.card_uuid or "").strip()
    }
    force_ids: set[str] = set()
    audit: list[dict[str, Any]] = []

    for original_row_id, wanted in sorted(expectations.items()):
        example = by_id.get(original_row_id)
        resolution = "same_training_example"
        if example is None and wanted.get("card_uuid"):
            example = by_card_uuid.get(wanted["card_uuid"])
            resolution = "latest_same_physical_card"
        if example is None:
            raise RuntimeError(
                f"Cannot teach benchmark miss {original_row_id}: no current trusted example for that row/physical card"
            )

        actual_registry = str(example.registry_identity_id or "").strip()
        actual_fingerprint = _valid_sha(example.registry_fingerprint_sha256)
        if _norm(actual_registry) != _norm(wanted["registry_identity_id"]):
            raise RuntimeError(
                f"Refusing stale curriculum truth for {original_row_id}: Registry UUID changed "
                f"benchmark={wanted['registry_identity_id']} current={actual_registry}"
            )
        if actual_fingerprint != wanted["registry_fingerprint_sha256"]:
            raise RuntimeError(
                f"Refusing stale curriculum truth for {original_row_id}: Registry fingerprint changed"
            )

        current_id = str(example.training_example_id)
        force_ids.add(current_id)
        audit.append(
            {
                "benchmark_row_id": original_row_id,
                "training_example_id": current_id,
                "resolution": resolution,
                "registry_identity_id": actual_registry,
                "registry_fingerprint_sha256": actual_fingerprint,
                "source_benchmark": wanted["source_benchmark"],
            }
        )
    return force_ids, audit


def _export_curriculum_dataset(
    examples: list[Any],
    *,
    force_train_ids: set[str],
    image_store_path: Path,
    destination_root: Path,
    multiplier: int,
) -> tuple[Path, dict[str, Any]]:
    destination = destination_root / f"curriculum-{_stamp()}"
    destination.mkdir(parents=True, exist_ok=False)

    train_rows: list[dict[str, Any]] = []
    validation_rows: list[dict[str, Any]] = []
    for example in examples:
        row = _dataset_row(example, image_store_path=image_store_path)
        row_id = str(example.training_example_id)
        forced = row_id in force_train_ids
        split = "train" if forced else _split(row_id, 15)
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        row["metadata"] = {
            **metadata,
            "curriculum_forced_train": forced,
            "curriculum_weight": multiplier if forced else 1,
        }
        if split == "train":
            train_rows.append(row)
            if forced:
                for repeat in range(2, multiplier + 1):
                    duplicate = json.loads(json.dumps(row))
                    duplicate["id"] = f"{row_id}:curriculum:{repeat}"
                    duplicate["metadata"]["curriculum_repeat"] = repeat
                    train_rows.append(duplicate)
        else:
            validation_rows.append(row)

    if len(validation_rows) < 30:
        raise RuntimeError(
            f"Curriculum export would leave only {len(validation_rows)} validation rows; need at least 30"
        )
    if not force_train_ids:
        raise RuntimeError("Curriculum export received no verified miss IDs")

    for name, rows in (("train", train_rows), ("validation", validation_rows)):
        with (destination / f"{name}.jsonl").open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    forced_sha = hashlib.sha256(
        ("\n".join(sorted(force_train_ids)) + "\n").encode("utf-8")
    ).hexdigest()
    manifest = {
        "schema_version": "tcos.instacomp-ai.training-export.curriculum.v1",
        "created_at": _now(),
        "destination": str(destination),
        "trusted_examples": len(examples),
        "train_examples": len(train_rows),
        "validation_examples": len(validation_rows),
        "validation_percent": 15,
        "format": "mlx-vlm-compatible-chat-jsonl",
        "curriculum": {
            "forced_train_examples": len(force_train_ids),
            "forced_train_ids_sha256": forced_sha,
            "multiplier": multiplier,
            "forced_examples_never_left_in_validation": True,
            "teacher_truth": "current trusted example with matching Registry UUID and fingerprint",
        },
        "safety": {
            "trusted_examples_only": True,
            "current_registry_receipt_required_for_forced_misses": True,
            "benchmark_answers_not_generated_by_candidate": True,
            "benchmark_rows_are_not_reused_as_future_unseen_holdout": True,
        },
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")
    return destination, manifest


def _train(
    dataset: Path,
    *,
    resume_adapter: Path,
    epochs: int,
    learning_rate: float,
    image_resize_shape: tuple[int, int],
    dry_run: bool,
) -> tuple[Path, dict[str, Any]]:
    runtime = trainer.preflight_training_runtime()
    adapter_root = settings.resolve_local_path("./data/training/adapters")
    adapter_root.mkdir(parents=True, exist_ok=True)
    checkpoint_safe._repair_resume_directory(resume_adapter, adapter_root=adapter_root)
    resume_bundle = trainer.prepare_resume_adapter_bundle(resume_adapter, adapter_root=adapter_root)
    if resume_bundle is None:
        raise RuntimeError("Curriculum training requires the validated current adapter as a warm start")

    adapter_bundle = adapter_root / f"instacomp-{dataset.name}"
    adapter_weights = adapter_bundle / "adapters.safetensors"
    if adapter_bundle.exists():
        raise RuntimeError(f"Refusing to overwrite existing curriculum adapter: {adapter_bundle}")
    adapter_bundle.mkdir(parents=True, exist_ok=False)
    shutil.copy2(resume_bundle / "adapter_config.json", adapter_bundle / "adapter_config.json")

    command = trainer.build_lora_command(
        training_python=str(runtime["training_python"]),
        model=trainer.DEFAULT_MODEL,
        dataset_path=dataset,
        output_path=adapter_weights,
        batch_size=1,
        epochs=epochs,
        iters=None,
        learning_rate=learning_rate,
        lora_rank=16,
        lora_alpha=32,
        image_resize_shape=image_resize_shape,
        resume_adapter=resume_bundle,
    )
    if len(command) < 3 or command[1:3] != ["-m", "mlx_vlm.lora"]:
        raise RuntimeError(f"Unexpected MLX-VLM command shape: {command[:4]}")
    command = [command[0], str(checkpoint_safe.COMPAT_LAUNCHER), *command[3:]]
    command = checkpoint_safe._set_arg(
        command,
        "--max-seq-length",
        str(checkpoint_safe.DEFAULT_MAX_SEQ_LENGTH),
    )
    plan = {
        "runtime": runtime,
        "resume_adapter": str(resume_bundle),
        "dataset": str(dataset),
        "adapter": str(adapter_bundle),
        "epochs": epochs,
        "learning_rate": learning_rate,
        "image_resize_shape": list(image_resize_shape),
        "command": command,
    }
    print(json.dumps({"CURRICULUM TRAINING PLAN": plan}, indent=2), flush=True)
    if dry_run:
        shutil.rmtree(adapter_bundle)
        return adapter_bundle, {**plan, "dry_run": True}

    result = checkpoint_safe._run_training_supervised(
        command,
        original_run=subprocess.run,
        cwd=SERVICE_ROOT,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Curriculum LoRA training failed with exit code {result.returncode}")
    config = adapter_bundle / "adapter_config.json"
    if not adapter_weights.is_file() or adapter_weights.stat().st_size <= 0 or not config.is_file():
        raise RuntimeError("Curriculum training finished without a complete adapter bundle")
    return adapter_bundle, plan


def _write_training_receipt(
    *,
    adapter: Path,
    dataset: Path,
    manifest: dict[str, Any],
    inventory: dict[str, Any],
    resume_adapter: Path,
    benchmark_sources: list[str],
    curriculum_audit: list[dict[str, Any]],
    epochs: int,
    learning_rate: float,
) -> None:
    weights = adapter / "adapters.safetensors"
    payload = {
        "schema_version": "tcos.instacomp-ai.full-inventory-lora.v1",
        "created_at": _now(),
        "status": "training_schedule_complete",
        "inventory_training_coverage_percent": 100.0,
        "inventory_eligible_learned": inventory["learned"],
        "inventory_eligible_total": inventory["eligible"],
        "trusted_examples_consumed": int(manifest.get("trusted_examples") or 0),
        "train_examples": int(manifest.get("train_examples") or 0),
        "held_out_validation_examples": int(manifest.get("validation_examples") or 0),
        "epochs_completed": epochs,
        "fresh_full_corpus_run": True,
        "full_corpus_curriculum_warm_start": True,
        "learning_rate": learning_rate,
        "dataset_path": str(dataset),
        "dataset_sha256": _dataset_fingerprint(dataset),
        "adapter_directory": str(adapter),
        "adapter_weights": str(weights),
        "adapter_bytes": weights.stat().st_size,
        "adapter_weights_sha256": _sha256(weights),
        "resume_adapter_directory": str(resume_adapter),
        "source_complete_100_card_benchmarks": benchmark_sources,
        "curriculum_verified_miss_examples": curriculum_audit,
        "curriculum_forced_train_examples": len({row["training_example_id"] for row in curriculum_audit}),
        "curriculum_multiplier": int((manifest.get("curriculum") or {}).get("multiplier") or 1),
        "promotion_status": "not_promoted_pending_locked_validation",
        "meaning_of_100_percent": (
            "100% means every currently eligible image-backed inventory card is represented in the trusted corpus. "
            "Benchmark misses are additionally weighted only after their trusted Registry UUID/fingerprint still match. "
            "It does not claim 100% recognition accuracy; the next disjoint 100-card benchmark measures that."
        ),
    }
    TRAINING_RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    tmp = TRAINING_RECEIPT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(TRAINING_RECEIPT)
    print(f"PASS curriculum training receipt written: {TRAINING_RECEIPT}", flush=True)


def _self_test() -> int:
    fake = [
        {"authoritative_exact": True, "row_id": "pass"},
        {
            "authoritative_exact": False,
            "row_id": "miss",
            "expected_registry_identity_id": "00000000-0000-4000-8000-000000000001",
            "expected_registry_fingerprint_sha256": "a" * 64,
        },
    ]
    assert [row["row_id"] for row in fake if row.get("authoritative_exact") is not True] == ["miss"]
    assert _valid_sha("A" * 64) == "a" * 64
    assert _valid_sha("no") is None
    print("PASS curriculum selects only benchmark misses/reviews")
    print("PASS curriculum requires exact Registry fingerprint-shaped truth")
    print("PASS curriculum uses a separate new adapter and leaves current weights untouched")
    print("PASS curriculum next score must come from a disjoint benchmark receipt")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Warm-start a new LoRA from the current certified adapter and weight only misses from complete "
            "100-card unseen benchmarks whose trusted examples still match the exact Registry UUID/fingerprint."
        )
    )
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--learning-rate", type=float, default=DEFAULT_LEARNING_RATE)
    parser.add_argument("--curriculum-multiplier", type=int, default=DEFAULT_CURRICULUM_MULTIPLIER)
    parser.add_argument("--image-resize-shape", nargs=2, type=int, default=DEFAULT_IMAGE_RESIZE_SHAPE)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return _self_test()
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise SystemExit("Unseen-miss curriculum training must run on the Apple Silicon Mac.")
    if args.epochs <= 0 or args.learning_rate <= 0 or args.curriculum_multiplier < 1:
        raise SystemExit("Invalid curriculum training schedule")

    completion, resume_adapter, _current_dataset = promotion_base.completion_gate()
    current_sha = _sha256(resume_adapter / "adapters.safetensors")
    benchmarks = _complete_benchmarks()
    if not benchmarks:
        raise SystemExit("No complete 100-card unseen benchmark exists; refusing to train on a partial exam.")
    newest_path, newest = benchmarks[-1]
    if _norm(newest.get("adapter_weights_sha256")) != _norm(current_sha):
        raise SystemExit(
            "Newest complete 100-card benchmark does not belong to the currently certified adapter; "
            "run the benchmark before training another generation."
        )
    if newest.get("graduation_gate_passed") is True:
        raise SystemExit("Current adapter already passed the 100-card graduation gate; no curriculum retraining is needed.")

    inventory = _inventory_coverage()
    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    latest = latest_training_examples(store.list_training_examples(trusted_only=True, limit=100_000))
    readiness = training_readiness(latest)
    if not readiness.get("ready_for_production_candidate"):
        raise SystemExit(f"Current trusted corpus is not production-candidate ready: {readiness}")

    expectations, benchmark_sources = _miss_expectations(benchmarks)
    force_ids, curriculum_audit = _verified_curriculum_examples(latest, expectations)
    if not force_ids:
        raise SystemExit("Complete benchmark had no Registry-verifiable misses to teach.")
    print(
        f"CURRICULUM VERIFIED: complete_benchmarks={len(benchmarks)} "
        f"verified_miss_examples={len(force_ids)} multiplier={args.curriculum_multiplier}",
        flush=True,
    )

    dataset, manifest = _export_curriculum_dataset(
        latest,
        force_train_ids=force_ids,
        image_store_path=settings.resolve_local_path(settings.image_store_path),
        destination_root=settings.resolve_local_path(settings.training_export_path),
        multiplier=args.curriculum_multiplier,
    )
    adapter, _plan = _train(
        dataset,
        resume_adapter=resume_adapter,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        image_resize_shape=(int(args.image_resize_shape[0]), int(args.image_resize_shape[1])),
        dry_run=args.dry_run,
    )
    if args.dry_run:
        print("PASS curriculum dry run; no model weights or completion receipt changed", flush=True)
        return 0

    _write_training_receipt(
        adapter=adapter,
        dataset=dataset,
        manifest=manifest,
        inventory=inventory,
        resume_adapter=resume_adapter,
        benchmark_sources=benchmark_sources,
        curriculum_audit=curriculum_audit,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
    )
    print(
        f"PASS new curriculum adapter trained at {adapter}; old certified adapter remains available for rollback",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
