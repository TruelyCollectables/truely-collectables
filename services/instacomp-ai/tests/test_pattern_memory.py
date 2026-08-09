import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    ColorEvidence,
    LearningState,
    LocalVisionEvidence,
    PatternEvidence,
    SerialTruth,
    SideVisionEvidence,
    TrainingExample,
)
from app.pattern_memory import find_trusted_pattern_style


def _vision(*, family_text: str, edge: float = 0.13, lines: int = 42, polygons: int = 56) -> LocalVisionEvidence:
    return LocalVisionEvidence(
        front=SideVisionEvidence(
            side="front",
            width=600,
            height=840,
            colors=ColorEvidence(
                dominant_colors=["silver", "white", "blue"],
                proportions={"silver": 0.38, "white": 0.24, "blue": 0.20},
                mean_saturation=0.31,
                mean_brightness=0.72,
                metallic_score=0.44,
            ),
            pattern=PatternEvidence(
                label="unknown",
                scores={"velocity": 0.31, "cracked_ice": 0.73, "checkerboard": 0.22, "sparkle": 0.48},
                geometry=["detected 56 irregular polygon candidates"],
                line_count=lines,
                polygon_count=polygons,
                edge_density=edge,
                dominant_angle=47.5,
                angle_concentration=0.28,
                angle_entropy=0.76,
            ),
        ),
        identity_hints=CardIdentity(manufacturer="Panini"),
        combined_text=family_text,
    )


def _example(
    *,
    scan_id: str,
    created_at: datetime,
    parallel: str,
    family_text: str,
    brand: str = "Panini Prizm WNBA",
    edge: float = 0.13,
    lines: int = 42,
    polygons: int = 56,
) -> TrainingExample:
    vision = _vision(family_text=family_text, edge=edge, lines=lines, polygons=polygons)
    return TrainingExample(
        training_example_id=f"te-{scan_id}-{parallel}",
        lesson_id=f"lesson-{scan_id}-{parallel}",
        scan_id=scan_id,
        state=LearningState.OPERATOR_CONFIRMED,
        trusted=True,
        created_at=created_at,
        verification_source="test",
        confirmed_identity=CardIdentity(
            manufacturer="Panini",
            brand=brand,
            set_name="Base",
            player="Teacher Card",
            card_number="1",
            parallel=parallel,
        ),
        local_vision=vision,
        checklist=ChecklistResult(outcome=ChecklistOutcome.INPUT_INCOMPLETE),
        front_sha256="a" * 64,
        image_pair_sha256="b" * 64,
        serial_truth=SerialTruth(visible_stamp_present=False),
    )


def _write_examples(path: Path, examples: list[TrainingExample]) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE training_examples (example_json TEXT NOT NULL, created_at TEXT NOT NULL)"
        )
        for example in examples:
            connection.execute(
                "INSERT INTO training_examples (example_json, created_at) VALUES (?, ?)",
                (example.model_dump_json(), example.created_at.isoformat()),
            )
        connection.commit()
    finally:
        connection.close()


def test_one_supervised_weird_style_can_seed_future_parallel_hint(tmp_path: Path) -> None:
    database = tmp_path / "training.sqlite3"
    now = datetime.now(timezone.utc)
    _write_examples(
        database,
        [
            _example(
                scan_id="SCAN-0180",
                created_at=now,
                parallel="White Seismic Prizm",
                family_text="2025 PANINI PRIZM WNBA",
            )
        ],
    )

    hint = find_trusted_pattern_style(
        database_path=database,
        current=_vision(family_text="2025 PANINI PRIZM WNBA"),
    )

    assert hint is not None
    assert hint.parallel == "White Seismic Prizm"
    assert hint.support_count == 1
    assert hint.score >= 0.94


def test_latest_operator_correction_wins_for_same_physical_scan(tmp_path: Path) -> None:
    database = tmp_path / "training.sqlite3"
    now = datetime.now(timezone.utc)
    _write_examples(
        database,
        [
            _example(
                scan_id="SCAN-0180",
                created_at=now - timedelta(minutes=2),
                parallel="Silver Prizm",
                family_text="2025 PANINI PRIZM WNBA",
            ),
            _example(
                scan_id="SCAN-0180",
                created_at=now,
                parallel="White Seismic Prizm",
                family_text="2025 PANINI PRIZM WNBA",
            ),
        ],
    )

    hint = find_trusted_pattern_style(
        database_path=database,
        current=_vision(family_text="2025 PANINI PRIZM WNBA"),
    )

    assert hint is not None
    assert hint.parallel == "White Seismic Prizm"
    assert "SCAN-0180" in hint.reference_scan_ids


def test_pattern_memory_never_crosses_known_product_family(tmp_path: Path) -> None:
    database = tmp_path / "training.sqlite3"
    now = datetime.now(timezone.utc)
    _write_examples(
        database,
        [
            _example(
                scan_id="SCAN-0180",
                created_at=now,
                parallel="White Seismic Prizm",
                family_text="2025 PANINI PRIZM WNBA",
            )
        ],
    )

    hint = find_trusted_pattern_style(
        database_path=database,
        current=_vision(family_text="2025 PANINI SELECT WNBA"),
    )

    assert hint is None
