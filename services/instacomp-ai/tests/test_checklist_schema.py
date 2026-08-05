from app.checklist_schema import ChecklistRow
from scripts.validate_checklist import audit


def row(**overrides):
    payload = {
        "source_name": "Example source",
        "source_release_id": "release-1",
        "source_version": "1",
        "source_receipt": "fixture",
        "sport": "hockey",
        "league": "NHL",
        "year": "2024-25",
        "manufacturer": "Upper Deck",
        "brand": "Upper Deck",
        "set_name": "Series 1",
        "subset": "Young Guns",
        "player": "Example Player",
        "team": "Example Team",
        "card_number": "201",
        "parallel": "Base",
        "variation": None,
        "serial_run": None,
        "rookie": True,
        "autograph": False,
        "memorabilia": False,
        "language_code": "en",
        "notes": None,
    }
    payload.update(overrides)
    return ChecklistRow.model_validate(payload)


def test_conflicting_receipts_block_import():
    report = audit([row(), row(source_receipt="different receipt")])
    assert report["ready_to_import"] is False
    assert len(report["conflicting_identity_groups"]) == 1


def test_unique_rows_are_importable():
    report = audit([row(), row(card_number="202", player="Other Player")])
    assert report["ready_to_import"] is True
    assert report["unique_identities"] == 2
