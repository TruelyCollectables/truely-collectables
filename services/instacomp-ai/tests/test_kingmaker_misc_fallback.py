from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

from app.kingmaker_accounting import KingmakerAccounting


def test_no_market_purchase_creates_misc_received_fallback():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        accounting_db = root / "accounting.sqlite3"
        scan_db = root / "scans.sqlite3"
        with sqlite3.connect(scan_db) as db:
            db.execute(
                """CREATE TABLE scans (
                scan_id TEXT PRIMARY KEY, card_uuid TEXT, created_at TEXT,
                front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT,
                checklist_json TEXT
                )"""
            )
            db.execute(
                "INSERT INTO scans VALUES (?,?,?,?,?,?,?,?)",
                (
                    "scan-misc-1",
                    "card-stunning-steve-29",
                    "2026-09-24T00:00:00Z",
                    "front",
                    "back",
                    "pair",
                    "trusted_memory_match",
                    json.dumps(
                        {
                            "outcome": "exact_match",
                            "identity_id": "registry-stunning-steve-29",
                            "identity": {
                                "player": "Stunning Steve Austin",
                                "year": "1995",
                                "manufacturer": "Cardz",
                                "brand": "Cardz",
                                "set_name": "WCW Main Event",
                                "card_number": "29",
                                "parallel": "Base",
                                "autograph": False,
                                "memorabilia": False,
                            },
                            "source_receipts": ["registry_fingerprint:test"],
                        }
                    ),
                ),
            )

        ledger = KingmakerAccounting(accounting_db, scan_db)
        ledger.initialize()
        result = ledger.match_or_reserve_purchase(
            {
                "player": "Stunning Steve Austin",
                "year": "1995",
                "manufacturer": "Cardz",
                "brand": "Cardz",
                "setName": "WCW Main Event",
                "cardNumber": "29",
                "parallel": "Base",
                "isAuto": False,
                "isRelic": False,
            },
            "card-stunning-steve-29",
            "inventory-stunning-steve-29",
            "scan-misc-1",
        )

        assert result["status"] == "received"
        assert result["inventoryState"] == "resale_ready"
        assert result["receiptMode"] == "received_new_misc_fallback"
        assert result["match"]["source"] == "Misc"
        assert result["match"]["allocatedCost"] is None
        assert result["match"]["costStatus"] == "unknown"

        readiness = ledger.listing_readiness(["inventory-stunning-steve-29"])
        assert readiness["ready"] is True
        assert readiness["tracked"][0]["source"] == "Misc"
        assert readiness["tracked"][0]["costStatus"] == "unknown"
