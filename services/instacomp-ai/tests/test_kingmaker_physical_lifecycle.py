from __future__ import annotations

import sqlite3
import json
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
            "front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT, checklist_json TEXT)"
        )


def add_scan(path: Path, scan_id: str, card_uuid: str, front: str, back: str) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            "INSERT INTO scans VALUES(?,?,?,?,?,?,?,?)",
            (scan_id, card_uuid, "2026-09-17T12:00:00Z", front, back, front + back, "trusted_memory_match", json.dumps({"outcome": "exact_match", "identity_id": f"registry-{card_uuid}", "identity": identity()})),
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
            "purchased_at": "2026-09-17",
            "source_key": f"ebay:{purchase_id}:unit:1",
            "identity_status": "source_exact",
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
    assert reserved["status"] == "received"
    assert reserved["receiptMode"] == "received_new"
    acquisition_id = reserved["match"]["acquisitionItemId"]

    readiness = accounting.listing_readiness(["inventory-1"])
    assert readiness["ready"] is True
    assert readiness["blocked"] == []
    assert readiness["tracked"][0]["status"] == "received"
    assert readiness["tracked"][0]["receiptMode"] == "received_new"

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
    assert second["status"] == "received"
    assert second["receiptMode"] == "received_new"
    second_acquisition_id = second["match"]["acquisitionItemId"]
    assert accounting.listing_readiness(["inventory-2"])["ready"] is True

    repeated_second = accounting.receive_into_inventory(
        "card-2", "inventory-2", second_acquisition_id, "scan-2", "resale"
    )
    assert repeated_second["status"] == "received"

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
    assert legacy["ready"] is False
    assert legacy["blocked"][0]["reason"] == "physical_inventory_receipt_missing"
    assert legacy["tracked"] == []

    with sqlite3.connect(tmp_path / "accounting.sqlite3") as db:
        rows = db.execute(
            "SELECT inventory_item_id,scan_id,status,disposition,inventory_state,receipt_mode "
            "FROM physical_inventory_receipts ORDER BY inventory_item_id"
        ).fetchall()
    assert rows == [
        ("inventory-1", "scan-1", "received", "resale", "resale_ready", "received_new"),
        ("inventory-2", "scan-2", "received", "resale", "resale_ready", "received_new"),
    ]



