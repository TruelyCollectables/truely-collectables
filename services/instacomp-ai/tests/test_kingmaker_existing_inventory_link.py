from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.kingmaker_accounting import KingmakerAccounting


class ExistingInventoryPurchaseLinkTest(unittest.TestCase):
    def test_link_existing_keeps_one_physical_receipt_and_becomes_listing_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            accounting_db = root / "accounting.sqlite3"
            scan_db = root / "scans.sqlite3"
            with sqlite3.connect(scan_db) as db:
                db.execute(
                    """CREATE TABLE scans (
                    scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT,
                    front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT
                    )"""
                )
                db.execute(
                    "INSERT INTO scans VALUES (?,?,?,?,?,?,?)",
                    ("scan-existing-1", "card-kiki-149-red-power-75", "2026-09-01T00:00:00Z", "front", "back", "pair", "complete"),
                )

            ledger = KingmakerAccounting(accounting_db, scan_db)
            ledger.initialize()
            ledger.record_acquisition_item({
                "purchase_id": "03-15011-06269",
                "source": "eBay",
                "purchased_at": "2026-08-06",
                "title": "Kiki Iriafen Red Power /75 #149",
                "card_uuid": "card-kiki-149-red-power-75",
                "allocated_cost": 23.37,
                "identity": {
                    "player": "Kiki Iriafen", "year": "2025", "setName": "Panini Prizm WNBA",
                    "cardNumber": "149", "parallel": "Red Power", "serialNumber": "41/75",
                    "isAuto": False, "isRelic": False,
                },
            })
            match = ledger.match_or_reserve_purchase(
                {
                    "player": "Kiki Iriafen", "year": "2025", "setName": "Panini Prizm WNBA",
                    "cardNumber": "149", "parallel": "Red Power", "serialNumber": "41/75",
                    "isAuto": False, "isRelic": False,
                },
                "card-kiki-149-red-power-75", "inventory-existing-1", "scan-existing-1",
            )
            self.assertEqual(match["status"], "pending_purchase")
            acquisition_id = int(match["match"]["acquisitionItemId"])

            linked = ledger.link_purchase_to_existing_inventory(
                "card-kiki-149-red-power-75", "inventory-existing-1", acquisition_id, "scan-existing-1", "resale"
            )
            self.assertEqual(linked["status"], "linked_existing")
            self.assertEqual(linked["receiptMode"], "linked_existing")
            self.assertEqual(linked["inventoryState"], "resale_ready")
            self.assertIsNone(linked.get("receivedAt"))

            readiness = ledger.listing_readiness(["inventory-existing-1"])
            self.assertTrue(readiness["ready"])
            self.assertEqual(readiness["tracked"][0]["status"], "linked_existing")
            with sqlite3.connect(accounting_db) as db:
                receipt_count = db.execute("SELECT COUNT(*) FROM physical_inventory_receipts").fetchone()[0]
                received_at = db.execute("SELECT received_at FROM physical_inventory_receipts").fetchone()[0]
            self.assertEqual(receipt_count, 1)
            self.assertIsNone(received_at)


if __name__ == "__main__":
    unittest.main()
