#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.images import persisted_image_path
from app.local_vision import analyze_local_vision_sync
from app.models import LocalVisionEvidence, TrainingExample


@dataclass(frozen=True)
class RepairCandidate:
    training_example_id: str
    scan_id: str
    front_sha256: str
    back_sha256: str | None
    verification_source: str
    existing_scan_local_vision: dict[str, Any] | None


def _load_candidates(
    database_path: Path,
    *,
    source_contains: str | None,
    max_repairs: int,
) -> tuple[list[RepairCandidate], dict[str, int]]:
    stats = {
        "trusted_rows": 0,
        "already_hydrated": 0,
        "source_filtered": 0,
        "eligible_missing_visual_memory": 0,
    }
    candidates: list[RepairCandidate] = []
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT te.training_example_id, te.scan_id, te.example_json, "
            "s.local_vision_json AS scan_local_vision_json "
            "FROM training_examples te "
            "JOIN scans s ON s.scan_id = te.scan_id "
            "WHERE te.trusted = 1 "
            "ORDER BY te.created_at ASC"
        ).fetchall()
    finally:
        connection.close()

    needle = str(source_contains or "").strip().casefold()
    for row in rows:
        try:
            example = TrainingExample.model_validate(json.loads(row["example_json"]))
        except Exception:
            continue
        stats["trusted_rows"] += 1
        if example.local_vision is not None:
            stats["already_hydrated"] += 1
            continue
        if needle and needle not in str(example.verification_source or "").casefold():
            stats["source_filtered"] += 1
            continue

        scan_local_vision: dict[str, Any] | None = None
        raw_scan_local = row["scan_local_vision_json"]
        if raw_scan_local:
            try:
                parsed_scan_local = json.loads(raw_scan_local)
                LocalVisionEvidence.model_validate(parsed_scan_local)
                scan_local_vision = parsed_scan_local
            except Exception:
                scan_local_vision = None

        stats["eligible_missing_visual_memory"] += 1
        candidates.append(
            RepairCandidate(
                training_example_id=example.training_example_id,
                scan_id=example.scan_id,
                front_sha256=example.front_sha256,
                back_sha256=example.back_sha256,
                verification_source=example.verification_source,
                existing_scan_local_vision=scan_local_vision,
            )
        )
        if len(candidates) >= max_repairs:
            break
    return candidates, stats


def _analyze_candidate(
    candidate: RepairCandidate,
    *,
    image_store_path: Path,
) -> tuple[RepairCandidate, dict[str, Any]]:
    if candidate.existing_scan_local_vision is not None:
        return candidate, candidate.existing_scan_local_vision

    front_path = persisted_image_path(
        image_store_path,
        candidate.front_sha256,
        "front",
    )
    if not front_path.is_file():
        raise FileNotFoundError(
            f"{candidate.training_example_id}: archived front image missing: {front_path}"
        )
    back_content: bytes | None = None
    if candidate.back_sha256:
        back_path = persisted_image_path(
            image_store_path,
            candidate.back_sha256,
            "back",
        )
        if not back_path.is_file():
            raise FileNotFoundError(
                f"{candidate.training_example_id}: archived back image missing: {back_path}"
            )
        back_content = back_path.read_bytes()

    evidence = analyze_local_vision_sync(
        front_path.read_bytes(),
        back_content,
        settings,
    )
    if not evidence.opencv_available:
        raise RuntimeError(
            f"{candidate.training_example_id}: OpenCV produced no usable visual witness"
        )
    return candidate, evidence.model_dump(mode="json")