def test_verified_scan_immediately_creates_received_resale_receipt(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-rivers", "card-rivers", "front-rivers", "back-rivers")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    add_purchase(accounting, "purchase-rivers", "card-rivers")

    reserved = accounting.match_or_reserve_purchase(
        identity(), "card-rivers", "inventory-rivers", "scan-rivers"
    )
    assert reserved["status"] == "received"
    assert reserved["inventoryState"] == "resale_ready"
    assert reserved["receiptMode"] == "received_new"

    readiness = accounting.listing_readiness(["inventory-rivers"])
    assert readiness["ready"] is True
    assert readiness["blocked"] == []
    assert readiness["tracked"][0]["status"] == "received"

    with accounting._connect() as db:
        receipt = db.execute(
            "SELECT status,inventory_state,receipt_mode,received_at FROM physical_inventory_receipts WHERE inventory_item_id='inventory-rivers'"
        ).fetchone()
        purchase = db.execute(
            "SELECT status FROM acquisition_items WHERE id=?",
            (reserved["match"]["acquisitionItemId"],),
        ).fetchone()
    assert receipt["status"] == "received"
    assert receipt["inventory_state"] == "resale_ready"
    assert receipt["receipt_mode"] == "received_new"
    assert receipt["received_at"] is not None
    assert purchase["status"] == "received"

def test_misc_unknown_cost_can_be_received_without_fake_profit_basis(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-misc", "card-misc", "front-misc", "back-misc")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    accounting.record_acquisition_item(
        {
            "purchase_id": "misc:scan-misc",
            "source": "Misc",
            "card_uuid": "card-misc",
            "identity": identity(),
            "allocated_cost": None,
            "cost_status": "unknown",
            "evidence": "no_exact_ebay_or_mercari_purchase_match",
        }
    )
    with accounting._connect() as db:
        acquisition_id = int(db.execute(
            "SELECT id FROM acquisition_items WHERE purchase_id='misc:scan-misc'"
        ).fetchone()["id"])
    reserved = accounting.reserve_specific_acquisition(
        identity(), "card-misc", "inventory-misc", "scan-misc", acquisition_id,
        "operator_policy_misc_after_exact_market_history_miss",
    )
    assert reserved["status"] == "received"
    assert reserved["receiptMode"] == "received_new"
    assert reserved["match"]["allocatedCost"] is None
    assert reserved["match"]["costStatus"] == "unknown"
    received = accounting.receive_into_inventory(
        "card-misc", "inventory-misc", reserved["match"]["acquisitionItemId"], "scan-misc", "resale"
    )
    assert received["status"] == "received"
    assert received["match"]["allocatedCost"] is None
    assert accounting.listing_readiness(["inventory-misc"])["ready"] is True


def test_explicit_reservation_separates_discovery_from_verified_assignment(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-explicit", "card-explicit", "front-explicit", "back-explicit")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    accounting.record_acquisition_item({
        "purchase_id": "misc:explicit", "source": "Misc", "card_uuid": "card-explicit",
        "identity": identity(), "allocated_cost": None, "cost_status": "unknown",
    })
    with accounting._connect() as db:
        acquisition_id = int(db.execute("SELECT id FROM acquisition_items WHERE purchase_id='misc:explicit'").fetchone()["id"])
    # Base/generic evidence may be below automatic discovery's 0.85 threshold, but
    # an explicitly selected, physical-UUID-bound Misc record is deterministic.
    reserved = accounting.reserve_specific_acquisition(
        identity(), "card-explicit", "inventory-explicit", "scan-explicit", acquisition_id,
        "operator_policy_misc_after_exact_market_history_miss",
    )
    assert reserved["status"] == "received"
    assert reserved["receiptMode"] == "received_new"
    assert reserved["match"]["purchaseId"] == "misc:explicit"
    received = accounting.receive_into_inventory(
        "card-explicit", "inventory-explicit", acquisition_id, "scan-explicit", "resale"
    )
    assert received["status"] == "received"


def test_explicit_misc_reservation_rejects_other_physical_uuid(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-a", "card-a", "front-a", "back-a")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    accounting.record_acquisition_item({
        "purchase_id": "misc:card-b", "source": "Misc", "card_uuid": "card-b",
        "identity": identity(), "allocated_cost": None, "cost_status": "unknown",
    })
    with accounting._connect() as db:
        acquisition_id = int(db.execute("SELECT id FROM acquisition_items WHERE purchase_id='misc:card-b'").fetchone()["id"])
    with pytest.raises(ValueError, match="exact physical card UUID"):
        accounting.reserve_specific_acquisition(identity(), "card-a", "inventory-a", "scan-a", acquisition_id, "test")


def test_known_market_purchase_can_replace_received_misc_unknown_fallback(tmp_path: Path) -> None:
    scan_db = tmp_path / "scans.sqlite3"; create_scan_db(scan_db)
    add_scan(scan_db, "scan-r", "card-r", "front-r", "back-r")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    accounting.record_acquisition_item({"purchase_id":"misc:r","source":"Misc","card_uuid":"card-r","identity":identity(),"allocated_cost":None,"cost_status":"unknown"})
    with accounting._connect() as db: misc_id=int(db.execute("select id from acquisition_items where purchase_id='misc:r'").fetchone()["id"] )
    accounting.reserve_specific_acquisition(identity(),"card-r","inventory-r","scan-r",misc_id,"misc_policy")
    accounting.receive_into_inventory("card-r","inventory-r",misc_id,"scan-r","resale")
    accounting.record_acquisition_item({"purchase_id":"ebay:r","source":"eBay","identity":identity(),"allocated_cost":12.34})
    with accounting._connect() as db: known_id=int(db.execute("select id from acquisition_items where purchase_id='ebay:r'").fetchone()["id"] )
    result=accounting.replace_misc_fallback_with_known_acquisition(identity(),"card-r","inventory-r","scan-r",known_id,"live_ebay_order")
    assert result["status"]=="received"
    assert result["match"]["purchaseId"]=="ebay:r"
    with accounting._connect() as db:
        old=db.execute("select status from acquisition_items where id=?",(misc_id,)).fetchone()["status"]
        receipt=db.execute("select acquisition_item_id from physical_inventory_receipts where inventory_item_id='inventory-r'").fetchone()["acquisition_item_id"]
    assert old=="superseded" and int(receipt)==known_id


