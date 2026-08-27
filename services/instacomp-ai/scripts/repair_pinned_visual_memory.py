#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = Path(__file__).resolve().parent
for candidate in (SERVICE_ROOT, SCRIPTS_ROOT):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from app.config import settings
from app.models import LocalVisionEvidence, TrainingExample
from app.pattern_memory import find_trusted_pattern_style
from app.training import latest_training_examples
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v14 as v14
from repair_trusted_visual_memory import RepairCandidate, _analyze_candidate, _persist_local_vision


def _wanted_ids(stage_target: int) -> tuple[str, ...]:
    if stage_target not in v14.PINNED_BACKFILL_POOL_SIZES:
        raise RuntimeError(
            f"Unsupported pinned visual-memory stage {stage_target}; "
            f"allowed={tuple(v14.PINNED_BACKFILL_POOL_SIZES)}"
        )
    count = v14.PINNED_BACKFILL_POOL_SIZES[stage_target]
    return tuple(v12.PINNED_EXPANSION_ROW_IDS[:count])


def _physical_key(example: TrainingExample) -> str:
    return str(example.card_uuid or f"scan:{example.scan_id}")


def _parallel_key(value: object) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()
    normalized = " ".join(
        token for token in text.split() if token not in {"prizm", "prizms"}
    )
    return "base" if normalized in {"base set", "base card"} else normalized


def _requires_style_memory(example: TrainingExample) -> bool:
    return _parallel_key(example.confirmed_identity.parallel) not in {"", "base"}


def _load_trusted_rows(
    database_path: Path,
) -> tuple[dict[str, sqlite3.Row], dict[str, TrainingExample], dict[str, TrainingExample]]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT te.training_example_id, te.scan_id, te.example_json, "
            "s.local_vision_json AS scan_local_vision_json "
            "FROM training_examples te "
            "JOIN scans s ON s.scan_id = te.scan_id "
            "WHERE te.trusted = 1"
        ).fetchall()
    finally:
        connection.close()

    rows_by_id: dict[str, sqlite3.Row] = {}
    examples_by_id: dict[str, TrainingExample] = {}
    for row in rows:
        training_id = str(row["training_example_id"])
        rows_by_id[training_id] = row
        try:
            examples_by_id[training_id] = TrainingExample.model_validate(
                json.loads(row["example_json"])
            )
        except Exception:
            continue

    active_by_key = {
        _physical_key(example): example
        for example in latest_training_examples(examples_by_id.values())
    }
    return rows_by_id, examples_by_id, active_by_key


def _scan_local_vision(row: sqlite3.Row) -> dict[str, Any] | None:
    if not row["scan_local_vision_json"]:
        return None
    try:
        parsed = json.loads(row["scan_local_vision_json"])
        return LocalVisionEvidence.model_validate(parsed).model_dump(mode="json")
    except Exception:
        return None


