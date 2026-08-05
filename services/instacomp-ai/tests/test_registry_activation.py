import asyncio
import csv
from pathlib import Path

from app.checklist_schema import CHECKLIST_COLUMNS
from app.models import CardIdentity, ChecklistOutcome
from app.registry import RegistryBuilder, SQLiteChecklistRegistry


def _write_valid_csv(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "source_name": "Upper Deck official checklist",
        "source_release_id": "2025-26-ud-series-1",
        "source_version": "1",
        "source_receipt": "sha256:test-receipt",
        "sport": "Hockey",
        "league": "NHL",
        "year": "2025-26",
        "manufacturer": "Upper Deck",
        "brand": "Upper Deck",
        "set_name": "Series 1",
        "subset": "",
        "player": "Example Player",
        "team": "Example Team",
        "card_number": "201",
        "parallel": "Base",
        "variation": "",
        "serial_run": "",
        "rookie": "true",
        "autograph": "false",
        "memorabilia": "false",
        "language_code": "en",
        "notes": "test row",
    }
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CHECKLIST_COLUMNS)
        writer.writeheader()
        writer.writerow(row)


def _identity() -> CardIdentity:
    return CardIdentity(
        year="2025-26",
        set_name="Series 1",
        player="Example Player",
        card_number="201",
        parallel="Base",
    )


def test_clean_candidate_activates_and_survives_temporary_build_folder(tmp_path: Path):
    mirror = tmp_path / "mirror"
    registry_path = tmp_path / "registry" / "checklist-registry.sqlite3"
    quarantine = tmp_path / "quarantine"
    _write_valid_csv(mirror / "valid.csv")

    receipt = RegistryBuilder(mirror, registry_path, quarantine).build()

    assert receipt["activated"] is True
    assert receipt["ready"] is True
    assert receipt["active_rows"] == 1
    assert registry_path.exists()
    assert not registry_path.with_name(registry_path.name + "-wal").exists()

    result = asyncio.run(SQLiteChecklistRegistry(registry_path).match(_identity()))
    assert result.outcome == ChecklistOutcome.EXACT_MATCH
    assert result.identity is not None
    assert result.identity.player == "Example Player"


def test_invalid_candidate_is_quarantined_and_previous_registry_is_retained(
    tmp_path: Path,
):
    mirror = tmp_path / "mirror"
    registry_path = tmp_path / "registry" / "checklist-registry.sqlite3"
    quarantine = tmp_path / "quarantine"
    _write_valid_csv(mirror / "valid.csv")
    builder = RegistryBuilder(mirror, registry_path, quarantine)
    first = builder.build()
    assert first["activated"] is True

    (mirror / "broken.json").write_text(
        '{"rows":[{"source_name":"missing required fields"}]}',
        encoding="utf-8",
    )
    second = builder.build()

    assert second["activated"] is False
    assert second["previous_registry_retained"] is True
    assert second["ready"] is True
    assert second["active_rows"] == 1
    assert len(second["rejected_files"]) == 1
    rejected = second["rejected_files"][0]
    assert Path(rejected["quarantine_file"]).exists()
    assert Path(rejected["quarantine_receipt"]).exists()

    result = asyncio.run(SQLiteChecklistRegistry(registry_path).match(_identity()))
    assert result.outcome == ChecklistOutcome.EXACT_MATCH