def add_listing_receipt(path: Path, scan_id: str, pair_sha: str, *, verified: bool = True) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS listing_image_receipts("
            "scan_id TEXT PRIMARY KEY, listing_image_pair_sha256 TEXT NOT NULL, "
            "front_verified INTEGER NOT NULL, back_verified INTEGER NOT NULL)"
        )
        db.execute(
            "INSERT OR REPLACE INTO listing_image_receipts VALUES(?,?,?,?)",
            (scan_id, pair_sha, int(verified), int(verified)),
        )


def _received_resale_card(tmp_path: Path):
    scan_db = tmp_path / "scans.sqlite3"
    create_scan_db(scan_db)
    add_scan(scan_db, "scan-condition", "card-condition", "front-condition", "back-condition")
    add_listing_receipt(scan_db, "scan-condition", "listing-pair-v1")
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", scan_db)
    add_purchase(accounting, "purchase-condition", "card-condition")
    reserved = accounting.match_or_reserve_purchase(
        identity(), "card-condition", "inventory-condition", "scan-condition"
    )
    acquisition_id = reserved["match"]["acquisitionItemId"]
    accounting.receive_into_inventory(
        "card-condition", "inventory-condition", acquisition_id, "scan-condition", "resale"
    )
    return accounting, scan_db


def test_condition_review_is_human_only_and_binds_verified_listing_pair(tmp_path: Path) -> None:
    accounting, _scan_db = _received_resale_card(tmp_path)
    before = accounting.condition_review_readiness(["inventory-condition"])
    assert before["ready"] is False
    assert before["blocked"][0]["reason"] == "operator_condition_missing"

    with pytest.raises(ValueError, match="human operator"):
        accounting.record_raw_card_condition_review(
            "inventory-condition", "scan-condition", "card-condition",
            "Near Mint or Better", "ChatGPT",
        )

    receipt = accounting.record_raw_card_condition_review(
        "inventory-condition", "scan-condition", "card-condition",
        "Near Mint or Better", "David", notes="human visual front/back review",
    )
    assert receipt["imagePairSha256"] == "listing-pair-v1"
    assert receipt["imagePairSource"] == "verified_listing_image_receipt"
    ready = accounting.condition_review_readiness(["inventory-condition"])
    assert ready["ready"] is True
    assert ready["readyCount"] == 1
    assert ready["reviewed"][0]["cardCondition"] == "Near Mint or Better"
    assert ready["reviewed"][0]["imagePairSha256"] == "listing-pair-v1"


def test_condition_receipt_goes_stale_when_listing_images_change(tmp_path: Path) -> None:
    accounting, scan_db = _received_resale_card(tmp_path)
    accounting.record_raw_card_condition_review(
        "inventory-condition", "scan-condition", "card-condition",
        "Excellent", "David",
    )
    add_listing_receipt(scan_db, "scan-condition", "listing-pair-v2")
    result = accounting.condition_review_readiness(["inventory-condition"])
    assert result["ready"] is False
    assert result["blocked"][0]["reason"] == "condition_receipt_stale"


def test_condition_review_rejects_unverified_listing_pair_and_non_resale_inventory(tmp_path: Path) -> None:
    accounting, scan_db = _received_resale_card(tmp_path)
    add_listing_receipt(scan_db, "scan-condition", "unverified-pair", verified=False)
    with pytest.raises(ValueError, match="fully verified listing-image receipt"):
        accounting.record_raw_card_condition_review(
            "inventory-condition", "scan-condition", "card-condition", "Very Good", "David"
        )

    add_listing_receipt(scan_db, "scan-condition", "verified-pair", verified=True)
    accounting.set_inventory_disposition("inventory-condition", "investment_stash")
    with pytest.raises(ValueError, match="resale-ready"):
        accounting.record_raw_card_condition_review(
            "inventory-condition", "scan-condition", "card-condition", "Very Good", "David"
        )
