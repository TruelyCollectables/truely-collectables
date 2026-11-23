from contextlib import asynccontextmanager

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

@pytest.mark.asyncio
async def test_parallel_photo_search_requires_exact_card_and_explicit_finish(monkeypatch):
    async def active(query):
        assert "Nancy Lieberman #104" in query
        return [
            {"title": "2026 Panini Prizm WNBA Nancy Lieberman #104 Cracked Ice",
             "url": "https://www.ebay.com/itm/111111111111", "image_url": "https://i.ebayimg.com/images/g/one/s-l500.jpg"},
            {"title": "2026 Panini Prizm WNBA Nancy Lieberman #34 Cracked Ice",
             "url": "https://www.ebay.com/itm/222222222222", "image_url": "https://i.ebayimg.com/images/g/two/s-l500.jpg"},
            {"title": "2026 Panini Prizm WNBA Nancy Lieberman #104 Green Ice",
             "url": "https://www.ebay.com/itm/333333333333", "image_url": "https://i.ebayimg.com/images/g/three/s-l500.jpg"},
        ], {"status": "live"}

    @asynccontextmanager
    async def image_stream(self, method, url):
        assert method == "GET"
        assert url.endswith("/one/s-l500.jpg")
        yield httpx.Response(200, headers={"Content-Type": "image/jpeg"},
                             content=b"\xff\xd8\xff", request=httpx.Request(method, url))

    monkeypatch.setattr(httpx.AsyncClient, "stream", image_stream)
    monkeypatch.setattr(market, "_search_ebay_active", active)
    app = FastAPI()
    app.include_router(market.build_market_comp_router(lambda: None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/v1/obbfb-market-comp/parallel-photos", json={"identity": {
            "year": "2026", "product": "Prizm WNBA Basketball", "player": "Nancy Lieberman", "cardNumber": "104",
        }})
    assert response.status_code == 200
    photos = response.json()["photos"]
    assert [(r["id"], r["parallel"]) for r in photos] == [("ebay:111111111111", "Ice Prizm")]
    assert photos[0]["dataUrl"] == "data:image/jpeg;base64,/9j/"

@pytest.mark.asyncio
async def test_recovery_is_owner_scoped_and_completion_hides_scan(tmp_path):
    import sqlite3

    path = tmp_path / "scans.sqlite3"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE scans (scan_id TEXT, card_uuid TEXT, created_at TEXT, front_sha256 TEXT, back_sha256 TEXT, image_pair_sha256 TEXT, status TEXT)")
        db.execute("INSERT INTO scans VALUES ('scan-1', 'card-1', '2026-11-22', 'front', 'back', 'pair', 'supervised_archive_pending_lesson')")
    app = FastAPI()
    app.include_router(market.build_market_comp_router(lambda: None, path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        async def recover(action, owner, **fields):
            return await client.post("/v1/obbfb-market-comp/recovery", json={
                "action": action, "owner": owner, "scanId": "scan-1", **fields,
            })

        assert (await recover("remember", "owner", title="Paige Bueckers #57")).status_code == 200
        assert (await recover("remember", "other", title="other")).status_code == 404
        assert (await recover("get", "other")).status_code == 404
        assert (await recover("list", "other")).json()["scans"] == []
        assert (await recover("complete", "other")).status_code == 200
        assert (await recover("list", "owner")).json()["scans"][0]["title"] == "Paige Bueckers #57"
        assert (await recover("complete", "owner")).status_code == 200
        assert (await recover("list", "owner")).json()["scans"] == []


def test_chrome_base_rejects_labeled_parallel_and_leather_border():
    identity = market._canonical_identity({
        "year": "2026", "product": "Chrome Football", "manufacturer": "Topps", "player": "Caleb Downs",
        "cardNumber": "328", "parallel": "Base",
    })
    title = "2026 Topps Chrome Football Caleb Downs #328"
    assert market._strong_exact_title(title, identity)[0]
    assert not market._strong_exact_title(title + " Leather Border", identity)[0]
    assert not market._strong_exact_title(title + " Parallel", identity)[0]
    assert not market._strong_exact_title(title + " Neon Explosion SP Rookie", identity)[0]
    assert not market._strong_exact_title(title + " Neon Burst Refractor", {**identity, "parallel": "Refractor"})[0]


@pytest.mark.asyncio
async def test_orientation_rechecks_candidate_against_upright_text(monkeypatch, tmp_path):
    from types import SimpleNamespace

    import app as service_package
    from fastapi.responses import FileResponse

    source = tmp_path / "card.jpg"
    source.write_bytes(b"source")

    async def archive(_scan_id, _side):
        return FileResponse(source, media_type="image/jpeg")

    def normalize(content, _max_bytes, rotation):
        assert content == b"source"
        return SimpleNamespace(content=str(rotation).encode(), media_type="image/jpeg")

    def recognize(image, *, side):
        assert side == "back"
        word = "Topps Chrome" if image == b"90" else "unreadable"
        return [SimpleNamespace(text=word)], []

    service = SimpleNamespace(archived_scan_image=archive, validate_and_normalize_image=normalize,
        settings=SimpleNamespace(max_image_bytes=100),
        image_orientation_reader=SimpleNamespace(
            detect_upright_rotation=lambda *_args, **_kwargs: (270, .99, []), recognize=recognize))
    monkeypatch.setattr(service_package, "main", service, raising=False)
    application = FastAPI()
    application.include_router(market.build_market_comp_router(lambda: None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url="http://test") as client:
        response = await client.get("/v1/obbfb-market-comp/upright-scan/scan-1/back")
    assert response.status_code == 200
    assert response.headers["x-scan-vision-rotation"] == "90"
    assert response.content == b"90"
    assert source.read_bytes() == b"source"
