from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.models import CardIdentity, ChecklistOutcome, LearningState, LessonCreate
from app.storage import MemoryStore


def test_reset_scans_removes_only_selected_receipts_and_lessons(tmp_path: Path):
    database = tmp_path / "instacomp.sqlite3"
    image_store = tmp_path / "images"
    image_store.mkdir()
    preserved_image = image_store / "front.jpg"
    preserved_image.write_bytes(b"preserved-card-image")

    store = MemoryStore(database)
    store.initialize()

    for scan_id, player in [("scan-reset", "Wrong Identity"), ("scan-keep", "Keep Identity")]:
        store.save_scan(
            scan_id=scan_id,
            created_at=datetime.now(timezone.utc),
            front_sha256=f"front-{scan_id}",
            back_sha256=f"back-{scan_id}",
            image_pair_sha256=f"pair-{scan_id}",
            front_perceptual_hash="0" * 16,
            back_perceptual_hash="1" * 16,
            local_suggestion=None,
            checklist={"outcome": ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH.value},
            status="needs_review",
        )
        store.create_lesson(
            LessonCreate(
                scan_id=scan_id,
                state=LearningState.OPERATOR_CONFIRMED,
                identity=CardIdentity(
                    player=player,
                    year="2025",
                    set_name="Test Set",
                    card_number="1",
                ),
                verification_source="test",
                operator_id="test-owner",
            )
        )

    result = store.reset_scans(["scan-reset"])

    assert result == {
        "requested": 1,
        "deleted_scans": 1,
        "deleted_lessons": 1,
    }
    assert store.get_scan("scan-reset") is None
    assert store.get_scan("scan-keep") is not None
    assert preserved_image.read_bytes() == b"preserved-card-image"

    matches = store.search(CardIdentity(player="Keep Identity"))
    assert len(matches) == 1
    assert matches[0].identity.player == "Keep Identity"


def test_reset_scans_is_idempotent(tmp_path: Path):
    store = MemoryStore(tmp_path / "instacomp.sqlite3")
    store.initialize()

    first = store.reset_scans(["missing-scan", "missing-scan"])
    second = store.reset_scans([])

    assert first == {
        "requested": 1,
        "deleted_scans": 0,
        "deleted_lessons": 0,
    }
    assert second == {
        "requested": 0,
        "deleted_scans": 0,
        "deleted_lessons": 0,
    }
