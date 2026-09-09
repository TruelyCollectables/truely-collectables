from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

import pytest


def load_repair_module():
    path = Path(__file__).resolve().parents[1] / "scripts" / "repair_registry_semantic_duplicates.py"
    spec = importlib.util.spec_from_file_location("registry_semantic_repair", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_db(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE checklist_registry_imports (
          source_sha256 TEXT PRIMARY KEY, imported_at TEXT
        );
        CREATE TABLE checklist_registry_entries (
          identity_id TEXT PRIMARY KEY,
          fingerprint_sha256 TEXT NOT NULL UNIQUE,
          source_sha256 TEXT NOT NULL,
          release_id TEXT NOT NULL,
          normalized_card_number TEXT NOT NULL,
          player TEXT, set_name TEXT, parallel TEXT, variation TEXT,
          serial_run INTEGER, is_auto INTEGER NOT NULL DEFAULT 0,
          is_relic INTEGER NOT NULL DEFAULT 0, language_code TEXT,
          configuration_exclusivity TEXT, source_label TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    return db


def add_row(db: sqlite3.Connection, *, identity: str, fingerprint: str, source: str) -> None:
    db.execute(
        """INSERT INTO checklist_registry_entries
        (identity_id,fingerprint_sha256,source_sha256,release_id,normalized_card_number,
         player,set_name,parallel,variation,serial_run,is_auto,is_relic,
         language_code,configuration_exclusivity,source_label,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
        (
            identity, fingerprint, source, "release:2024-panini-prizm-wwe-wrestling",
            "1", "Trick Williams", "Base Set", "Green Prizms", None, None,
            0, 0, None, None, "InstaComp Mac Registry",
        ),
    )


def test_semantic_repair_keeps_newest_source_and_installs_guard(tmp_path: Path):
    repair = load_repair_module()
    db = make_db(tmp_path / "registry.sqlite3")
    db.executemany(
        "INSERT INTO checklist_registry_imports (source_sha256, imported_at) VALUES (?,?)",
        [("oldsha", "2026-09-08T19:06:06+00:00"), ("newsha", "2026-09-09T17:10:12+00:00")],
    )
    add_row(db, identity="old", fingerprint="oldfp", source="oldsha")
    add_row(db, identity="new", fingerprint="newfp", source="newsha")
    db.commit()

    audit = repair.audit_duplicates(db)
    assert audit["duplicate_groups"] == 1
    assert audit["duplicate_rows"] == 1
    assert audit["deactivate_identity_ids"] == ["old"]

    result = repair.apply_repair(db, audit)
    assert result["post_duplicate_groups"] == 0
    active = db.execute(
        "SELECT identity_id FROM checklist_registry_entries WHERE active=1"
    ).fetchall()
    assert [row[0] for row in active] == ["new"]

    with pytest.raises(sqlite3.IntegrityError):
        add_row(db, identity="third", fingerprint="thirdfp", source="newsha")
    db.rollback()
    db.close()


def test_gap_supplement_is_not_collapsed_by_official_unique_guard(tmp_path: Path):
    repair = load_repair_module()
    db = make_db(tmp_path / "registry.sqlite3")
    add_row(db, identity="official", fingerprint="officialfp", source="sha")
    db.execute(
        """INSERT INTO checklist_registry_entries
        (identity_id,fingerprint_sha256,source_sha256,release_id,normalized_card_number,
         player,set_name,parallel,variation,serial_run,is_auto,is_relic,
         language_code,configuration_exclusivity,source_label,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
        (
            "supp", "suppfp", "suppsha", "release:2024-panini-prizm-wwe-wrestling",
            "1", "Trick Williams", "Base Set", "Green Prizms", None, None,
            0, 0, None, None, repair.SUPPLEMENT_LABEL,
        ),
    )
    db.commit()
    audit = repair.audit_duplicates(db)
    assert audit["duplicate_rows"] == 0
    repair.install_unique_guard(db)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM checklist_registry_entries WHERE active=1").fetchone()[0] == 2
    db.close()
