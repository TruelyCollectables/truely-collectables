from __future__ import annotations

import pytest

from app import market_comp_routes as market


@pytest.mark.asyncio
async def test_market_comp_search_never_queries_or_returns_mercari(monkeypatch):
    async def empty_search(_query: str):
        return [], {"source": "test", "status": "no_matches", "resultCount": 0}

    async def forbidden_mercari(_query: str):
        raise AssertionError("Mercari must not run inside InstaComp market-comp search")

    monkeypatch.setattr(market, "_search_ebay", empty_search)
    monkeypatch.setattr(market, "_search_fanatics", empty_search)
    monkeypatch.setattr(market, "_search_130point", empty_search)
    monkeypatch.setattr(market, "_search_ebay_active", empty_search)
    monkeypatch.setattr(market, "_search_mercari", forbidden_mercari)

    router = market.build_market_comp_router(lambda: None, database_path=None)
    endpoint = next(route.endpoint for route in router.routes if route.path.endswith("/search"))
    result = await endpoint(
        market.MarketCompRequest(
            exact_title="2022 Topps Chrome #34 Kiki Rice",
            identity={"year": "2022", "player": "Kiki Rice", "cardNumber": "34"},
        )
    )

    assert result["sold"] == []
    assert result["active"] == []
    assert all("mercari" not in str(row).lower() for row in result["providerCoverage"])
