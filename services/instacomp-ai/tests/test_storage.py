from pathlib import Path

from app.models import CardIdentity, LearningState, LessonCreate
from app.storage import MemoryStore


def test_only_verified_states_are_trusted(tmp_path: Path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    store.save_scan(
        scan_id="scan-1",
        created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        front_sha256="a" * 64,
        back_sha256=None,
        image_pair_sha256="b" * 64,
        local_suggestion=None,
        checklist={"outcome": "not_configured"},
        status="needs_checklist",
    )
    identity = CardIdentity(
        sport="hockey",
        year="2024-25",
        brand="Upper Deck",
        set_name="Series 1",
        player="Example Player",
        card_number="201",
        parallel="Base",
    )

    teacher = store.create_lesson(
        LessonCreate(
            scan_id="scan-1",
            state=LearningState.TEACHER_SUGGESTED,
            identity=identity,
            verification_source="external teacher",
        )
    )
    assert teacher.trusted is False
    assert store.search(identity) == []

    confirmed = store.create_lesson(
        LessonCreate(
            scan_id="scan-1",
            state=LearningState.OPERATOR_CONFIRMED,
            identity=identity,
            verification_source="owner review",
            operator_id="owner",
        )
    )
    assert confirmed.trusted is True
    matches = store.search(identity)
    assert len(matches) == 1
    assert matches[0].score == 1.0
