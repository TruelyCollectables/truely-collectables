from pathlib import Path
from types import SimpleNamespace

from app.deal_hunter import DealHunterScheduler
from app.deal_hunter_store import DealHunterStore
from app.kingmaker_accounting import KingmakerAccounting


def identity(parallel: str = "Silver Prizm", set_name: str = "Select"):
    return {
        "player": "Sonia Citron",
        "year": "2025",
        "brand": "Panini",
        "setName": set_name,
        "cardNumber": "83",
        "parallel": parallel,
        "serialNumber": None,
        "gradingCompany": None,
        "isAuto": False,
        "isRelic": False,
    }


def seed(accounting: KingmakerAccounting, cost: float = 10.0):
    accounting.record_acquisition_item(
        {
            "purchase_id": "ebay:12-14963-92137",
            "source": "eBay",
            "purchased_at": "2026-07-30",
            "title": "Sonia Citron Select Silver #83",
            "identity": identity(),
            "allocated_cost": cost,
        }
    )


def test_price_trigger_includes_fifteen_percent_and_better(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    seed(accounting, 10.0)
    exact_edge = accounting.find_price_match(identity(), 11.50)
    assert exact_edge is not None
    assert exact_edge.benchmark_cost == 10.0
    assert exact_edge.delta_percent == 15.0
    assert accounting.find_price_match(identity(), 11.51) is None
    bargain = accounting.find_price_match(identity(), 6.0)
    assert bargain is not None
    assert bargain.delta_percent == -40.0


def test_price_trigger_rejects_wrong_parallel_set_and_grade(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    seed(accounting, 10.0)
    assert accounting.find_price_match(identity("Green Prizm"), 9.0) is None
    assert accounting.find_price_match(identity(set_name="Prizm"), 9.0) is None
    graded = identity()
    graded["gradingCompany"] = "PSA"
    assert accounting.find_price_match(graded, 9.0) is None


def test_deal_hunter_forces_alert_without_forcing_auto_buy(tmp_path: Path):
    store = DealHunterStore(tmp_path / "deal_hunter.sqlite3")
    scheduler = DealHunterScheduler(SimpleNamespace(), store)
    seed(scheduler.accounting, 10.0)
    result, match = scheduler._apply_acquisition_price_trigger(
        {
            "candidate_key": "ebay:test",
            "listing_url": "https://example.test/card",
            "identity": identity(),
            "delivered_cost": 10.99,
            "alertworthy": False,
            "actionable": False,
            "deal_label": "NO FUCKING WAY / OVERPRICED",
        }
    )
    assert match is not None
    assert result["alertworthy"] is True
    assert result["actionable"] is False
    assert result["deal_label"] == "BUY AGAIN — WITHIN 15% OF OUR COST"
    assert result["acquisition_benchmark_cost"] == 10.0
    assert result["acquisition_delta_percent"] == 9.9


def test_inventory_snapshot_bridge_uses_read_only_legacy_safe_reader(monkeypatch):
    import app.kingmaker_accounting_routes as routes
    expected = {"listings": [{"ebayItemId": "123"}], "listingCount": 1, "syncedAt": "now"}
    monkeypatch.setattr(routes, "fetch_ebay_seller_snapshot", lambda: expected)
    result = routes._run_local_ebay_bridge({"mode": "inventory_snapshot"})
    assert result == {"ok": True, "mode": "inventory_snapshot", "snapshot": expected}


def test_listing_readiness_blocks_unknown_requested_inventory_item(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3", tmp_path / "scans.sqlite3")
    accounting.initialize()
    result = accounting.listing_readiness(["km-missing-1"])
    assert result["ready"] is False
    assert result["tracked"] == []
    assert result["blocked"][0]["inventoryItemId"] == "km-missing-1"
    assert result["blocked"][0]["reason"] == "physical_inventory_receipt_missing"


def test_misc_unknown_cost_is_explicit_and_does_not_enter_price_benchmark(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    accounting.record_acquisition_item(
        {
            "purchase_id": "misc:scan-unknown",
            "source": "Misc",
            "title": "Operator policy fallback after eBay/Mercari exact-match miss",
            "identity": identity(),
            "allocated_cost": None,
            "cost_status": "unknown",
            "evidence": "no_exact_ebay_or_mercari_purchase_match",
            "seller": "manual-source",
            "order_number": "misc-order",
            "source_lot": "misc lot",
            "listing_url": "https://example.test/misc",
        }
    )
    with accounting._connect() as db:
        row = db.execute("SELECT * FROM acquisition_items WHERE purchase_id=?", ("misc:scan-unknown",)).fetchone()
    payload = accounting._purchase_row_payload(row)
    assert payload["source"] == "Misc"
    assert payload["allocatedCost"] is None
    assert payload["costStatus"] == "unknown"
    assert payload["seller"] == "manual-source"
    assert payload["orderNumber"] == "misc-order"
    assert payload["sourceLot"] == "misc lot"
    assert payload["listingUrl"] == "https://example.test/misc"
    assert accounting.find_price_match(identity(), 1.00) is None


def test_non_misc_unknown_cost_is_rejected(tmp_path: Path):
    import pytest
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    for source in ("eBay", "Mercari"):
        with pytest.raises(ValueError, match="only allowed for Misc"):
            accounting.record_acquisition_item(
                {
                    "purchase_id": f"{source}:unknown",
                    "source": source,
                    "identity": identity(),
                    "allocated_cost": None,
                    "cost_status": "unknown",
                }
            )


def test_pending_receipts_are_mac_local_cutoff_filtered_and_open_only(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    accounting.record_acquisition_item(
        {
            "purchase_id": "ebay:post-cutoff",
            "source": "eBay",
            "purchased_at": "2026-09-16T10:00:00Z",
            "title": "Sonia Citron Select Silver #83",
            "identity": identity(),
            "allocated_cost": 12.34,
            "seller": "seller-a",
            "order_number": "order-a",
            "listing_url": "https://example.test/a",
        }
    )
    accounting.record_acquisition_item(
        {
            "purchase_id": "misc:unknown",
            "source": "Misc",
            "purchased_at": "2026-09-17",
            "identity": identity("Base"),
            "allocated_cost": None,
            "cost_status": "unknown",
        }
    )
    accounting.record_acquisition_item(
        {
            "purchase_id": "ebay:before-cutoff",
            "source": "eBay",
            "purchased_at": "2026-09-15",
            "identity": identity(),
            "allocated_cost": 8.0,
        }
    )
    accounting.record_acquisition_item(
        {
            "purchase_id": "ebay:received",
            "source": "eBay",
            "purchased_at": "2026-09-17",
            "identity": identity(),
            "allocated_cost": 9.0,
            "status": "received",
        }
    )

    result = accounting.pending_receipts("2026-09-16")

    assert result["sourceAuthority"] == "mac_local_sqlite"
    assert result["summary"] == {
        "pendingRows": 2,
        "receivedAwaitingPhotos": 0,
        "pendingKnownBasis": 12.34,
        "unknownBasisCount": 1,
    }
    purchase_ids = {row["purchaseId"] for row in result["receipts"]}
    assert purchase_ids == {"ebay:post-cutoff", "misc:unknown"}
    known = next(row for row in result["receipts"] if row["purchaseId"] == "ebay:post-cutoff")
    assert known["seller"] == "seller-a"
    assert known["orderNumber"] == "order-a"
    assert known["listingUrl"] == "https://example.test/a"
    unknown = next(row for row in result["receipts"] if row["purchaseId"] == "misc:unknown")
    assert unknown["allocatedCost"] is None
    assert unknown["costStatus"] == "unknown"

def test_verified_purchase_title_accepts_manufacturer_when_registry_brand_differs(tmp_path: Path):
    accounting = KingmakerAccounting(tmp_path / "accounting.sqlite3")
    scan_identity = {
        "player": "Kiki Iriafen",
        "year": "2025",
        "manufacturer": "Panini",
        "brand": "Select",
        "product": "Select WNBA",
        "set_name": "Base Set - Courtside",
        "card_number": "205",
        "parallel": "Base",
        "autograph": False,
        "memorabilia": False,
    }
    ok, reasons = accounting._strict_title_proves_scan(
        "2025 Panini Base Set - Courtside Kiki Iriafen #205",
        scan_identity,
    )
    assert ok is True
    assert reasons == ["marketplace_title_explicitly_proves_registry_scan"]
