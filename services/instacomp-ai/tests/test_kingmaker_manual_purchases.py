from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.kingmaker_accounting import KingmakerAccounting
from app.kingmaker_manual_purchases import KingmakerManualPurchases


def identity(player: str, card_number: str) -> dict:
    return {
        "player": player,
        "year": "2025",
        "brand": "Panini",
        "setName": "Panini Prizm WNBA",
        "cardNumber": card_number,
        "parallel": "Base",
        "isAuto": False,
        "isRelic": False,
    }


def make_scan_db(path: Path, scan_id: str, card_uuid: str, card_identity: dict) -> None:
    with sqlite3.connect(path) as db:
        db.execute(
            """CREATE TABLE scans (
            scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT,
            front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT,
            status TEXT, checklist_json TEXT
            )"""
        )
        db.execute(
            "INSERT INTO scans VALUES (?,?,?,?,?,?,?,?)",
            (
                scan_id,
                card_uuid,
                "2026-09-18T00:00:00Z",
                "front-sha",
                "back-sha",
                "pair-sha",
                "trusted_memory_match",
                json.dumps(
                    {
                        "outcome": "exact_match",
                        "identity_id": f"registry-{card_uuid}",
                        "identity": card_identity,
                    }
                ),
            ),
        )


class ManualPurchaseTest(unittest.TestCase):
    def test_single_card_with_evidence_is_exact_training_fact(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "accounting.sqlite3"
            ledger = KingmakerAccounting(db_path)
            ledger.initialize()
            manual = KingmakerManualPurchases(db_path)
            manual.initialize()
            draft = manual.upsert_draft(
                {
                    "mode": "single",
                    "source": "Card Show",
                    "purchased_at": "2026-09-18",
                    "total_cost": 12.34,
                    "cards": [{"title": "Test", "identity": identity("Test Player", "1")}],
                },
                actor="test",
            )
            manual.store_evidence(
                draft["id"], b"receipt", "receipt.png", "image/png", "receipt", actor="test"
            )
            result = manual.confirm_lot(draft["id"], actor="test")
            acquisition = result["acquisitions"][0]
            self.assertEqual(acquisition["allocatedCost"], 12.34)
            self.assertTrue(acquisition["individualCostVerified"])
            self.assertTrue(acquisition["trainingEligible"])
            self.assertIsNotNone(ledger.find_price_match(identity("Test Player", "1"), 12.0))

    def test_equal_split_lot_never_becomes_exact_card_price(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "accounting.sqlite3"
            ledger = KingmakerAccounting(db_path)
            ledger.initialize()
            manual = KingmakerManualPurchases(db_path)
            manual.initialize()
            draft = manual.upsert_draft(
                {
                    "mode": "lot",
                    "source": "eBay",
                    "purchased_at": "2026-09-18",
                    "total_cost": 10.01,
                    "cards": [
                        {"title": "A", "identity": identity("Lot A", "10")},
                        {"title": "B", "identity": identity("Lot B", "20")},
                    ],
                },
                actor="test",
            )
            manual.store_evidence(
                draft["id"], b"lot-proof", "lot.png", "image/png", "listing_screenshot", actor="test"
            )
            result = manual.confirm_lot(draft["id"], "equal_split", actor="test")
            self.assertEqual([row["allocatedCost"] for row in result["acquisitions"]], [5.01, 5.0])
            self.assertTrue(result["lotTotalTrainingEligible"])
            self.assertTrue(all(not row["trainingEligible"] for row in result["acquisitions"]))
            self.assertIsNone(ledger.find_price_match(identity("Lot A", "10"), 5.0))

    def test_manual_edit_updates_existing_physical_acquisition_and_survives_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "accounting.sqlite3"
            scan_path = root / "scan.sqlite3"
            card_identity = identity("Existing Player", "99")
            make_scan_db(scan_path, "scan-existing", "card-existing", card_identity)
            ledger = KingmakerAccounting(db_path, scan_path)
            ledger.initialize()
            original = ledger.record_acquisition_item(
                {
                    "purchase_id": "ORDER-1",
                    "source": "eBay",
                    "purchased_at": "2026-09-18",
                    "source_key": "ebay:ORDER-1:unit:1",
                    "identity_status": "source_exact",
                    "title": "Existing Player #99",
                    "card_uuid": "card-existing",
                    "allocated_cost": 8.00,
                    "identity": card_identity,
                }
            )
            original_id = original["item"]["acquisitionItemId"]
            receipt = ledger.match_or_reserve_purchase(
                card_identity, "card-existing", "inventory-existing", "scan-existing"
            )
            self.assertEqual(receipt["status"], "received")

            manual = KingmakerManualPurchases(db_path, scan_path)
            manual.initialize()
            draft = manual.upsert_draft(
                {
                    "mode": "single",
                    "source": "eBay",
                    "purchased_at": "2026-09-18",
                    "order_number": "ORDER-1",
                    "total_cost": 9.25,
                    "cards": [
                        {
                            "title": "Existing Player #99",
                            "identity": card_identity,
                            "card_uuid": "card-existing",
                            "scan_id": "scan-existing",
                            "inventory_item_id": "inventory-existing",
                        }
                    ],
                },
                actor="test",
            )
            manual.store_evidence(
                draft["id"], b"verified-proof", "proof.png", "image/png", "receipt", actor="test"
            )
            result = manual.confirm_lot(draft["id"], actor="test")
            self.assertEqual(result["acquisitions"][0]["acquisitionItemId"], original_id)
            self.assertTrue(result["acquisitions"][0]["alreadyLinked"])

            ledger.record_acquisition_item(
                {
                    "purchase_id": "ORDER-1",
                    "source": "eBay",
                    "purchased_at": "2026-09-18",
                    "source_key": "ebay:ORDER-1:unit:1",
                    "identity_status": "source_exact",
                    "title": "Existing Player #99",
                    "card_uuid": "card-existing",
                    "allocated_cost": 8.00,
                    "identity": card_identity,
                }
            )
            with sqlite3.connect(db_path) as db:
                row = db.execute(
                    "SELECT allocated_cost,manual_entry,verification_status,status FROM acquisition_items WHERE id=?",
                    (original_id,),
                ).fetchone()
            self.assertEqual(row[0], 9.25)
            self.assertEqual(row[1], 1)
            self.assertEqual(row[2], "user_verified_with_evidence")
            self.assertEqual(row[3], "received")


if __name__ == "__main__":
    unittest.main()
