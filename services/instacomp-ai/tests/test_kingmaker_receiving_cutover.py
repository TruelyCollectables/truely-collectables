from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from app.kingmaker_accounting import KingmakerAccounting


def scan_identity(parallel: str = "Silver Prizm") -> dict[str, object]:
    return {
        "player": "Sonia Citron",
        "year": "2025",
        "brand": "Panini",
        "set_name": "Panini Prizm WNBA",
        "card_number": "148",
        "parallel": parallel,
        "variation": "Rookie Variation",
        "serial_number": None,
        "autograph": False,
        "memorabilia": False,
    }


def create_scan_db(
    path: Path,
    *,
    exact: bool = True,
    registry_identity: dict[str, object] | None = None,
    local_serial: dict[str, object] | None = None,
) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE scans(scan_id TEXT PRIMARY KEY,card_uuid TEXT,created_at TEXT,"
            "front_sha256 TEXT,back_sha256 TEXT,image_pair_sha256 TEXT,status TEXT,"
            "checklist_json TEXT,local_vision_json TEXT)"
        )
        checklist = (
            {"outcome": "exact_match", "identity_id": "registry-sonia-148-silver", "identity": registry_identity if registry_identity is not None else scan_identity()}
            if exact
            else {"outcome": "input_incomplete", "identity_id": None, "identity": None}
        )
        local_vision = {"serial": local_serial or {}}
        db.execute(
            "INSERT INTO scans VALUES(?,?,?,?,?,?,?,?,?)",
            (
                "scan-1", "card-1", "2026-09-17T10:00:00Z",
                "front", "back", "pair", "trusted_memory_match",
                json.dumps(checklist), json.dumps(local_vision),
            ),
        )


def purchase(parallel: str = "Silver Prizm") -> dict[str, object]:
    return {
        "purchase_id": "order-1",
        "source_key": "mercari:m45183422692:unit:1",
        "source": "Mercari",
        "purchased_at": "2026-09-16T12:00:00-06:00",
        "title": "2025 Panini Prizm WNBA Sonia Citron #148 Rookie Variation Silver Prizm Base RC",
        "allocated_cost": 4.21,
        "identity_status": "source_exact",
        "identity": {
            "player": "Sonia Citron",
            "year": "2025",
            "brand": "Panini",
            "setName": "Panini Prizm WNBA",
            "cardNumber": "148",
            "parallel": parallel,
            "variation": "Rookie Variation",
            "isAuto": False,
            "isRelic": False,
            "conditionType": "raw",
        },
    }


def test_cutover_intake_is_idempotent_and_final_receipt_survives_resync(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    first = ledger.record_acquisition_item(purchase())
    second = ledger.record_acquisition_item(purchase())
    assert first["created"] is True
    assert second["created"] is False
    assert len(ledger.pending_purchases()) == 1

    matched = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert matched["status"] == "received"
    assert matched["receiptMode"] == "received_new"
    received = ledger.receive_into_inventory(
        "card-1", "inventory-1", matched["match"]["acquisitionItemId"], "scan-1", "resale"
    )
    assert received["status"] == "received"

    ledger.record_acquisition_item(purchase())
    rows = ledger.pending_purchases()
    assert len(rows) == 1
    assert rows[0]["status"] == "received"
    assert rows[0]["allocatedCost"] == 4.21


def test_parallel_mismatch_never_reserves(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase("Green Prizm"))
    result = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert result["status"] == "possible_match"
    assert "parallel_mismatch" in result["reason"]


def test_non_exact_registry_scan_cannot_receive(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db, exact=False)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())
    result = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert result["status"] == "scan_required"
    assert "exact Checklist Registry identity" in result["reason"]


