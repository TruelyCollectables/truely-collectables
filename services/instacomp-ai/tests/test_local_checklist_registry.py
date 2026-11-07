from pathlib import Path
import sqlite3

from app.local_checklist_registry import resolve_local_registry_exact
from app.models import CardIdentity, ChecklistOutcome


def make_registry(path: Path):
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE checklist_registry_entries (
          identity_id TEXT PRIMARY KEY,
          fingerprint_sha256 TEXT NOT NULL,
          source_sha256 TEXT NOT NULL,
          release_id TEXT NOT NULL,
          version_id TEXT NOT NULL,
          set_id TEXT NOT NULL,
          card_id TEXT NOT NULL,
          normalized_card_number TEXT NOT NULL,
          manufacturer TEXT, brand TEXT, product TEXT, player TEXT, year TEXT,
          set_name TEXT, card_number TEXT, parallel TEXT, variation TEXT,
          serial_run INTEGER, team TEXT, sport TEXT, league TEXT,
          language_code TEXT, configuration_exclusivity TEXT,
          is_auto INTEGER NOT NULL DEFAULT 0, is_relic INTEGER NOT NULL DEFAULT 0,
          source_label TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 100,
          matched_evidence_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
        );
        """
    )
    rows = [
        ("base10", "a" * 64, "10", "Base"),
        ("holo", "b" * 64, "LS-YG", "Holo Laser"),
        ("lava", "c" * 64, "LS-YG", "Lava"),
    ]
    for identity_id, fingerprint, card_number, parallel in rows:
        db.execute(
            """
            INSERT INTO checklist_registry_entries(
              identity_id,fingerprint_sha256,source_sha256,release_id,version_id,set_id,card_id,
              normalized_card_number,manufacturer,brand,product,player,year,set_name,card_number,
              parallel,team,sport,league,is_auto,is_relic,source_label,score,matched_evidence_json,active
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
            """,
            (
                identity_id, fingerprint, "d" * 64, "release", "version", "set", identity_id,
                "".join(ch for ch in card_number.lower() if ch.isalnum()),
                "Panini", "Donruss", "Donruss WNBA", "Yolanda Griffith", "2025",
                "Legendary Signatures", card_number, parallel, "Sacramento Monarchs", "Basketball",
                "WNBA", 1, 0, "test", 96, "{}",
            ),
        )
    db.commit()
    db.close()


def identity(parallel=None):
    return CardIdentity(
        year="2025",
        manufacturer="Panini",
        brand="Donruss",
        set_name="Legendary Signatures",
        player="Yolanda Griffith",
        card_number="LS-YG",
        parallel=parallel,
        autograph=True,
        memorabilia=False,
    )


def test_local_registry_prefers_physical_card_number_and_exact_parallel(tmp_path):
    path = tmp_path / "registry.sqlite3"
    make_registry(path)
    result, diagnostics = resolve_local_registry_exact(identity("Lava"), database_path=path)
    assert result is not None
    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert result.identity_id == "lava"
    assert result.identity.card_number == "LS-YG"
    assert result.identity.parallel == "Lava"
    assert diagnostics["status"] == "exact_match"


def test_local_registry_fails_closed_when_parallel_siblings_are_ambiguous(tmp_path):
    path = tmp_path / "registry.sqlite3"
    make_registry(path)
    result, diagnostics = resolve_local_registry_exact(identity(None), database_path=path)
    assert result is None
    assert diagnostics["status"] == "ambiguous"
    assert set(diagnostics["candidate_identity_ids"]) == {"holo", "lava"}


def test_local_registry_rejects_numeric_checklist_alias_for_physical_insert_number(tmp_path):
    path = tmp_path / "registry.sqlite3"
    make_registry(path)
    result, diagnostics = resolve_local_registry_exact(identity("Base"), database_path=path)
    assert result is None
    assert diagnostics["candidate_count"] == 2
    assert "base10" not in diagnostics["candidate_identity_ids"]