def _persist_local_vision(
    database_path: Path,
    *,
    training_example_id: str,
    scan_id: str,
    local_vision: dict[str, Any],
) -> None:
    validated = LocalVisionEvidence.model_validate(local_vision).model_dump(mode="json")
    serialized_vision = json.dumps(validated, separators=(",", ":"))
    connection = sqlite3.connect(database_path, timeout=30.0)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT example_json FROM training_examples "
            "WHERE training_example_id = ? AND scan_id = ? AND trusted = 1",
            (training_example_id, scan_id),
        ).fetchone()
        if row is None:
            raise RuntimeError(
                f"Trusted training row disappeared during repair: {training_example_id}"
            )
        payload = json.loads(row["example_json"])
        before_identity = json.dumps(
            payload.get("confirmed_identity"),
            sort_keys=True,
            separators=(",", ":"),
        )
        if payload.get("local_vision") is None:
            payload["local_vision"] = validated
            after_identity = json.dumps(
                payload.get("confirmed_identity"),
                sort_keys=True,
                separators=(",", ":"),
            )
            if after_identity != before_identity:
                raise RuntimeError(
                    f"Identity mutation detected during visual-memory repair: {training_example_id}"
                )
            connection.execute(
                "UPDATE training_examples SET example_json = ? "
                "WHERE training_example_id = ? AND trusted = 1",
                (
                    json.dumps(payload, separators=(",", ":")),
                    training_example_id,
                ),
            )
        connection.execute(
            "UPDATE scans SET local_vision_json = COALESCE(local_vision_json, ?) "
            "WHERE scan_id = ?",
            (serialized_vision, scan_id),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def repair_missing_visual_memory(
    *,
    database_path: Path,
    image_store_path: Path,
    source_contains: str | None,
    max_repairs: int,
    workers: int,
) -> dict[str, Any]:
    candidates, stats = _load_candidates(
        database_path,
        source_contains=source_contains,
        max_repairs=max_repairs,
    )
    repaired: list[str] = []
    failures: list[dict[str, str]] = []

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
                    resolved_candidate, local_vision = future.result()
                    _persist_local_vision(
                        database_path,
                        training_example_id=resolved_candidate.training_example_id,
                        scan_id=resolved_candidate.scan_id,
                        local_vision=local_vision,
                    )
                    repaired.append(resolved_candidate.training_example_id)
                    print(
                        "VISUAL MEMORY REPAIRED "
                        f"training={resolved_candidate.training_example_id} "
                        f"scan={resolved_candidate.scan_id}",
                        flush=True,
                    )
                except Exception as exc:
                    failures.append(
                        {
                            "training_example_id": candidate.training_example_id,
                            "scan_id": candidate.scan_id,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )
                    print(
                        "VISUAL MEMORY REPAIR SKIP "
                        f"training={candidate.training_example_id}: {type(exc).__name__}: {exc}",
                        file=sys.stderr,
                        flush=True,
                    )

    return {
        "schema_version": "tcos.instacomp-ai.trusted-visual-memory-repair.v1",
        "database": str(database_path),
        "image_store": str(image_store_path),
        "source_contains": source_contains,
        "max_repairs": max_repairs,
        "workers": workers,
        **stats,
        "attempted": len(candidates),
        "repaired": len(repaired),
        "repaired_training_example_ids": sorted(repaired),
        "failures": failures,
        "identity_fields_mutated": False,
        "registry_data_mutated": False,
        "images_mutated": False,
    }


def _self_test() -> int:
    from datetime import datetime, timezone

    with tempfile.TemporaryDirectory(prefix="instacomp-visual-memory-selftest-") as temp:
        db_path = Path(temp) / "memory.sqlite3"
        connection = sqlite3.connect(db_path)
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
            example_payload = {
                "training_example_id": "training-1",
                "lesson_id": "lesson-1",
                "scan_id": "scan-1",
                "card_uuid": None,
                "state": "operator_confirmed",
                "trusted": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "verification_source": "supervised_operator_confirmed",
                "operator_id": "tester",
                "notes": None,
                "confirmed_identity": {
                    "sport": "Basketball",
                    "year": "2025",
                    "manufacturer": "Panini",
                    "brand": "Select",
                    "set_name": "Concourse",
                    "player": "Test Player",
                    "card_number": "41",
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
            connection.execute(
                "INSERT INTO scans(scan_id, local_vision_json) VALUES (?, NULL)",
                ("scan-1",),
            )
            connection.execute(
                "INSERT INTO training_examples(training_example_id, scan_id, trusted, example_json, created_at) "
                "VALUES (?, ?, 1, ?, ?)",
                (
                    "training-1",
                    "scan-1",
                    json.dumps(example_payload),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            connection.commit()
        finally:
            connection.close()

        fake_visual = {
            "schema_version": "tcos.instacomp-ai.local-vision.v1",
            "front": {
                "side": "front",
                "width": 100,
                "height": 140,
                "ocr": [],
                "colors": {},
                "pattern": {
                    "label": "checkerboard",
                    "confidence": 0.9,
                    "scores": {"checkerboard": 0.9},
                    "geometry": ["detected 20 irregular polygon candidates"],
                    "line_count": 20,
                    "polygon_count": 20,
                    "edge_density": 0.1,
                    "angle_concentration": 0.5,
                    "angle_entropy": 0.8,
                },
                "errors": [],
            },
            "back": None,
            "serial": {"stamp_present": False},
            "identity_hints": {"manufacturer": "Panini"},
            "combined_text": "2025 PANINI SELECT BASKETBALL",
            "apple_vision_available": False,
            "opencv_available": True,
        }
        _persist_local_vision(
            db_path,
            training_example_id="training-1",
            scan_id="scan-1",
            local_vision=fake_visual,
        )
        connection = sqlite3.connect(db_path)
        connection.row_factory = sqlite3.Row
        try:
            row = connection.execute(
                "SELECT example_json FROM training_examples WHERE training_example_id='training-1'"
            ).fetchone()
            scan = connection.execute(
                "SELECT local_vision_json FROM scans WHERE scan_id='scan-1'"
            ).fetchone()
        finally:
            connection.close()
        assert row is not None and scan is not None
        payload = json.loads(row["example_json"])
        assert payload["confirmed_identity"]["parallel"] == "Silver"
        assert payload["confirmed_identity"]["card_number"] == "41"
        assert payload["local_vision"]["front"]["pattern"]["label"] == "checkerboard"
        assert json.loads(scan["local_vision_json"])["opencv_available"] is True
    print("PASS trusted visual-memory repair self-test: evidence hydrated without identity mutation")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Hydrate missing deterministic local-vision evidence for already-trusted "
            "training examples from their archived front/back images."
        )
    )
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--source-contains",
        default="operator_confirmed",
        help="Only repair trusted rows whose verification_source contains this text.",
    )
    parser.add_argument("--max-repairs", type=int, default=1000)
    parser.add_argument(
        "--workers",
        type=int,
        default=min(6, max(1, os.cpu_count() or 1)),
    )
    args = parser.parse_args()
    if args.self_test:
        return _self_test()
    if args.max_repairs < 1:
        raise SystemExit("--max-repairs must be >= 1")
    if args.workers < 1:
        raise SystemExit("--workers must be >= 1")

    settings.ensure_directories()
    database_path = settings.resolve_local_path(settings.database_path)
    image_store_path = settings.resolve_local_path(settings.image_store_path)
    result = repair_missing_visual_memory(
        database_path=database_path,
        image_store_path=image_store_path,
        source_contains=args.source_contains,
        max_repairs=args.max_repairs,
        workers=args.workers,
    )
    print(json.dumps(result, indent=2), flush=True)
    if result["failures"]:
        # A missing/invalid visual witness must never be silently treated as a
        # successful learning repair. Existing identities remain untouched.
        return 3
    print(
        "PASS trusted visual memory ready: "
        f"repaired={result['repaired']} already_hydrated={result['already_hydrated']} "
        "identity_mutations=0 registry_mutations=0",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
