from pathlib import Path

from app.kingmaker_accounting import KingmakerAccounting


def test_purchase_title_accepts_manufacturer_when_registry_brand_differs(tmp_path: Path):
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