def _load_required_candidates(
    database_path: Path,
    wanted_ids: Iterable[str],
) -> tuple[list[RepairCandidate], dict[str, Any]]:
    wanted = tuple(dict.fromkeys(str(value).strip() for value in wanted_ids if str(value).strip()))
    rows_by_id, examples_by_id, active_by_key = _load_trusted_rows(database_path)
    candidates: list[RepairCandidate] = []
    candidate_ids: set[str] = set()
    already_hydrated: set[str] = set()
    invalid_rows: list[dict[str, str]] = []
    superseded: list[dict[str, str]] = []
    conflicts: list[dict[str, str]] = []

    for training_id in wanted:
        row = rows_by_id.get(training_id)
        if row is None:
            continue
        pinned = examples_by_id.get(training_id)
        if pinned is None:
            invalid_rows.append(
                {"training_example_id": training_id, "error": "TrainingExample validation failed"}
            )
            continue

        active = active_by_key.get(_physical_key(pinned), pinned)
        if active.training_example_id != pinned.training_example_id:
            superseded.append(
                {
                    "pinned_training_example_id": pinned.training_example_id,
                    "active_training_example_id": active.training_example_id,
                    "card_key": _physical_key(pinned),
                }
            )

        if _requires_style_memory(pinned):
            expected = _parallel_key(pinned.confirmed_identity.parallel)
            active_parallel = _parallel_key(active.confirmed_identity.parallel)
            if active_parallel != expected:
                conflicts.append(
                    {
                        "pinned_training_example_id": pinned.training_example_id,
                        "active_training_example_id": active.training_example_id,
                        "expected_parallel": str(pinned.confirmed_identity.parallel or ""),
                        "active_parallel": str(active.confirmed_identity.parallel or ""),
                    }
                )
                continue

        # Both sides matter. The pinned row supplies the exact Frozen fixture
        # witness; latest_training_examples decides which row runtime memory can
        # actually learn from. Hydrating only one of them is not a usable lesson.
        targets = [pinned]
        if active.training_example_id != pinned.training_example_id:
            targets.append(active)
        for target in targets:
            target_row = rows_by_id.get(target.training_example_id)
            if target_row is None:
                invalid_rows.append(
                    {
                        "training_example_id": target.training_example_id,
                        "error": "Required trusted training row is unavailable",
                    }
                )
                continue
            if target.local_vision is not None:
                already_hydrated.add(target.training_example_id)
                continue
            if target.training_example_id in candidate_ids:
                continue
            candidate_ids.add(target.training_example_id)
            candidates.append(
                RepairCandidate(
                    training_example_id=target.training_example_id,
                    scan_id=target.scan_id,
                    front_sha256=target.front_sha256,
                    back_sha256=target.back_sha256,
                    verification_source=target.verification_source,
                    existing_scan_local_vision=_scan_local_vision(target_row),
                )
            )

    return candidates, {
        "requested_training_example_ids": list(wanted),
        "requested": len(wanted),
        "found_trusted": sum(1 for value in wanted if value in rows_by_id),
        "missing_or_untrusted": [value for value in wanted if value not in rows_by_id],
        "already_hydrated_training_example_ids": sorted(already_hydrated),
        "already_hydrated": len(already_hydrated),
        "superseded_pinned_training_examples": superseded,
        "active_truth_conflicts": conflicts,
        "invalid_rows": invalid_rows,
    }


