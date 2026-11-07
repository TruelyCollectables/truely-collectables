from datetime import datetime, timedelta, timezone

from app.models import TrainingExample
from app.training import latest_training_examples


def _example(scan_id: str, when: datetime, *, trusted: bool, lesson_id: str) -> TrainingExample:
    return TrainingExample.model_construct(
        training_example_id=f"training-{lesson_id}",
        lesson_id=lesson_id,
        scan_id=scan_id,
        trusted=trusted,
        created_at=when,
    )


def test_latest_teacher_truth_supersedes_older_wrong_label() -> None:
    now = datetime.now(timezone.utc)
    old = _example("SCAN-0180", now - timedelta(minutes=5), trusted=True, lesson_id="silver")
    corrected = _example("SCAN-0180", now, trusted=True, lesson_id="white-seismic")

    latest = latest_training_examples([old, corrected])

    assert len(latest) == 1
    assert latest[0].lesson_id == "white-seismic"


def test_latest_untrusted_state_blocks_older_trusted_truth_from_export_pool() -> None:
    now = datetime.now(timezone.utc)
    old = _example("SCAN-0099", now - timedelta(minutes=5), trusted=True, lesson_id="old")
    rejected = _example("SCAN-0099", now, trusted=False, lesson_id="rejected")

    latest = latest_training_examples([old, rejected])
    trusted = [example for example in latest if example.trusted]

    assert len(latest) == 1
    assert latest[0].lesson_id == "rejected"
    assert trusted == []


def test_latest_truth_keeps_one_example_for_each_physical_scan() -> None:
    now = datetime.now(timezone.utc)
    examples = [
        _example("SCAN-0003", now - timedelta(minutes=2), trusted=True, lesson_id="blue-ice-wrong"),
        _example("SCAN-0003", now, trusted=True, lesson_id="blue-velocity-corrected"),
        _example("SCAN-0088", now - timedelta(minutes=1), trusted=True, lesson_id="holo"),
    ]

    latest = latest_training_examples(examples)

    assert {example.scan_id for example in latest} == {"SCAN-0003", "SCAN-0088"}
    assert next(example for example in latest if example.scan_id == "SCAN-0003").lesson_id == "blue-velocity-corrected"