def test_vague_multi_card_marketplace_title_stays_awaiting_scan(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    row = purchase()
    row["identity_status"] = "needs_scan_verification"
    row["title"] = "2 Sonia Citron RC"
    row["identity"] = {}
    ledger.record_acquisition_item(row)
    result = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert result["status"] in {"no_match", "possible_match"}
    assert result["status"] != "pending_purchase"
    assert ledger.pending_purchases()[0]["awaitingOwnScan"] is True


def test_verified_scan_is_the_receipt_and_is_immediately_listing_ready(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())
    matched = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert matched["status"] == "received"
    assert matched["inventoryState"] == "resale_ready"
    assert matched["receiptMode"] == "received_new"

    readiness = ledger.listing_readiness(["inventory-1"])
    assert readiness["ready"] is True
    assert readiness["blocked"] == []
    assert ledger.pending_purchases()[0]["status"] == "received"


def test_missing_material_auto_or_relic_state_cannot_exact_match(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    registry_identity = scan_identity()
    registry_identity.pop("autograph")
    create_scan_db(scan_db, registry_identity=registry_identity)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())

    result = ledger.match_or_reserve_purchase(registry_identity, "card-1", "inventory-1", "scan-1")
    assert result["status"] != "pending_purchase"
    assert "autograph_state_unproven" in result["reason"]


def test_legacy_scan_schema_fails_closed_without_raw_sqlite_error(tmp_path: Path) -> None:
    scan_db = tmp_path / "legacy-scan.sqlite3"
    with sqlite3.connect(scan_db) as db:
        db.execute(
            "CREATE TABLE scans(scan_id TEXT PRIMARY KEY,card_uuid TEXT,created_at TEXT,"
            "front_sha256 TEXT,back_sha256 TEXT,image_pair_sha256 TEXT,status TEXT)"
        )
        db.execute(
            "INSERT INTO scans VALUES(?,?,?,?,?,?,?)",
            ("legacy-scan", "card-legacy", "2026-09-17T10:00:00Z", "front", "back", "pair", "complete"),
        )
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())
    result = ledger.match_or_reserve_purchase(
        scan_identity(), "card-legacy", "inventory-legacy", "legacy-scan"
    )
    assert result["status"] == "scan_required"
    assert "schema lacks required Registry verification fields" in result["reason"]
    assert "checklist_json" in result["reason"]


def test_exact_checklist_scan_still_needing_review_cannot_receive(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    with sqlite3.connect(scan_db) as db:
        db.execute("UPDATE scans SET status='needs_review' WHERE scan_id='scan-1'")
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())
    result = ledger.match_or_reserve_purchase(scan_identity(), "card-1", "inventory-1", "scan-1")
    assert result["status"] == "scan_required"
    assert "requires identity review" in result["reason"]


