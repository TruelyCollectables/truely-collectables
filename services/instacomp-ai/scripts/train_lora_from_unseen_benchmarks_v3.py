#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Awaitable, Callable

import train_lora_from_unseen_benchmarks_v2 as v2
from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
from app.models import CardIdentity, ChecklistOutcome
from app.training import (
    _dataset_row as canonical_dataset_row,
    build_serial_truth,
    changed_fields,
)

legacy = v2.legacy
SCHEMA = "tcos.instacomp-ai.unseen-miss-curriculum.v3"

_ORIGINAL_DATASET_ROW = legacy._dataset_row
_ORIGINAL_EXPORT = legacy._export_curriculum_dataset
_ORIGINAL_WRITE_RECEIPT = legacy._write_training_receipt
_LABEL_OVERRIDES: dict[str, dict[str, Any]] = {}
_QUARANTINED_MISSES: list[dict[str, Any]] = []


class CurriculumUnverifiable(RuntimeError):
    """Current truth is unavailable, not contradictory; exclude this miss from training."""


def _expected_identity(wanted: dict[str, Any], example: Any) -> Any:
    saved = wanted.get("expected_identity")
    if isinstance(saved, dict) and saved:
        return CardIdentity.model_validate(saved)
    return example.confirmed_identity


def _canonical_identity_payload(result: Any, fallback: Any) -> dict[str, Any]:
    identity = getattr(result, "identity", None) or fallback
    if hasattr(identity, "model_dump"):
        return identity.model_dump(mode="json")
    if isinstance(identity, dict):
        return dict(identity)
    return CardIdentity.model_validate(identity).model_dump(mode="json")


def _raise_if_current_contradiction(
    diagnostics: dict[str, Any],
    *,
    row_id: str,
    expected_registry: str,
    expected_fingerprint: str,
) -> None:
    actual_registry = str(diagnostics.get("registry_identity_id") or "").strip()
    actual_fingerprint = legacy._valid_sha(diagnostics.get("registry_fingerprint_sha256"))
    if actual_registry and legacy._norm(actual_registry) != legacy._norm(expected_registry):
        raise RuntimeError(
            f"Refusing stale curriculum truth for {row_id}: Registry UUID changed "
            f"benchmark={expected_registry} current={actual_registry}"
        )
    if actual_fingerprint and actual_fingerprint != expected_fingerprint:
        raise RuntimeError(
            f"Refusing stale curriculum truth for {row_id}: Registry fingerprint changed"
        )


