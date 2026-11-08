from __future__ import annotations

import sqlite3

from app.storage import MemoryStore


def test_initialize_migrates_legacy_scan_table_before_creating_phash_index(tmp_path):
    database_path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(database_path)
    connection.executescript(
        """
        CREATE TABLE scans (
            scan_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            front_sha256 TEXT NOT NULL,
            back_sha256 TEXT,
            image_pair_sha256 TEXT NOT NULL,
            local_suggestion_json TEXT,
            checklist_json TEXT NOT NULL,
            status TEXT NOT NULL
        );
        """
    )
    connection.close()

    MemoryStore(database_path).initialize()

    connection = sqlite3.connect(database_path)
    columns = {
        row[1]
        for row in connection.execute("PRAGMA table_info(scans)").fetchall()
    }
    indexes = {
        row[1]
        for row in connection.execute("PRAGMA index_list(scans)").fetchall()
    }
    connection.close()

    assert {
        "front_reference_sha256",
        "back_reference_sha256",
        "front_perceptual_hash",
        "back_perceptual_hash",
    }.issubset(columns)
    assert "scans_front_phash_idx" in indexes