def test_user_verified_manual_purchase_exact_registry_scan_can_receive_into_review_hold(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    with sqlite3.connect(scan_db) as db:
        db.execute("UPDATE scans SET status='needs_review' WHERE scan_id='scan-1'")
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    row = purchase()
    row["registry_identity_id"] = "registry-sonia-148-silver"
    recorded = ledger.record_acquisition_item(row)
    with ledger._connect() as db:
        db.execute(
            "UPDATE acquisition_items SET manual_entry=1,verification_status='user_verified_with_evidence',registry_identity_id=? WHERE id=?",
            ("registry-sonia-148-silver", int(recorded["item"]["acquisitionItemId"])),
        )
    result = ledger.match_or_reserve_purchase(
        scan_identity(), "card-1", "inventory-1", "scan-1"
    )
    assert result["status"] == "received"
    assert result["inventoryState"] == "received_review"
    readiness = ledger.listing_readiness(["inventory-1"])
    assert readiness["ready"] is False
    assert readiness["blocked"][0]["reason"] == "scan_review_required_before_listing"


def test_unverified_exact_registry_scan_still_needing_review_cannot_receive(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    with sqlite3.connect(scan_db) as db:
        db.execute("UPDATE scans SET status='needs_review' WHERE scan_id='scan-1'")
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    ledger.record_acquisition_item(purchase())
    result = ledger.match_or_reserve_purchase(
        scan_identity(), "card-1", "inventory-1", "scan-1"
    )
    assert result["status"] == "scan_required"
    assert "requires identity review" in result["reason"]


def test_user_verified_manual_purchase_before_cutover_can_still_receive(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    with sqlite3.connect(scan_db) as db:
        db.execute("UPDATE scans SET status='needs_review' WHERE scan_id='scan-1'")
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    row = purchase()
    row["purchased_at"] = "2026-09-13T17:32:00-06:00"
    row["registry_identity_id"] = "registry-sonia-148-silver"
    recorded = ledger.record_acquisition_item(row)
    with ledger._connect() as db:
        db.execute(
            "UPDATE acquisition_items SET manual_entry=1,verification_status='user_verified_with_evidence',registry_identity_id=? WHERE id=?",
            ("registry-sonia-148-silver", int(recorded["item"]["acquisitionItemId"])),
        )
    result = ledger.match_or_reserve_purchase(
        scan_identity(), "card-1", "inventory-1", "scan-1"
    )
    assert result["status"] == "received"
    assert result["inventoryState"] == "received_review"

def test_receiving_rejects_unnumbered_exact_lock_when_serial_stamp_is_suspected(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(
        scan_db,
        local_serial={
            "stamp_present": False,
            "suspected_stamp": True,
            "suspected_runs": [25, 125],
        },
    )
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    with pytest.raises(ValueError, match="unresolved serial-stamp evidence"):
        ledger._verified_scan("scan-1")


def test_receiving_rejects_numbered_registry_identity_without_physical_serial(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    numbered = scan_identity("Tie-Dye")
    numbered["serial_number"] = "06/25"
    numbered["serial_run"] = 25
    create_scan_db(scan_db, registry_identity=numbered)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    with pytest.raises(ValueError, match="physically verified serial stamp"):
        ledger._verified_scan("scan-1")


def test_receiving_accepts_numbered_registry_identity_with_physical_serial(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    numbered = scan_identity("Tie-Dye")
    numbered["serial_number"] = "06/25"
    numbered["serial_run"] = 25
    create_scan_db(
        scan_db,
        registry_identity=numbered,
        local_serial={
            "stamp_present": True,
            "suspected_stamp": True,
            "suspected_runs": [25],
            "exact_stamp": "06/25",
            "numerator": 6,
            "visible_denominator": 25,
        },
    )
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    verified = ledger._verified_scan("scan-1")
    assert verified["registryIdentity"]["serial_number"] == "06/25"
    assert verified["registryIdentity"]["serial_run"] == 25

def test_receiving_persists_manual_card_inventory_binding_when_manual_table_exists(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    recorded = ledger.record_acquisition_item(purchase())
    acquisition_id = int(recorded["item"]["acquisitionItemId"])
    with ledger._connect() as db:
        db.execute(
            "CREATE TABLE manual_purchase_cards("
            "id TEXT PRIMARY KEY,acquisition_item_id INTEGER,inventory_item_id TEXT,updated_at TEXT)"
        )
        db.execute(
            "INSERT INTO manual_purchase_cards(id,acquisition_item_id,inventory_item_id,updated_at) "
            "VALUES(?,?,NULL,NULL)",
            ("manual-card-1", acquisition_id),
        )
    result = ledger.match_or_reserve_purchase(
        scan_identity(), "card-1", "inventory-1", "scan-1"
    )
    assert result["status"] == "received"
    with ledger._connect() as db:
        row = db.execute(
            "SELECT inventory_item_id FROM manual_purchase_cards WHERE id='manual-card-1'"
        ).fetchone()
    assert row is not None
    assert row["inventory_item_id"] == "inventory-1"


def _install_operator_correction(
    scan_db: Path,
    *,
    with_corroborating_scan: bool,
) -> None:
    corrected = scan_identity("Tie-Dye")
    corrected["serial_number"] = "06/25"
    corrected["serial_run"] = 25
    with sqlite3.connect(scan_db) as db:
        db.execute(
            "CREATE TABLE lessons("
            "lesson_id TEXT PRIMARY KEY,scan_id TEXT,state TEXT,identity_json TEXT,"
            "verification_source TEXT,trusted INTEGER,created_at TEXT)"
        )
        db.execute(
            "INSERT INTO lessons VALUES(?,?,?,?,?,?,?)",
            (
                "operator-lesson-1",
                "scan-1",
                "operator_confirmed",
                json.dumps(corrected),
                "operator_correction",
                1,
                "2026-09-19T03:54:57Z",
            ),
        )
        if with_corroborating_scan:
            checklist = {
                "outcome": "exact_match",
                "identity_id": "registry-sonia-148-tie-dye",
                "identity": corrected,
                "source_receipts": ["registry_fingerprint:" + "a" * 64],
            }
            local_vision = {
                "serial": {
                    "stamp_present": True,
                    "suspected_stamp": True,
                    "suspected_runs": [25],
                    "exact_stamp": "06/25",
                    "numerator": 6,
                    "visible_denominator": 25,
                }
            }
            db.execute(
                "INSERT INTO scans VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    "scan-2",
                    "card-1",
                    "2026-09-19T05:21:47Z",
                    "front",
                    "back",
                    "pair",
                    "needs_review",
                    json.dumps(checklist),
                    json.dumps(local_vision),
                ),
            )


def test_verified_scan_uses_operator_corrected_registry_rerun_for_same_physical_pair(
    tmp_path: Path,
) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    _install_operator_correction(scan_db, with_corroborating_scan=True)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)

    verified = ledger._verified_scan("scan-1", "card-1")

    assert verified["scanId"] == "scan-1"
    assert verified["identityEvidenceScanId"] == "scan-2"
    assert verified["operatorLessonId"] == "operator-lesson-1"
    assert verified["registryIdentityId"] == "registry-sonia-148-tie-dye"
    assert verified["registryIdentity"]["parallel"] == "Tie-Dye"
    assert verified["registryIdentity"]["serial_number"] == "06/25"
    assert "operator_lesson:operator-lesson-1" in verified["registryReceipts"]
    assert "operator_corroborating_scan:scan-2" in verified["registryReceipts"]


def test_verified_scan_fails_closed_when_operator_correction_has_no_registry_rerun(
    tmp_path: Path,
) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    _install_operator_correction(scan_db, with_corroborating_scan=False)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)

    with pytest.raises(ValueError, match="no Registry-exact physical rerun corroborates it"):
        ledger._verified_scan("scan-1", "card-1")

def test_receive_without_photos_locks_next_exact_scan_to_that_purchase(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)

    first = ledger.record_acquisition_item(purchase())
    first_id = int(first["item"]["acquisitionItemId"])
    other = purchase()
    other["purchase_id"] = "order-2"
    other["source_key"] = "mercari:m45183422692:unit:2"
    ledger.record_acquisition_item(other)

    received = ledger.receive_without_scan(first_id)
    assert received["status"] == "received_unscanned"
    assert received["inventoryItemId"] is None
    with ledger._connect() as db:
        assert db.execute("SELECT COUNT(*) FROM physical_inventory_receipts").fetchone()[0] == 0

    pending = ledger.pending_receipts()
    locked = next(row for row in pending["receipts"] if row["acquisitionItemId"] == first_id)
    assert locked["status"] == "received_unscanned"

    attached = ledger.match_or_reserve_purchase(
        scan_identity(), "card-1", "inventory-1", "scan-1"
    )
    assert attached["status"] == "pending_purchase"
    assert attached["receiptMode"] == "pre_received_scan_attached"
    assert attached["match"]["acquisitionItemId"] == first_id

    finalized = ledger.receive_into_inventory(
        "card-1", "inventory-1", first_id, "scan-1", "investment_stash"
    )
    assert finalized["status"] == "received"
    assert finalized["disposition"] == "investment_stash"


def test_ebay_completed_purchase_cannot_be_downgraded_by_older_active_snapshot(tmp_path: Path) -> None:
    scan_db = tmp_path / "scan.sqlite3"
    create_scan_db(scan_db)
    ledger = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    active = purchase("Green Prizm")
    active.update({
        "purchase_id": "temporary-order",
        "source_key": "ebay:temporary:line-1:unit:1",
        "source": "eBay",
        "source_item_id": "item-1",
        "allocated_cost": 0.49,

        "evidence": {
            "order_line_item_id": "line-1",
            "transaction_id": "transaction-1",
            "unit_index": 1,
            "order_status": "Active",
            "payment_status": "Incomplete",
        },
    })
    completed = dict(active)
    completed.update({
        "purchase_id": "completed-order",
        "source_key": "ebay:completed:line-1:unit:1",
        "allocated_cost": 2.31,
        "evidence": {
            "order_line_item_id": "line-1",
            "transaction_id": "transaction-1",
            "unit_index": 1,
            "order_status": "Completed",
            "payment_status": "Complete",
        },
    })

    assert ledger.record_acquisition_item(active)["created"] is True
    assert ledger.record_acquisition_item(completed)["created"] is False
    assert ledger.record_acquisition_item(active)["created"] is False

    with ledger._connect() as db:
        rows = db.execute(
            "SELECT purchase_id,source_key,allocated_cost,evidence FROM acquisition_items "
            "WHERE source='eBay'"
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["purchase_id"] == "completed-order"
    assert rows[0]["source_key"] == "ebay:completed:line-1:unit:1"
    assert float(rows[0]["allocated_cost"]) == pytest.approx(2.31)
    assert json.loads(rows[0]["evidence"])["payment_status"] == "Complete"
