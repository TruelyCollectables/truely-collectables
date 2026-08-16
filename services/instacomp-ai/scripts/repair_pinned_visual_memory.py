#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_ROOT = Path(__file__).resolve().parent
for candidate in (SERVICE_ROOT, SCRIPTS_ROOT):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

from app.config import settings
from app.models import LocalVisionEvidence, TrainingExample
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


def _load_required_candidates(
    database_path: Path,
    wanted_ids: Iterable[str],
) -> tuple[list[RepairCandidate], dict[str, Any]]:
    wanted = tuple(dict.fromkeys(str(value).strip() for value in wanted_ids if str(value).strip()))
    wanted_set = set(wanted)
    rows_by_id: dict[str, sqlite3.Row] = {}

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        if wanted:
            placeholders = ",".join("?" for _ in wanted)
            rows = connection.execute(
                "SELECT te.training_example_id, te.scan_id, te.example_json, "
                "s.local_vision_json AS scan_local_vision_json "
                "FROM training_examples te "
                "JOIN scans s ON s.scan_id = te.scan_id "
                f"WHERE te.trusted = 1 AND te.training_example_id IN ({placeholders})",
                wanted,
            ).fetchall()
            rows_by_id = {str(row["training_example_id"]): row for row in rows}
    finally:
        connection.close()

    candidates: list[RepairCandidate] = []
    already_hydrated: list[str] = []
    invalid_rows: list[dict[str, str]] = []

    for training_example_id in wanted:
        row = rows_by_id.get(training_example_id)
        if row is None:
            continue
        try:
            example = TrainingExample.model_validate(json.loads(row["example_json"]))
        except Exception as exc:
            invalid_rows.append(
                {
                    "training_example_id": training_example_id,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
            continue
        if example.local_vision is not None:
            already_hydrated.append(training_example_id)
            continue

        existing_scan_local_vision: dict[str, Any] | None = None
        raw_scan_local = row["scan_local_vision_json"]
        if raw_scan_local:
            try:
                parsed = json.loads(raw_scan_local)
                LocalVisionEvidence.model_validate(parsed)
                existing_scan_local_vision = parsed
            except Exception:
                existing_scan_local_vision = None

        candidates.append(
            RepairCandidate(
                training_example_id=example.training_example_id,
                scan_id=example.scan_id,
                front_sha256=example.front_sha256,
                back_sha256=example.back_sha256,
                verification_source=example.verification_source,
                existing_scan_local_vision=existing_scan_local_vision,
            )
        )

    return candidates, {
        "requested_training_example_ids": list(wanted),
        "requested": len(wanted),
        "found_trusted": len(rows_by_id),
        "missing_or_untrusted": [value for value in wanted if value not in rows_by_id],
        "already_hydrated_training_example_ids": already_hydrated,
        "already_hydrated": len(already_hydrated),
        "invalid_rows": invalid_rows,
    }


def _hydrate_ids(
    *,
    database_path: Path,
    image_store_path: Path,
    wanted_ids: Iterable[str],
    workers: int,
) -> dict[str, Any]:
    candidates, stats = _load_required_candidates(database_path, wanted_ids)
    repaired: list[str] = []
    failures: list[dict[str, str]] = list(stats["invalid_rows"])

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
        "schema_version": "tcos.instacomp-ai.pinned-visual-memory-repair.v1",
        "database": str(database_path),
        "image_store": str(image_store_path),
        **stats,
        "attempted": len(candidates),
        "repaired": len(repaired),
        "repaired_training_example_ids": sorted(repaired),
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


def _self_test() -> int:
    assert len(_wanted_ids(10)) == 8
    assert len(_wanted_ids(15)) == 15
    assert len(_wanted_ids(25)) == 20
    assert "19110d26-8d83-46b2-9871-1fccfe2ab45f" in _wanted_ids(15)  # Caitlin Clark #41
    assert "d6bcd174-3f84-49b8-8538-4d1f57263274" in _wanted_ids(15)  # DeWanna Bonner #32

    with tempfile.TemporaryDirectory(prefix="instacomp-pinned-visual-memory-") as temp:
        database_path = Path(temp) / "memory.sqlite3"
        image_store_path = Path(temp) / "images"
        image_store_path.mkdir(parents=True, exist_ok=True)
        training_id = "d6bcd174-3f84-49b8-8538-4d1f57263274"
        scan_id = "scan-dewanna"
        payload = {
            "training_example_id": training_id,
            "lesson_id": "lesson-dewanna",
            "scan_id": scan_id,
            "card_uuid": None,
            "state": "operator_confirmed",
            "trusted": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
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
                "parallel": "Silver",
            },
            "predicted_identity": None,
            "rejected_identity": None,
            "correction_fields": [],
            "local_suggestion": None,
            "local_vision": None,
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
            connection.execute(
                "INSERT INTO scans(scan_id, local_vision_json) VALUES (?, ?)",
                (scan_id, json.dumps(_fake_visual())),
            )
            connection.execute(
                "INSERT INTO training_examples(training_example_id, scan_id, trusted, example_json, created_at) "
                "VALUES (?, ?, 1, ?, ?)",
                (training_id, scan_id, json.dumps(payload), datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        finally:
            connection.close()

        result = _hydrate_ids(
            database_path=database_path,
            image_store_path=image_store_path,
            wanted_ids=[training_id],
            workers=1,
        )
        assert result["repaired"] == 1
        assert result["failures"] == []
        connection = sqlite3.connect(database_path)
        try:
            row = connection.execute(
                "SELECT example_json FROM training_examples WHERE training_example_id = ?",
                (training_id,),
            ).fetchone()
        finally:
            connection.close()
        assert row is not None
        repaired_payload = json.loads(row[0])
        assert repaired_payload["local_vision"]["opencv_available"] is True
        assert repaired_payload["confirmed_identity"]["parallel"] == "Silver"
        assert repaired_payload["verification_source"] == "legacy_reviewed_operator_confirmed"

    print("PASS pinned visual-memory repair includes Caitlin and DeWanna in Frozen 15")
    print("PASS pinned visual-memory repair hydrates trusted rows regardless verification-source label")
    print("PASS pinned visual-memory repair preserves confirmed identity and Registry truth")
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
    if result["failures"]:
        return 3
    print(
        "PASS pinned trusted visual memory ready: "
        f"stage={stage_target} repaired={result['repaired']} "
        f"already_hydrated={result['already_hydrated']} "
        f"missing_or_untrusted={len(result['missing_or_untrusted'])}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