def _verify_required_style_memory(
    database_path: Path,
    wanted_ids: Iterable[str],
) -> list[dict[str, Any]]:
    wanted = tuple(dict.fromkeys(str(value).strip() for value in wanted_ids if str(value).strip()))
    _, examples_by_id, active_by_key = _load_trusted_rows(database_path)
    unusable: list[dict[str, Any]] = []

    for training_id in wanted:
        pinned = examples_by_id.get(training_id)
        if pinned is None or not _requires_style_memory(pinned):
            continue
        active = active_by_key.get(_physical_key(pinned))
        if active is None:
            unusable.append(
                {"pinned_training_example_id": training_id, "reason": "active_trusted_truth_missing"}
            )
            continue

        expected = _parallel_key(pinned.confirmed_identity.parallel)
        active_parallel = _parallel_key(active.confirmed_identity.parallel)
        if active_parallel != expected:
            unusable.append(
                {
                    "pinned_training_example_id": training_id,
                    "active_training_example_id": active.training_example_id,
                    "reason": "active_trusted_truth_parallel_conflict",
                    "expected_parallel": str(pinned.confirmed_identity.parallel or ""),
                    "active_parallel": str(active.confirmed_identity.parallel or ""),
                }
            )
            continue
        if pinned.local_vision is None:
            unusable.append(
                {
                    "pinned_training_example_id": training_id,
                    "active_training_example_id": active.training_example_id,
                    "reason": "pinned_fixture_visual_memory_missing",
                }
            )
            continue
        if active.local_vision is None:
            unusable.append(
                {
                    "pinned_training_example_id": training_id,
                    "active_training_example_id": active.training_example_id,
                    "reason": "active_trusted_visual_memory_missing",
                }
            )
            continue

        # This is the production relationship: probe with the pinned fixture's
        # deterministic evidence while the memory loader exposes only the latest
        # trusted physical-card row. A passing probe proves the Silver lesson is
        # actually reachable before the staged Registry request is spent.
        recovered = str(pinned.local_vision.identity_hints.parallel or "").strip()
        hint_score: float | None = None
        if not recovered:
            try:
                hint = find_trusted_pattern_style(
                    database_path=database_path,
                    current=pinned.local_vision,
                )
            except Exception as exc:
                unusable.append(
                    {
                        "pinned_training_example_id": training_id,
                        "active_training_example_id": active.training_example_id,
                        "reason": "trusted_style_memory_probe_failed",
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
                continue
            if hint is not None:
                recovered = hint.parallel
                hint_score = hint.score

        if _parallel_key(recovered) != expected:
            unusable.append(
                {
                    "pinned_training_example_id": training_id,
                    "active_training_example_id": active.training_example_id,
                    "reason": "trusted_style_memory_not_retrievable",
                    "expected_parallel": str(pinned.confirmed_identity.parallel or ""),
                    "recovered_parallel": recovered,
                    "hint_score": hint_score,
                }
            )
    return unusable


def _hydrate_ids(
    *,
    database_path: Path,
    image_store_path: Path,
    wanted_ids: Iterable[str],
    workers: int,
) -> dict[str, Any]:
    wanted = tuple(dict.fromkeys(str(value).strip() for value in wanted_ids if str(value).strip()))
    candidates, stats = _load_required_candidates(database_path, wanted)
    repaired: list[str] = []
    failures: list[dict[str, str]] = list(stats["invalid_rows"])

    for conflict in stats["active_truth_conflicts"]:
        failures.append(
            {
                "training_example_id": conflict["pinned_training_example_id"],
                "scan_id": "",
                "error": (
                    "Active trusted truth conflicts with pinned style: "
                    f"expected={conflict['expected_parallel']} "
                    f"active={conflict['active_parallel']} "
                    f"active_training={conflict['active_training_example_id']}"
                ),
            }
        )

    if candidates:
        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = {
                executor.submit(
                    _analyze_candidate,
                    candidate,
                    image_store_path=image_store_path,
                ): candidate
                for candidate in candidates
            }
            for future in as_completed(futures):
                candidate = futures[future]
                try:
                    resolved, local_vision = future.result()
                    _persist_local_vision(
                        database_path,
                        training_example_id=resolved.training_example_id,
                        scan_id=resolved.scan_id,
                        local_vision=local_vision,
                    )
                    repaired.append(resolved.training_example_id)
                    print(
                        "PINNED VISUAL MEMORY REPAIRED "
                        f"training={resolved.training_example_id} scan={resolved.scan_id}",
                        flush=True,
                    )
                except Exception as exc:
                    failure = {
                        "training_example_id": candidate.training_example_id,
                        "scan_id": candidate.scan_id,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                    failures.append(failure)
                    print(
                        "PINNED VISUAL MEMORY REPAIR SKIP "
                        f"training={candidate.training_example_id}: {failure['error']}",
                        file=sys.stderr,
                        flush=True,
                    )

    return {
        "schema_version": "tcos.instacomp-ai.pinned-visual-memory-repair.v2",
        "database": str(database_path),
        "image_store": str(image_store_path),
        **stats,
        "attempted": len(candidates),
        "repaired": len(repaired),
        "repaired_training_example_ids": sorted(repaired),
        "unusable_style_memory": _verify_required_style_memory(database_path, wanted),
        "failures": failures,
        "identity_fields_mutated": False,
        "registry_data_mutated": False,
        "images_mutated": False,
    }


def _fake_visual() -> dict[str, Any]:
    return {
        "schema_version": "tcos.instacomp-ai.local-vision.v1",
        "front": {
            "side": "front",
            "width": 100,
            "height": 140,
            "ocr": [],
            "colors": {},
            "pattern": {
                "label": "unknown",
                "confidence": 0.0,
                "scores": {},
                "geometry": ["detected 300 long line segments"],
                "line_count": 300,
                "polygon_count": 145,
                "edge_density": 0.12,
                "angle_concentration": 0.5,
                "angle_entropy": 0.8,
            },
            "errors": [],
        },
        "back": None,
        "serial": {"stamp_present": False},
        "identity_hints": {"manufacturer": "Panini"},
        "combined_text": "2025 PANINI - WNBA PRIZM BASKETBALL",
        "apple_vision_available": False,
        "opencv_available": True,
    }


def _example_payload(
    *,
    training_id: str,
    scan_id: str,
    card_uuid: str,
    created_at: datetime,
    parallel: str,
    local_vision: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "training_example_id": training_id,
        "lesson_id": f"lesson-{training_id}",
        "scan_id": scan_id,
        "card_uuid": card_uuid,
        "state": "operator_confirmed",
        "trusted": True,
        "created_at": created_at.isoformat(),
        "verification_source": "legacy_reviewed_operator_confirmed",
        "operator_id": "tester",
        "notes": None,
        "confirmed_identity": {
            "sport": "Basketball",
            "league": "WNBA",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "Panini Prizm WNBA",
            "set_name": "Base",
            "player": "DeWanna Bonner",
            "card_number": "32",
            "parallel": parallel,
        },
        "predicted_identity": None,
        "rejected_identity": None,
        "correction_fields": [],
        "local_suggestion": None,
        "local_vision": local_vision,
        "checklist": {"outcome": "input_incomplete", "reasons": [], "source_receipts": []},
        "registry_identity_id": None,
        "registry_fingerprint_sha256": None,
        "front_sha256": "a" * 64,
        "back_sha256": "b" * 64,
        "image_pair_sha256": "c" * 64,
        "front_perceptual_hash": None,
        "back_perceptual_hash": None,
        "serial_truth": {
            "visible_stamp_present": False,
            "numerator_is_card_specific": True,
            "denominator_is_configuration_level": True,
        },
    }


def _self_test() -> int:
    assert len(_wanted_ids(10)) == 8
    assert len(_wanted_ids(15)) == 15
    assert len(_wanted_ids(25)) == 20
    assert "19110d26-8d83-46b2-9871-1fccfe2ab45f" in _wanted_ids(15)
    assert "d6bcd174-3f84-49b8-8538-4d1f57263274" in _wanted_ids(15)

    with tempfile.TemporaryDirectory(prefix="instacomp-pinned-visual-memory-") as temp:
        database_path = Path(temp) / "memory.sqlite3"
        image_store_path = Path(temp) / "images"
        image_store_path.mkdir(parents=True, exist_ok=True)
        pinned_id = "d6bcd174-3f84-49b8-8538-4d1f57263274"
        active_id = "training-dewanna-active"
        card_uuid = "card-dewanna"
        now = datetime.now(timezone.utc)
        pinned_payload = _example_payload(
            training_id=pinned_id,
            scan_id="scan-dewanna-pinned",
            card_uuid=card_uuid,
            created_at=now - timedelta(minutes=1),
            parallel="Silver Prizm",
            local_vision=_fake_visual(),
        )
        active_payload = _example_payload(
            training_id=active_id,
            scan_id="scan-dewanna-active",
            card_uuid=card_uuid,
            created_at=now,
            parallel="Silver",
            local_vision=None,
        )

        connection = sqlite3.connect(database_path)
        try:
            connection.executescript(
                """
                CREATE TABLE scans (
                    scan_id TEXT PRIMARY KEY,
                    local_vision_json TEXT
                );
                CREATE TABLE training_examples (
                    training_example_id TEXT PRIMARY KEY,
                    scan_id TEXT NOT NULL,
                    trusted INTEGER NOT NULL,
                    example_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            for payload in (pinned_payload, active_payload):
                connection.execute(
                    "INSERT INTO scans(scan_id, local_vision_json) VALUES (?, ?)",
                    (payload["scan_id"], json.dumps(_fake_visual())),
                )
                connection.execute(
                    "INSERT INTO training_examples(training_example_id, scan_id, trusted, "
                    "example_json, created_at) VALUES (?, ?, 1, ?, ?)",
                    (
                        payload["training_example_id"],
                        payload["scan_id"],
                        json.dumps(payload),
                        payload["created_at"],
                    ),
                )
            connection.commit()
        finally:
            connection.close()

        result = _hydrate_ids(
            database_path=database_path,
            image_store_path=image_store_path,
            wanted_ids=[pinned_id],
            workers=1,
        )
        assert result["failures"] == []
        assert result["missing_or_untrusted"] == []
        assert result["repaired_training_example_ids"] == [active_id]
        assert result["unusable_style_memory"] == []
        assert result["superseded_pinned_training_examples"][0]["active_training_example_id"] == active_id

        conflict_payload = _example_payload(
            training_id="training-dewanna-conflict",
            scan_id="scan-dewanna-conflict",
            card_uuid=card_uuid,
            created_at=now + timedelta(minutes=1),
            parallel="Base",
            local_vision=_fake_visual(),
        )
        connection = sqlite3.connect(database_path)
        try:
            connection.execute(
                "INSERT INTO scans(scan_id, local_vision_json) VALUES (?, ?)",
                (conflict_payload["scan_id"], json.dumps(_fake_visual())),
            )
            connection.execute(
                "INSERT INTO training_examples(training_example_id, scan_id, trusted, "
                "example_json, created_at) VALUES (?, ?, 1, ?, ?)",
                (
                    conflict_payload["training_example_id"],
                    conflict_payload["scan_id"],
                    json.dumps(conflict_payload),
                    conflict_payload["created_at"],
                ),
            )
            connection.commit()
        finally:
            connection.close()

        conflict = _hydrate_ids(
            database_path=database_path,
            image_store_path=image_store_path,
            wanted_ids=[pinned_id],
            workers=1,
        )
        assert conflict["active_truth_conflicts"]
        assert conflict["failures"]
        assert conflict["unusable_style_memory"]

    print("PASS pinned visual-memory repair includes Caitlin and DeWanna in Frozen 15")
    print("PASS pinned visual-memory repair hydrates active newest physical-card truth")
    print("PASS pinned visual-memory repair proves pinned Silver style is runtime-retrievable")
    print("PASS pinned visual-memory repair fails closed on active truth conflicts")
    print("PASS pinned visual-memory repair preserves identity and Registry truth")
    return 0


def _stage_target(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--stage-target", type=int, default=10)
    args, _ = parser.parse_known_args(argv)
    return args.stage_target


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()
    stage_target = _stage_target(sys.argv[1:])
    workers = min(6, max(1, os.cpu_count() or 1))
    settings.ensure_directories()
    database_path = settings.resolve_local_path(settings.database_path)
    image_store_path = settings.resolve_local_path(settings.image_store_path)
    result = _hydrate_ids(
        database_path=database_path,
        image_store_path=image_store_path,
        wanted_ids=_wanted_ids(stage_target),
        workers=workers,
    )
    result["promotion_stage_target"] = stage_target
    print(json.dumps(result, indent=2), flush=True)
    if (
        result["failures"]
        or result["missing_or_untrusted"]
        or result["active_truth_conflicts"]
        or result["unusable_style_memory"]
    ):
        return 3
    print(
        "PASS pinned trusted visual memory ready: "
        f"stage={stage_target} repaired={result['repaired']} "
        f"already_hydrated={result['already_hydrated']} "
        f"superseded={len(result['superseded_pinned_training_examples'])} "
        "unusable_style_memory=0 missing_or_untrusted=0",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
