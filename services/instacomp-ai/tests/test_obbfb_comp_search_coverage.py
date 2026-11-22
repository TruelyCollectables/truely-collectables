import httpx
import pytest
from fastapi import FastAPI

from app import obbfb_market_comp_routes as market


@pytest.mark.asyncio
async def test_base_search_collects_later_sales_and_rejects_photo_parallel(monkeypatch):
    title = "2026 Panini Prizm WNBA Flau'jae Johnson #150"
    identity = market._canonical_identity({
        "year": "2026", "manufacturer": "Panini", "product": "Prizm WNBA Basketball",
        "player": "Flau'jae Johnson", "cardNumber": "150", "parallel": "Base",
    })
    assert market._strong_exact_title(title.replace("Flau'jae", "Flau Jae"), identity)[0]
    assert not market._strong_exact_title(title + " Rookie Variation", identity)[0]
    assert not market._strong_exact_title(title + " Logo", identity)[0]
    calls = []

    def sale(item, label="", price=2.49):
        return {"title": title + label, "url": f"https://www.ebay.com/itm/{item}",
                "item_price": price, "shipping_price": 0, "sold_at": "2026-10-01T00:00:00+00:00"}

    async def ebay(query):
        calls.append(query)
        rows = [sale("111111111111", " Base")]
        if "Flaujae" in query:
            rows.append(sale("222222222222"))
        return rows, {"status": "live", "resultCount": len(rows)}

    async def point(query):
        assert query == "2026 Prizm WNBA Flau'jae Johnson 150"
        return [sale("222222222222"), sale("333333333333"), sale("444444444444", price=0.99)], {"status": "live"}

    async def photos(rows, _identity):
        assert len(rows) == 5
        return {"ebay:222222222222": "base", "ebay:333333333333": "parallel", "ebay:444444444444": "base"}

    monkeypatch.setattr(market, "_search_ebay", ebay)
    monkeypatch.setattr(market, "_search_130point", point)
    monkeypatch.setattr(market, "_audit_wnba_base_photos", photos)
    app = FastAPI()
    app.include_router(market.build_market_comp_router(lambda: None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/obbfb-market-comp/search", json={
            "identity": {"year": "2026", "manufacturer": "Panini", "product": "Prizm WNBA Basketball",
                         "player": "Flau'jae Johnson", "cardNumber": "150", "parallel": "Base"},
            "exact_title": title + " RC", "include_active": False,
            "include_price_guide": False, "include_130point": True,
        })
    assert response.status_code == 200
    payload = response.json()
    assert len(calls) == 4
    assert any("Flaujae" in query and "Base" in query for query in calls)
    assert {entry["url"].split("/")[-1] for entry in payload["sold"]} == {
        "111111111111", "222222222222", "444444444444",
    }
