from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.kingmaker_accounting import KingmakerAccounting


def identity(card_number: str = "83") -> dict[str, object]:
    return {
        "player": "Sonia Citron",
        "year": "2025",
        "brand": "Panini",
        "setName": "Select",
        "cardNumber": card_number,
        "parallel": "Silver Prizm",
        "serialNumber": None,
        "gradingCompany": None,
        "isAuto": False,
        "isRelic": False,
    }


def create_scan_db(path: Path) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE scans(scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT, "
            "front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT)"
        )


def add_scan(path: Path, scan_id: str, card_uuid: str, front: str, back: str) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO scans VALUES(?,?,?,?,?,?,?)",
            (scan_id, card_uuid, "2026-09-08T12:00:00Z", front, back, front + back, "complete"),
        )


def add_purchase(
    accounting: KingmakerAccounting,
    purchase_id: str,
    card_uuid: str,
    *,
    card_number: str = "83",
    cost: float = 10.0,
) -> None:
    accounting.record_acquisition_item(
        {
            "purchase_id": purchase_id,
            "source": "eBay",
            "purchased_at": "2026-09-08",
            "title": purchase_id,
            "card_uuid": card_uuid,
            "identity": identity(card_number),
            "allocated_cost": cost,
        }
    )


def test_receive_link_disposition_and_fail_closed_guards(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-1", "card-1", "front-1", "back-1")
    add_scan(scan_db, "scan-2", "card-2", "front-2", "back-2")
    add_scan(scan_db, "scan-bad", "card-X", "same", "same")

    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    add_purchase(accounting, "purchase-1", "card-1")

    reserved = accounting.match_or_reserve_purchase(
        identity(), "card-1", "inventory-1", "scan-1"
    )
    assert reserved["status"] == "pending_purchase"
    acquisition_id = reserved["match"]["acquisitionItemId"]

    readiness = accounting.listing_readiness(["inventory-1"])
    assert readiness["ready"] is False
    assert readiness["blocked"][0]["reason"] == "matched_purchase_not_received_or_linked"

    with pytest.raises(ValueError, match="requested scan does not match"):
        accounting.receive_into_inventory(
            "card-1", "inventory-1", acquisition_id, "scan-2", "resale"
        )

    received = accounting.receive_into_inventory(
        "card-1", "inventory-1", acquisition_id, "scan-1", "resale"
    )
    assert received["status"] == "received"
    assert received["inventoryState"] == "resale_ready"
    assert accounting.listing_readiness(["inventory-1"])["ready"] is True

    repeated = accounting.receive_into_inventory(
        "card-1", "inventory-1", acquisition_id, "scan-1", "resale"
    )
    assert repeated["status"] == "received"

    with pytest.raises(ValueError, match="inventory disposition"):
        accounting.receive_into_inventory(
            "card-1", "inventory-1", acquisition_id, "scan-1", "investment_stash"
        )

    stash = accounting.set_inventory_disposition("inventory-1", "investment_stash")
    assert stash["inventoryState"] == "investment_stash"
    readiness = accounting.listing_readiness(["inventory-1"])
    assert readiness["ready"] is False
    assert readiness["blocked"][0]["reason"] == "investment_stash_not_for_sale"

    resale = accounting.set_inventory_disposition("inventory-1", "resale")
    assert resale["inventoryState"] == "resale_ready"
    assert accounting.listing_readiness(["inventory-1"])["ready"] is True

    add_purchase(accounting, "purchase-extra", "card-1", card_number="84")
    duplicate_physical = accounting.match_or_reserve_purchase(
        identity("84"), "card-1", "inventory-other", "scan-1"
    )
    assert duplicate_physical["inventoryItemId"] == "inventory-1"
    assert duplicate_physical["scanId"] == "scan-1"

    add_purchase(accounting, "purchase-2", "card-2", cost=12.0)
    second = accounting.match_or_reserve_purchase(
        identity(), "card-2", "inventory-2", "scan-2"
    )
    assert second["status"] == "pending_purchase"
    second_acquisition_id = second["match"]["acquisitionItemId"]

    linked = accounting.link_purchase_to_existing_inventory(
        "card-2", "inventory-2", second_acquisition_id, "scan-2", "resale"
    )
    assert linked["status"] == "linked_existing"
    assert linked["receiptMode"] == "linked_existing"
    assert accounting.listing_readiness(["inventory-2"])["ready"] is True

    with pytest.raises(ValueError, match="already linked"):
        accounting.receive_into_inventory(
            "card-2", "inventory-2", second_acquisition_id, "scan-2", "resale"
        )

    add_purchase(accounting, "purchase-3", "card-3")
    bad_evidence = accounting.match_or_reserve_purchase(
        identity(), "card-X", "inventory-X", "scan-bad"
    )
    assert bad_evidence["status"] == "scan_required"
    assert "distinct" in bad_evidence["reason"].lower()

    missing = accounting.match_or_reserve_purchase(
        identity(), "card-3", "inventory-3", "does-not-exist"
    )
    assert missing["status"] == "scan_required"

    wrong_uuid = accounting.match_or_reserve_purchase(
        identity(), "card-WRONG", "inventory-wrong", "scan-2"
    )
    assert wrong_uuid["status"] == "scan_required"
    assert "different card uuid" in wrong_uuid["reason"].lower()

    legacy = accounting.listing_readiness(["untracked-legacy-item"])
    assert legacy["ready"] is True
    assert legacy["tracked"] == []

    with sqlite3.connect(tmp_path / "accounting.sqlite3") as db:
        rows = db.execute(
            "SELECT inventory_item_id,scan_id,status,disposition,inventory_state,receipt_mode "
            "FROM physical_inventory_receipts ORDER BY inventory_item_id"
        ).fetchall()
    assert rows == [
        ("inventory-1", "scan-1", "received", "resale", "resale_ready", "received_new"),
        ("inventory-2", "scan-2", "linked_existing", "resale", "resale_ready", "linked_existing"),
    ]
