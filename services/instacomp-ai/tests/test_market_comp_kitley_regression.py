import pytest

from app import market_comp_routes as market


def kitley_identity(serial_number: str = "/25"):
    return market._canonical_identity(
        {
            "year": "2025",
            "manufacturer": "Panini",
            "product": "Donruss WNBA",
            "player": "Elizabeth Kitley",
            "cardNumber": "66",
            "parallel": "Pink Shimmer",
            "serialNumber": serial_number,
            "isAuto": False,
            "isRelic": False,
        }
    )


def test_kitley_exact_ebay_title_passes():
    identity = kitley_identity()
    title = "Panini 2025 Donruss WNBA Elizabeth Kitley #66 Las Vegas Aces /25 Pink Shimmer"
    ok, reasons = market._strong_exact_title(title, identity)
    assert ok is True
    assert reasons == []
    assert market._denominator(identity["serial_number"]) == "25"

def test_kitley_nearby_false_positives_are_rejected():
    identity = kitley_identity()
    cases = [
        ("2025 Donruss WNBA #66 Elizabeth Kitley", "parallel_mismatch"),
        ("2025 Donruss WNBA Blue Shimmer #66 Elizabeth Kitley /49", "parallel_mismatch"),
        ("2025 Donruss WNBA Pink Shimmer #66 Elizabeth Kitley /99", "serial_run_mismatch"),
        ("2025 Donruss WNBA Pink Shimmer #67 Elizabeth Kitley /25", "card_number_mismatch"),
    ]
    for title, expected_reason in cases:
        ok, reasons = market._strong_exact_title(title, identity)
        assert ok is False, title
        assert expected_reason in reasons, (title, reasons)


def test_query_uses_print_run_denominator_not_serial_numerator():
    identity = kitley_identity("07/25")
    query = market._query(identity, "")
    assert "/25" in query
    assert "07/25" not in query


def test_best_offer_unknown_evidence_is_explicitly_not_for_pricing():
    row = {
        "title": "Panini 2025 Donruss WNBA Elizabeth Kitley #66 /25 Pink Shimmer",
        "url": "https://www.ebay.com/itm/307099744373",
        "item_price": 15.0,
        "shipping_price": 1.36,
        "sold_at": "2026-08-01T00:00:00+00:00",
    }
    evidence = market._evidence(
        row,
        source="mac_ebay_exact_sold",
        label="eBay Exact Sold · Mac Chrome",
        category="sold",
        pricing_eligible=False,
    )
    assert "not used for pricing" in evidence["flags"]
    assert "reference only" in evidence["flags"]

@pytest.mark.asyncio
async def test_direct_live_bridge_can_run_ebay_sold_only(monkeypatch):
    async def ebay_search(_query: str):
        return [
            {
                "title": "Panini 2025 Donruss WNBA Elizabeth Kitley #66 Las Vegas Aces /25 Pink Shimmer",
                "url": "https://www.ebay.com/itm/307099744373",
                "item_price": 15.0,
                "shipping_price": 1.36,
                "sold_at": "2026-08-01T00:00:00+00:00",
                "best_offer_unknown": True,
            }
        ], {"source": "mac_chrome_ebay_sold", "label": "eBay Sold · Mac Chrome", "status": "live", "resultCount": 1}

    async def forbidden(_query: str):
        raise AssertionError("optional provider should have been skipped")

    monkeypatch.setattr(market, "_search_ebay", ebay_search)
    monkeypatch.setattr(market, "_search_130point", forbidden)
    monkeypatch.setattr(market, "_search_ebay_active", forbidden)
    monkeypatch.setattr(market, "_search_fanatics", forbidden)

    router = market.build_market_comp_router(lambda: None, database_path=None)
    endpoint = next(route.endpoint for route in router.routes if route.path.endswith("/search"))
    result = await endpoint(
        market.MarketCompRequest(
            exact_title="2025 Panini Donruss WNBA #66 Elizabeth Kitley Pink Shimmer /25",
            identity={
                "year": "2025",
                "manufacturer": "Panini",
                "product": "Donruss WNBA",
                "player": "Elizabeth Kitley",
                "cardNumber": "66",
                "parallel": "Pink Shimmer",
                "serialNumber": "/25",
            },
            include_130point=False,
            include_active=False,
            include_fanatics=False,
        )
    )

    assert len(result["sold"]) == 1
    assert result["sold"][0]["url"] == "https://www.ebay.com/itm/307099744373"
    assert "not used for pricing" in result["sold"][0]["flags"]
    assert result["pricingEligibleSoldCount"] == 0
    statuses = {row["source"]: row["status"] for row in result["providerCoverage"]}
    assert statuses["mac_chrome_ebay_sold"] == "live"
    assert statuses["mac_chrome_130point_sold"] == "not_configured"
    assert statuses["mac_chrome_ebay_active"] == "not_configured"
    assert statuses["fanatics_collect_sales_history"] == "not_configured"