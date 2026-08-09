from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.main import _resolve_card_uuid
from app.models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LearningState,
    SerialTruth,
    TrainingExample,
)
from app.storage import MemoryStore
from app.training import latest_training_examples


def test_first_scan_uuid_becomes_permanent_card_uuid(monkeypatch):
    monkeypatch.setattr(
        "app.main.store.card_uuid_for_image_pair",
        lambda _image_pair_sha256: None,
    )
    first_scan = "2d6434e8-466c-4e70-b0e4-8cce5179f565"
    assert (
        _resolve_card_uuid(
            requested=None,
            image_pair_sha256="pair-a",
            first_scan_id=first_scan,
        )
        == first_scan
    )


def test_rescan_can_preserve_existing_card_uuid(monkeypatch):
    card_uuid = "4f0d2b11-e0a3-4aab-9a8f-c10921f3f96e"
    monkeypatch.setattr(
        "app.main.store.card_uuid_for_image_pair",
        lambda _image_pair_sha256: card_uuid,
    )
    assert (
        _resolve_card_uuid(
            requested=card_uuid,
            image_pair_sha256="pair-b",
            first_scan_id="05450ec1-d570-44b4-94c2-9ce57f36e222",
        )
        == card_uuid
    )


def test_exact_image_pair_refuses_conflicting_physical_card_uuid(monkeypatch):
    monkeypatch.setattr(
        "app.main.store.card_uuid_for_image_pair",
        lambda _image_pair_sha256: "4f0d2b11-e0a3-4aab-9a8f-c10921f3f96e",
    )
    with pytest.raises(HTTPException) as raised:
        _resolve_card_uuid(
            requested="0fd8da16-3d62-4e9a-a32d-32ba31a2ba0f",
            image_pair_sha256="pair-c",
            first_scan_id="e33a6809-3789-4c75-82b5-cb4fe9f77b75",
        )
    assert raised.value.status_code == 409


def test_sqlite_scan_archive_persists_card_uuid(tmp_path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    card_uuid = "4f0d2b11-e0a3-4aab-9a8f-c10921f3f96e"
    store.save_scan(
        scan_id="05450ec1-d570-44b4-94c2-9ce57f36e222",
        card_uuid=card_uuid,
        created_at=datetime.now(timezone.utc),
        front_sha256="f" * 64,
        back_sha256="b" * 64,
        image_pair_sha256="p" * 64,
        local_suggestion=None,
        local_vision=None,
        checklist={
            "outcome": "input_incomplete",
            "candidate_count": 0,
            "reasons": [],
            "source_receipts": [],
        },
        status="needs_review",
    )
    archive = store.get_scan("05450ec1-d570-44b4-94c2-9ce57f36e222")
    assert archive is not None
    assert archive["card_uuid"] == card_uuid
    assert store.card_uuid_for_image_pair("p" * 64) == card_uuid


def _example(*, scan_id: str, card_uuid: str, created_at: datetime) -> TrainingExample:
    return TrainingExample(
        training_example_id=f"te-{scan_id}",
        lesson_id=f"lesson-{scan_id}",
        scan_id=scan_id,
        card_uuid=card_uuid,
        state=LearningState.OPERATOR_CONFIRMED,
        trusted=True,
        created_at=created_at,
        verification_source="test",
        confirmed_identity=CardIdentity(player="Player", card_number="1"),
        checklist=ChecklistResult(
            outcome=ChecklistOutcome.INPUT_INCOMPLETE,
            candidate_count=0,
            reasons=[],
            source_receipts=[],
        ),
        front_sha256="f" * 64,
        image_pair_sha256=f"pair-{scan_id}",
        serial_truth=SerialTruth(visible_stamp_present=False),
    )


def test_latest_teacher_truth_deduplicates_across_rescans_by_card_uuid():
    card_uuid = "4f0d2b11-e0a3-4aab-9a8f-c10921f3f96e"
    now = datetime.now(timezone.utc)
    older = _example(scan_id="scan-old", card_uuid=card_uuid, created_at=now - timedelta(minutes=1))
    newer = _example(scan_id="scan-new", card_uuid=card_uuid, created_at=now)
    assert latest_training_examples([older, newer]) == [newer]


def _insert_legacy_scan(
    store: MemoryStore,
    *,
    scan_id: str,
    image_pair_sha256: str,
    card_uuid: str | None,
) -> None:
    with store.connection() as db:
        db.execute(
            """
            INSERT INTO scans (
                scan_id, card_uuid, created_at, front_sha256, back_sha256,
                image_pair_sha256, checklist_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                scan_id,
                card_uuid,
                datetime.now(timezone.utc).isoformat(),
                f"front-{scan_id}",
                f"back-{scan_id}",
                image_pair_sha256,
                '{"outcome":"input_incomplete","candidate_count":0,"reasons":[],"source_receipts":[]}',
                "needs_review",
            ),
        )


def test_initialize_repairs_legacy_non_uuid_card_ids_stably(tmp_path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    _insert_legacy_scan(
        store,
        scan_id="SCAN-0001",
        image_pair_sha256="legacy-pair-shared",
        card_uuid=None,
    )
    _insert_legacy_scan(
        store,
        scan_id="SCAN-0002",
        image_pair_sha256="legacy-pair-shared",
        card_uuid="SCAN-0002",
    )
    _insert_legacy_scan(
        store,
        scan_id="SCAN-0003",
        image_pair_sha256="legacy-pair-distinct",
        card_uuid="SCAN-0003",
    )

    store.initialize()
    first = store.get_scan("SCAN-0001")
    second = store.get_scan("SCAN-0002")
    third = store.get_scan("SCAN-0003")
    assert first and second and third
    UUID(first["card_uuid"])
    UUID(second["card_uuid"])
    UUID(third["card_uuid"])
    assert first["card_uuid"] == second["card_uuid"]
    assert first["card_uuid"] != third["card_uuid"]

    stable = first["card_uuid"]
    store.initialize()
    assert store.get_scan("SCAN-0001")["card_uuid"] == stable
    assert store.card_uuid_for_image_pair("legacy-pair-shared") == stable


def test_save_scan_generates_real_uuid_for_legacy_logical_scan_id(tmp_path):
    store = MemoryStore(tmp_path / "memory.sqlite3")
    store.initialize()
    store.save_scan(
        scan_id="SCAN-0101",
        created_at=datetime.now(timezone.utc),
        front_sha256="f" * 64,
        back_sha256="b" * 64,
        image_pair_sha256="legacy-save-pair",
        local_suggestion=None,
        local_vision=None,
        checklist={
            "outcome": "input_incomplete",
            "candidate_count": 0,
            "reasons": [],
            "source_receipts": [],
        },
        status="needs_review",
    )
    archive = store.get_scan("SCAN-0101")
    assert archive is not None
    UUID(archive["card_uuid"])
    assert archive["card_uuid"] != "SCAN-0101"
