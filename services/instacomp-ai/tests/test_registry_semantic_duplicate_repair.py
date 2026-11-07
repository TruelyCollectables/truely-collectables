from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

from app.local_registry_store import LocalRegistryStore


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
          version_id TEXT NOT NULL DEFAULT '',
          set_id TEXT NOT NULL DEFAULT '',
          card_id TEXT NOT NULL DEFAULT '',
          normalized_card_number TEXT NOT NULL,
          manufacturer TEXT, brand TEXT, product TEXT,
          player TEXT, year TEXT, set_name TEXT, card_number TEXT,
          parallel TEXT, variation TEXT, serial_run INTEGER, team TEXT,
          sport TEXT, league TEXT, language_code TEXT,
          configuration_exclusivity TEXT, is_auto INTEGER NOT NULL DEFAULT 0,
          is_relic INTEGER NOT NULL DEFAULT 0, source_label TEXT NOT NULL,
          score INTEGER NOT NULL DEFAULT 100, matched_evidence_json TEXT NOT NULL DEFAULT '[]',
          active INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    return db


def add_row(db: sqlite3.Connection, *, identity: str, fingerprint: str, source: str) -> None:
    db.execute(
        """INSERT INTO checklist_registry_entries
        (identity_id,fingerprint_sha256,source_sha256,release_id,version_id,set_id,card_id,
         normalized_card_number,manufacturer,brand,product,player,year,set_name,card_number,
         parallel,variation,serial_run,team,sport,league,language_code,configuration_exclusivity,
         is_auto,is_relic,source_label,score,matched_evidence_json,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
        (
            identity, fingerprint, source, "release:2024-panini-prizm-wwe-wrestling",
            "v1", "set1", "card1", "1", "Panini", "Prizm", "Panini Prizm WWE",
            "Trick Williams", "2024", "Base Set", "1", "Green Prizms", None, None,
            "NXT", "Wrestling", "WWE", None, None, 0, 0,
            "InstaComp Mac Registry", 100, "[]",
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
        "SELECT identity_id,source_sha256,fingerprint_sha256 FROM checklist_registry_entries WHERE active=1"
    ).fetchall()
    assert [(row[0], row[1], row[2]) for row in active] == [("new", "newsha", "newfp")]

    try:
        add_row(db, identity="third", fingerprint="thirdfp", source="thirdsha")
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
    else:
        raise AssertionError("semantic unique guard accepted a second active copy")
    active = db.execute(
        "SELECT identity_id,source_sha256,fingerprint_sha256 FROM checklist_registry_entries WHERE active=1"
    ).fetchall()
    assert [(row[0], row[1], row[2]) for row in active] == [("new", "newsha", "newfp")]
    db.close()


def test_gap_supplement_is_not_collapsed_by_official_guard(tmp_path: Path):
    repair = load_repair_module()
    db = make_db(tmp_path / "registry.sqlite3")
    add_row(db, identity="official", fingerprint="officialfp", source="sha")
    db.execute(
        """INSERT INTO checklist_registry_entries
        (identity_id,fingerprint_sha256,source_sha256,release_id,version_id,set_id,card_id,
         normalized_card_number,manufacturer,brand,product,player,year,set_name,card_number,
         parallel,variation,serial_run,team,sport,league,language_code,configuration_exclusivity,
         is_auto,is_relic,source_label,score,matched_evidence_json,active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)""",
        (
            "supp", "suppfp", "suppsha", "release:2024-panini-prizm-wwe-wrestling",
            "v1", "set1", "card1", "1", "Panini", "Prizm", "Panini Prizm WWE",
            "Trick Williams", "2024", "Base Set", "1", "Green Prizms", None, None,
            "NXT", "Wrestling", "WWE", None, None, 0, 0,
            repair.SUPPLEMENT_LABEL, 96, "[]",
        ),
    )
    db.commit()
    audit = repair.audit_duplicates(db)
    assert audit["duplicate_rows"] == 0
    repair.install_semantic_guard(db)
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM checklist_registry_entries WHERE active=1").fetchone()[0] == 2
    db.close()


def test_registry_writer_refreshes_semantic_identity_without_duplicate(tmp_path: Path):
    store = LocalRegistryStore(tmp_path / "registry.sqlite3", tmp_path)
    store.initialize()
    base = {
        "identity_id": "first-id",
        "fingerprint_sha256": "first-fp",
        "source_sha256": "old-source",
        "release_id": "release:2024-panini-prizm-wwe-wrestling",
        "version_id": "v1",
        "set_id": "set1",
        "card_id": "card1",
        "normalized_card_number": "1",
        "manufacturer": "Panini",
        "brand": "Prizm",
        "product": "Panini Prizm WWE",
        "player": "Trick Williams",
        "year": "2024",
        "set_name": "Base Set",
        "card_number": "1",
        "parallel": "Green Prizms",
        "variation": None,
        "serial_run": None,
        "team": "NXT",
        "sport": "Wrestling",
        "league": "WWE",
        "language_code": None,
        "configuration_exclusivity": None,
        "is_auto": 0,
        "is_relic": 0,
        "source_label": "InstaComp Mac Registry",
        "score": 100,
        "matched_evidence_json": "[]",
        "active": 1,
    }
    with store.connection() as db:
        assert store.upsert_semantic_entry(db, dict(base)) == "inserted"
    changed = dict(base)
    changed.update(identity_id="second-id", fingerprint_sha256="second-fp", source_sha256="new-source", version_id="v2")
    with store.connection() as db:
        assert store.upsert_semantic_entry(db, changed) == "refreshed"
    with store.connection() as db:
        rows = db.execute("SELECT identity_id,fingerprint_sha256,source_sha256,version_id FROM checklist_registry_entries WHERE active=1").fetchall()
    assert len(rows) == 1
    assert rows[0]["identity_id"] == "first-id"
    assert rows[0]["fingerprint_sha256"] == "first-fp"
    assert rows[0]["source_sha256"] == "new-source"
    assert rows[0]["version_id"] == "v2"
