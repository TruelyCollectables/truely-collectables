from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.images import persisted_image_path
from app.storage import MemoryStore


def test_persisted_image_path_matches_scan_archive_layout(tmp_path: Path) -> None:
    digest = "a" * 64
    expected = tmp_path / "aa" / "aa" / f"{digest}-back.jpg"
    assert persisted_image_path(tmp_path, digest, "back") == expected


def test_persisted_image_path_rejects_untrusted_values(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Invalid archived image hash"):
        persisted_image_path(tmp_path, "../../secret", "front")
    with pytest.raises(ValueError, match="front or back"):
        persisted_image_path(tmp_path, "b" * 64, "sideways")


def test_scan_archive_round_trip_preserves_front_and_back_hashes(
    tmp_path: Path,
) -> None:
    store = MemoryStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    store.save_scan(
        scan_id="scan-recovery-test",
        created_at=datetime(2026, 8, 5, 15, 30, tzinfo=timezone.utc),
        front_sha256="c" * 64,
        back_sha256="d" * 64,
        image_pair_sha256="e" * 64,
        local_suggestion={"provider": "test"},
        checklist={"outcome": "exact_match"},
        status="trusted_memory_match",
    )

    archive = store.get_scan("scan-recovery-test")
    assert archive is not None
    assert archive["front_sha256"] == "c" * 64
    assert archive["back_sha256"] == "d" * 64
    assert archive["image_pair_sha256"] == "e" * 64
    assert archive["local_suggestion"] == {"provider": "test"}
    assert archive["checklist"] == {"outcome": "exact_match"}


def test_unknown_scan_archive_returns_none(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "instacomp.sqlite3")
    store.initialize()
    assert store.get_scan("missing-scan") is None