async def _revalidate_one(
    *,
    row_id: str,
    wanted: dict[str, Any],
    example: Any,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    expected_registry = str(wanted["registry_identity_id"]).strip()
    expected_fingerprint = str(wanted["registry_fingerprint_sha256"]).strip().lower()
    request_identity = _expected_identity(wanted, example)
    gateway = AuthoritativeRegistryChecklistGateway(
        timeout_seconds=v2.LIVE_REVALIDATION_HTTP_TIMEOUT_SECONDS,
        max_attempts=2,
        retry_backoff_seconds=0.5,
    )

    async with semaphore:
        try:
            direct_result, direct_diagnostics = await v2._canonical_revalidate(
                gateway,
                request_identity,
                expected_registry=expected_registry,
                expected_fingerprint=expected_fingerprint,
            )
        except TimeoutError:
            direct_result = SimpleNamespace(outcome=ChecklistOutcome.NOT_CONFIGURED, identity=None)
            direct_diagnostics = {
                "registry_receipt_revalidation_attempted": False,
                "registry_receipt_revalidation_accepted": False,
                "registry_identity_id": None,
                "registry_fingerprint_sha256": None,
                "registry_attempts": 0,
                "registry_transport_error": "curriculum_direct_revalidation_timeout",
            }

        if v2._accepted_expected_receipt(
            direct_result,
            direct_diagnostics,
            expected_registry=expected_registry,
            expected_fingerprint=expected_fingerprint,
        ):
            return {
                "registry_identity_id": expected_registry,
                "registry_fingerprint_sha256": expected_fingerprint,
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_attempts": int(direct_diagnostics.get("registry_attempts") or 0),
                "revalidation_path": "canonical_direct",
                "canonical_identity": _canonical_identity_payload(direct_result, request_identity),
            }

        _raise_if_current_contradiction(
            direct_diagnostics,
            row_id=row_id,
            expected_registry=expected_registry,
            expected_fingerprint=expected_fingerprint,
        )

        bootstrap, bootstrap_reason = await v2._player_card_bootstrap(
            row_id=row_id,
            identity=request_identity,
        )
        if bootstrap is None:
            direct_status = str(getattr(direct_result.outcome, "value", direct_result.outcome))
            raise CurriculumUnverifiable(
                f"canonical receipt revalidation was not accepted (outcome={direct_status}); "
                f"indexed player-card recovery unavailable reason={bootstrap_reason}"
            )

        if legacy._norm(bootstrap.registry_id) != legacy._norm(expected_registry):
            raise RuntimeError(
                f"Refusing stale curriculum truth for {row_id}: Registry UUID changed "
                f"benchmark={expected_registry} current={bootstrap.registry_id}"
            )
        if bootstrap.fingerprint != expected_fingerprint:
            raise RuntimeError(
                f"Refusing stale curriculum truth for {row_id}: Registry fingerprint changed"
            )

        try:
            retry_result, retry_diagnostics = await v2._canonical_revalidate(
                gateway,
                bootstrap.identity,
                expected_registry=expected_registry,
                expected_fingerprint=expected_fingerprint,
            )
        except TimeoutError as exc:
            raise CurriculumUnverifiable(
                "canonical Registry receipt revalidation timed out after indexed player-card recovery"
            ) from exc

        if not v2._accepted_expected_receipt(
            retry_result,
            retry_diagnostics,
            expected_registry=expected_registry,
            expected_fingerprint=expected_fingerprint,
        ):
            _raise_if_current_contradiction(
                retry_diagnostics,
                row_id=row_id,
                expected_registry=expected_registry,
                expected_fingerprint=expected_fingerprint,
            )
            retry_status = str(getattr(retry_result.outcome, "value", retry_result.outcome))
            raise CurriculumUnverifiable(
                "indexed player-card recovery found the benchmark Registry identity but canonical "
                f"receipt revalidation was not accepted (outcome={retry_status})"
            )

        return {
            "registry_identity_id": expected_registry,
            "registry_fingerprint_sha256": expected_fingerprint,
            "registry_receipt_revalidation_attempted": True,
            "registry_receipt_revalidation_accepted": True,
            "registry_attempts": int(retry_diagnostics.get("registry_attempts") or 0),
            "revalidation_path": "indexed_player_card_then_canonical",
            "bootstrap_reason": bootstrap_reason,
            "canonical_identity": _canonical_identity_payload(retry_result, bootstrap.identity),
        }


async def _revalidate_all(
    pending: list[tuple[str, dict[str, Any], Any, str]],
    *,
    revalidate_fn: Callable[..., Awaitable[dict[str, Any]]] | None = None,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    semaphore = asyncio.Semaphore(v2.LIVE_REVALIDATION_CONCURRENCY)
    fn = revalidate_fn or _revalidate_one
    completed = 0
    accepted = 0
    quarantined = 0
    total = len(pending)
    progress_lock = asyncio.Lock()

    async def run_one(
        row_id: str,
        wanted: dict[str, Any],
        example: Any,
        resolution: str,
    ) -> tuple[str, dict[str, Any] | None, dict[str, Any] | None]:
        nonlocal completed, accepted, quarantined
        detail: dict[str, Any] | None = None
        quarantine: dict[str, Any] | None = None
        try:
            detail = await fn(
                row_id=row_id,
                wanted=wanted,
                example=example,
                semaphore=semaphore,
            )
            detail["resolution"] = resolution
        except CurriculumUnverifiable as exc:
            quarantine = {
                "benchmark_row_id": row_id,
                "training_example_id": str(example.training_example_id),
                "resolution": resolution,
                "registry_identity_id": wanted["registry_identity_id"],
                "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
                "source_benchmark": wanted["source_benchmark"],
                "reason": str(exc),
                "status": "quarantined_unverifiable_current_registry_truth",
            }

        async with progress_lock:
            completed += 1
            if detail is not None:
                accepted += 1
            else:
                quarantined += 1
            if completed == 1 or completed % 10 == 0 or completed == total:
                print(
                    f"CURRICULUM REGISTRY REVALIDATION: {completed}/{total} accepted={accepted} "
                    f"quarantined={quarantined} concurrency={v2.LIVE_REVALIDATION_CONCURRENCY}",
                    flush=True,
                )
        return row_id, detail, quarantine

    rows = await asyncio.gather(
        *(run_one(row_id, wanted, example, resolution) for row_id, wanted, example, resolution in pending)
    )
    accepted_rows: dict[str, dict[str, Any]] = {}
    quarantines: list[dict[str, Any]] = []
    for row_id, detail, quarantine in rows:
        if detail is not None:
            accepted_rows[row_id] = detail
        if quarantine is not None:
            quarantines.append(quarantine)
    return accepted_rows, quarantines


def _miss_expectations(
    benchmarks: list[tuple[Path, dict[str, Any]]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    expectations: dict[str, dict[str, Any]] = {}
    sources: list[str] = []
    dataset_metadata_cache: dict[str, dict[str, dict[str, Any]]] = {}

    for path, payload in benchmarks:
        sources.append(str(path))
        dataset = Path(str(payload.get("dataset") or "")).expanduser().resolve()
        metadata_by_row: dict[str, dict[str, Any]] = {}
        if dataset.is_dir():
            key = str(dataset)
            metadata_by_row = dataset_metadata_cache.get(key) or legacy._dataset_row_metadata(dataset)
            dataset_metadata_cache[key] = metadata_by_row
        for result in payload.get("results") or []:
            if not isinstance(result, dict) or result.get("authoritative_exact") is True:
                continue
            row_id = str(result.get("row_id") or "").strip()
            registry_id = str(result.get("expected_registry_identity_id") or "").strip()
            fingerprint = legacy._valid_sha(result.get("expected_registry_fingerprint_sha256"))
            if not row_id or not registry_id or not fingerprint:
                raise RuntimeError(
                    f"Benchmark miss lacks authoritative expected Registry truth: {path} row={row_id!r}"
                )
            metadata = metadata_by_row.get(row_id) or {}
            expected_identity = result.get("expected_identity")
            expectations[row_id] = {
                "row_id": row_id,
                "registry_identity_id": registry_id,
                "registry_fingerprint_sha256": fingerprint,
                "card_uuid": str(metadata.get("card_uuid") or "").strip(),
                "source_benchmark": str(path),
                "expected_identity": dict(expected_identity) if isinstance(expected_identity, dict) else None,
            }
    return expectations, sources


def _verified_curriculum_examples(
    examples: list[Any],
    expectations: dict[str, dict[str, Any]],
) -> tuple[set[str], list[dict[str, Any]]]:
    global _LABEL_OVERRIDES, _QUARANTINED_MISSES
    _LABEL_OVERRIDES = {}
    _QUARANTINED_MISSES = []

    by_id = {str(example.training_example_id): example for example in examples}
    by_card_uuid = {
        str(example.card_uuid): example
        for example in examples
        if str(example.card_uuid or "").strip()
    }
    pending: list[tuple[str, dict[str, Any], Any, str]] = []

    for original_row_id, wanted in sorted(expectations.items()):
        example = by_id.get(original_row_id)
        resolution = "same_training_example"
        if example is None and wanted.get("card_uuid"):
            example = by_card_uuid.get(str(wanted["card_uuid"]))
            resolution = "latest_same_physical_card"
        if example is None:
            _QUARANTINED_MISSES.append(
                {
                    "benchmark_row_id": original_row_id,
                    "training_example_id": None,
                    "resolution": "trusted_example_missing",
                    "registry_identity_id": wanted["registry_identity_id"],
                    "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
                    "source_benchmark": wanted["source_benchmark"],
                    "reason": "no current trusted example for benchmark row/physical card",
                    "status": "quarantined_unverifiable_current_registry_truth",
                }
            )
            continue

        # A persisted non-empty contradiction remains an immediate hard stop.
        v2._local_receipt_without_contradiction(example, wanted)
        pending.append((original_row_id, wanted, example, resolution))

    current_receipts, live_quarantines = asyncio.run(_revalidate_all(pending)) if pending else ({}, [])
    _QUARANTINED_MISSES.extend(live_quarantines)

    force_ids: set[str] = set()
    audit: list[dict[str, Any]] = []
    for original_row_id, wanted, example, resolution in pending:
        current = current_receipts.get(original_row_id)
        if current is None:
            continue
        current_id = str(example.training_example_id)
        force_ids.add(current_id)
        canonical_identity = dict(current["canonical_identity"])
        _LABEL_OVERRIDES[current_id] = {
            "identity": canonical_identity,
            "registry_identity_id": current["registry_identity_id"],
            "registry_fingerprint_sha256": current["registry_fingerprint_sha256"],
        }
        audit.append(
            {
                "benchmark_row_id": original_row_id,
                "training_example_id": current_id,
                "resolution": f"{resolution}+current_registry_receipt_revalidated",
                "registry_identity_id": current["registry_identity_id"],
                "registry_fingerprint_sha256": current["registry_fingerprint_sha256"],
                "registry_receipt_revalidation_attempted": True,
                "registry_receipt_revalidation_accepted": True,
                "registry_attempts": current["registry_attempts"],
                "registry_revalidation_path": current["revalidation_path"],
                "registry_bootstrap_reason": current.get("bootstrap_reason"),
                "canonical_identity": canonical_identity,
                "source_benchmark": wanted["source_benchmark"],
            }
        )

    print(
        f"CURRICULUM V3 ADMISSION: verified={len(force_ids)} quarantined={len(_QUARANTINED_MISSES)} "
        "hard UUID/fingerprint contradictions remain fatal",
        flush=True,
    )
    for item in _QUARANTINED_MISSES[:10]:
        print(
            f"CURRICULUM QUARANTINE {item.get('benchmark_row_id')}: {item.get('reason')}",
            flush=True,
        )
    return force_ids, audit


def _ephemeral_override(example: Any, override: dict[str, Any]) -> Any:
    identity = CardIdentity.model_validate(override["identity"])
    updates = {
        "confirmed_identity": identity,
        "registry_identity_id": override["registry_identity_id"],
        "registry_fingerprint_sha256": override["registry_fingerprint_sha256"],
        "serial_truth": build_serial_truth(identity=identity, local_vision=example.local_vision),
        "correction_fields": changed_fields(example.predicted_identity, identity),
    }
    if hasattr(example, "model_copy"):
        return example.model_copy(deep=True, update=updates)
    clone = SimpleNamespace(**vars(example))
    for key, value in updates.items():
        setattr(clone, key, value)
    return clone


def _dataset_row(
    example: Any,
    *,
    image_store_path: Path,
    source_fn: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    fn = source_fn or canonical_dataset_row
    override = _LABEL_OVERRIDES.get(str(example.training_example_id))
    if override is None:
        return fn(example, image_store_path=image_store_path)
    ephemeral = _ephemeral_override(example, override)
    return fn(ephemeral, image_store_path=image_store_path)


def _export_curriculum_dataset(*args: Any, **kwargs: Any):
    dataset, manifest = _ORIGINAL_EXPORT(*args, **kwargs)
    curriculum = manifest.get("curriculum") if isinstance(manifest.get("curriculum"), dict) else {}
    curriculum = {
        **curriculum,
        "canonical_registry_label_overrides": len(_LABEL_OVERRIDES),
        "quarantined_unverifiable_misses": len(_QUARANTINED_MISSES),
        "unverifiable_misses_never_forced_into_training": True,
    }
    manifest["curriculum"] = curriculum
    manifest["curriculum_quarantined_misses"] = list(_QUARANTINED_MISSES)
    Path(dataset, "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", "utf-8")
    return dataset, manifest


def _write_training_receipt(*args: Any, **kwargs: Any) -> None:
    _ORIGINAL_WRITE_RECEIPT(*args, **kwargs)
    path = legacy.TRAINING_RECEIPT
    if not path.is_file():
        return
    payload = json.loads(path.read_text("utf-8"))
    payload["curriculum_quarantined_misses"] = list(_QUARANTINED_MISSES)
    payload["curriculum_quarantined_miss_count"] = len(_QUARANTINED_MISSES)
    payload["curriculum_canonical_label_override_count"] = len(_LABEL_OVERRIDES)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(path)


def _self_test() -> int:
    assert legacy._self_test() == 0
    assert v2._self_test() == 0

    wanted = {
        "row_id": "row-1",
        "registry_identity_id": "00000000-0000-4000-8000-000000000001",
        "registry_fingerprint_sha256": "a" * 64,
        "source_benchmark": "/tmp/benchmark.json",
        "card_uuid": "card-1",
        "expected_identity": {
            "sport": "Basketball",
            "year": "2025",
            "brand": "Prizm",
            "set_name": "Base",
            "player": "Truth Player",
            "card_number": "77",
            "parallel": "Base",
        },
    }
    example = SimpleNamespace(
        training_example_id="row-1",
        confirmed_identity=CardIdentity.model_validate(
            {"sport": "Basketball", "player": "Stale", "card_number": "77"}
        ),
    )
    assert _expected_identity(wanted, example).player == "Truth Player"

    pending = [
        ("good", {**wanted, "row_id": "good"}, SimpleNamespace(training_example_id="good"), "same"),
        ("skip", {**wanted, "row_id": "skip"}, SimpleNamespace(training_example_id="skip"), "same"),
    ]

    async def fake_revalidate(**kwargs: Any) -> dict[str, Any]:
        if kwargs["row_id"] == "skip":
            raise CurriculumUnverifiable("current Registry row unavailable")
        return {
            "registry_identity_id": wanted["registry_identity_id"],
            "registry_fingerprint_sha256": wanted["registry_fingerprint_sha256"],
            "registry_attempts": 1,
            "revalidation_path": "test",
            "canonical_identity": wanted["expected_identity"],
        }

    accepted, quarantined = asyncio.run(_revalidate_all(pending, revalidate_fn=fake_revalidate))
    assert set(accepted) == {"good"}
    assert [row["benchmark_row_id"] for row in quarantined] == ["skip"]

    async def fake_contradiction(**_kwargs: Any) -> dict[str, Any]:
        raise RuntimeError("Refusing stale curriculum truth: Registry UUID changed")

    try:
        asyncio.run(_revalidate_all(pending[:1], revalidate_fn=fake_contradiction))
    except RuntimeError as exc:
        assert "Registry UUID changed" in str(exc)
    else:
        raise AssertionError("Registry contradiction must remain fatal")

    print("PASS curriculum V3 quarantines unverifiable misses without teaching them")
    print("PASS curriculum V3 preserves hard-fail current UUID/fingerprint contradictions")
    print("PASS curriculum V3 prefers the exact exam-admitted identity when the receipt carries it")
    print("PASS curriculum V3 uses canonical Registry identity only as an ephemeral forced-row label override")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    legacy._miss_expectations = _miss_expectations
    legacy._verified_curriculum_examples = _verified_curriculum_examples
    legacy._dataset_row = _dataset_row
    legacy._export_curriculum_dataset = _export_curriculum_dataset
    legacy._write_training_receipt = _write_training_receipt
    legacy.SCHEMA = SCHEMA
    return int(legacy.main())


if __name__ == "__main__":
    raise SystemExit(main())
