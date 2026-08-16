from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from app.models import LocalVisionEvidence
from app.ollama import merge_local_vision_payload
from app.pattern_memory import apply_trusted_pattern_style


def _visual() -> LocalVisionEvidence:
    return LocalVisionEvidence.model_validate(
        {
            "schema_version": "tcos.instacomp-ai.local-vision.v1",
            "front": {
                "side": "front",
                "width": 100,
                "height": 140,
                "ocr": [],
                "colors": {
                    "dominant_colors": ["silver", "white"],
                    "proportions": {"silver": 0.55, "white": 0.45},
                    "metallic_score": 0.42,
                },
                "pattern": {
                    "label": "checkerboard",
                    "confidence": 0.91,
                    "scores": {"checkerboard": 0.91, "cracked_ice": 0.24},
                    "geometry": [
                        "detected 300 long line segments",
                        "directional diagonal line geometry",
                        "detected 137 irregular polygon candidates",
                        "non-directional multi-angle edge geometry",
                    ],
                    "line_count": 300,
                    "polygon_count": 137,
                    "edge_density": 0.12,
                    "dominant_angle": 45.0,
                    "angle_concentration": 0.55,
                    "angle_entropy": 0.83,
                },
                "errors": [],
            },
            "back": None,
            "serial": {"stamp_present": False},
            "identity_hints": {"manufacturer": "Panini"},
            "combined_text": "2025 PANINI - WNBA SELECT BASKETBALL PRIZM",
            "apple_vision_available": False,
            "opencv_available": True,
        }
    )


def _example(local_vision: LocalVisionEvidence) -> dict:
    return {
        "training_example_id": "trusted-silver-reference",
        "lesson_id": "lesson-silver-reference",
        "scan_id": "scan-silver-reference",
        "card_uuid": None,
        "state": "operator_confirmed",
        "trusted": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "verification_source": "supervised_203_operator_confirmed_2026-08-08",
        "operator_id": "truely-collectables-owner",
        "notes": None,
        "confirmed_identity": {
            "sport": "Basketball",
            "league": "WNBA",
            "year": "2025",
            "manufacturer": "Panini",
            "brand": "2025 Panini Select WNBA",
            "set_name": "2025 Panini Select WNBA - Concourse",
            "subset": "Concourse",
            "player": "Trusted Silver Reference",
            "team": None,
            "card_number": "99",
            "parallel": "Silver",
            "variation": None,
            "serial_number": None,
            "serial_run": None,
            "rookie": None,
            "autograph": None,
            "inscription": None,
            "inscription_text": None,
            "memorabilia": None,
            "memorabilia_type": None,
        },
        "predicted_identity": None,
        "rejected_identity": None,
        "correction_fields": [],
        "local_suggestion": None,
        "local_vision": local_vision.model_dump(mode="json"),
        "checklist": {
            "outcome": "input_incomplete",
            "identity_id": None,
            "identity": None,
            "candidate_count": 0,
            "reasons": [],
            "source_receipts": [],
        },
        "registry_identity_id": None,
        "registry_fingerprint_sha256": None,
        "front_sha256": "a" * 64,
        "back_sha256": "b" * 64,
        "image_pair_sha256": "c" * 64,
        "front_perceptual_hash": None,
        "back_perceptual_hash": None,
        "serial_truth": {
            "visible_stamp_present": False,
            "visible_exact_stamp": None,
            "visible_numerator": None,
            "visible_denominator": None,
            "checklist_print_run": None,
            "physical_copy_serial": None,
            "numerator_is_card_specific": True,
            "denominator_is_configuration_level": True,
        },
    }


def test_trusted_silver_visual_memory_overrides_base_guess(tmp_path):
    database_path = tmp_path / "instacomp.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            "CREATE TABLE training_examples ("
            "training_example_id TEXT PRIMARY KEY, example_json TEXT NOT NULL, created_at TEXT NOT NULL)"
        )
        visual = _visual()
        connection.execute(
            "INSERT INTO training_examples(training_example_id, example_json, created_at) VALUES (?, ?, ?)",
            (
                "trusted-silver-reference",
                json.dumps(_example(visual)),
                datetime.now(timezone.utc).isoformat(),
            ),
        )
        connection.commit()
    finally:
        connection.close()

    current = _visual()
    styled = apply_trusted_pattern_style(
        database_path=database_path,
        evidence=current,
    )
    assert styled.identity_hints.parallel == "Silver"
    assert styled.front.pattern.scores["trusted_style_memory"] >= 0.94
    assert any(
        "trusted style memory suggests Silver" in item
        for item in styled.front.pattern.geometry
    )

    merged = merge_local_vision_payload(
        {
            "identity": {
                "year": "2025",
                "manufacturer": "Panini",
                "brand": "2025 Panini Select WNBA",
                "set_name": "2025 Panini Select WNBA - Concourse",
                "player": "Caitlin Clark",
                "card_number": "41",
                "parallel": "Base",
            },
            "evidence": {},
        },
        styled,
    )
    assert merged["identity"]["parallel"] == "Silver"


def test_specific_non_base_model_parallel_is_not_overwritten_without_trusted_hint(tmp_path):
    database_path = tmp_path / "empty.sqlite3"
    connection = sqlite3.connect(database_path)
    try:
        connection.execute(
            "CREATE TABLE training_examples ("
            "training_example_id TEXT PRIMARY KEY, example_json TEXT NOT NULL, created_at TEXT NOT NULL)"
        )
        connection.commit()
    finally:
        connection.close()

    visual = apply_trusted_pattern_style(
        database_path=database_path,
        evidence=_visual(),
    )
    assert visual.identity_hints.parallel is None
    merged = merge_local_vision_payload(
        {"identity": {"parallel": "Gold"}, "evidence": {}},
        visual,
    )
    assert merged["identity"]["parallel"] == "Gold"
