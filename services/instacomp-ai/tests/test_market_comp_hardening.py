import pytest

from app import market_comp_routes as market


def yolanda_identity():
    return market._canonical_identity({
        "year": "2025",
        "manufacturer": "Panini",
        "brand": "Donruss",
        "product": "Donruss WNBA",
        "setName": "Legendary Signatures",
        "subset": "Legendary Signatures",
        "player": "Yolanda Griffith",
        "cardNumber": "LS-YG",
        "parallel": "Lava",
        "isAuto": True,
        "isRelic": False,
    })


def test_alphanumeric_card_number_normalization_is_separator_tolerant():
    pattern = market._card_number_pattern("LS-YG")
    assert pattern is not None
    for value in ("#LS-YG", "LS-YG", "LS YG", "LSYG", "# LS.YG"):
        assert pattern.search(f"2025 Yolanda Griffith {value} Lava Auto")
    assert not pattern.search("2025 Yolanda Griffith LS-XX Lava Auto")


def test_numeric_card_number_still_requires_card_number_context():
    pattern = market._card_number_pattern("66")
    assert pattern is not None
    assert pattern.search("Elizabeth Kitley #66 Pink Shimmer")
    assert pattern.search("Elizabeth Kitley Card No. 66 Pink Shimmer")
    assert not pattern.search("Elizabeth Kitley sold 66 days ago Pink Shimmer")


def test_yolanda_word_order_and_insert_identity_are_attribute_based():
    identity = yolanda_identity()
    titles = [
        "2025 Panini Donruss WNBA Legendary Signatures Yolanda Griffith #LS-YG Lava AUTO",
        "2025 Panini Donruss WNBA Yolanda Griffith Legendary Signatures Lava Auto #LS YG",
        "Yolanda Griffith 2025 Donruss WNBA Lava Auto Legendary Signatures LSYG",
    ]
    for title in titles:
        ok, reasons = market._strong_exact_title(title, identity)
        assert ok, (title, reasons)


def test_yolanda_false_positives_stay_rejected():
    identity = yolanda_identity()
    cases = {
        "2025 Panini Donruss WNBA Legendary Signatures Yolanda Griffith #LS-XX Lava AUTO": "card_number_mismatch",
        "2025 Panini Donruss WNBA Legendary Signatures Yolanda Griffith #LS-YG AUTO": "parallel_mismatch",
        "2025 Panini Donruss WNBA Rated Rookie Yolanda Griffith #LS-YG Lava AUTO": "set_or_insert_mismatch",
        "2025 Panini Donruss WNBA Legendary Signatures Yolanda Griffith #LS-YG Lava": "autograph_state_mismatch",
    }
    for title, expected in cases.items():
        ok, reasons = market._strong_exact_title(title, identity)
        assert not ok
        assert expected in reasons, (title, reasons)


def test_query_ladder_dedupes_product_tokens_and_keeps_hard_identity():
    queries = market._query_ladder(yolanda_identity(), "")
    assert queries
    assert any("LS-YG" in query for query in queries)
    assert any("Yolanda Griffith" in query for query in queries)
    assert all("Donruss Donruss WNBA" not in query for query in queries)


@pytest.mark.asyncio
async def test_ebay_query_ladder_broadens_only_when_exact_match_missing(monkeypatch):
    calls = []

    async def fake_search(query: str):
        calls.append(query)
        if len(calls) == 1:
            return [{
                "title": "2025 Donruss WNBA Yolanda Griffith Base #10 Auto",
                "url": "https://www.ebay.com/itm/111111111111",
                "item_price": 5.0,
                "shipping_price": 1.0,
                "sold_at": "2026-08-01T00:00:00+00:00",
            }], {"source": "mac_chrome_ebay_sold", "label": "eBay Sold", "status": "live", "resultCount": 1, "searchUrl": "first"}
        return [{
            "title": "2025 Panini Donruss WNBA Yolanda Griffith Legendary Signatures Lava Auto #LS-YG",
            "url": "https://www.ebay.com/itm/222222222222",
            "item_price": 2.33,
            "shipping_price": 4.99,
            "sold_at": "2026-07-06T00:00:00+00:00",
        }], {"source": "mac_chrome_ebay_sold", "label": "eBay Sold", "status": "live", "resultCount": 1, "searchUrl": "second"}

    monkeypatch.setattr(market, "_search_ebay", fake_search)
    rows, coverage = await market._search_ebay_ladder(["strict", "relaxed", "third"], yolanda_identity())
    assert len(calls) == 2
    assert len(rows) == 2
    assert coverage["attemptCount"] == 2
    assert coverage["attempts"][-1]["exactCount"] == 1


@pytest.mark.asyncio
async def test_ebay_or_best_offer_is_evidence_not_realized_price(monkeypatch):
    async def fake_chrome(_url, _js, _wait):
        return {
            "title": "eBay",
            "body": "",
            "rows": [{
                "title": "2025 Panini Donruss WNBA Legendary Signatures Yolanda Griffith #LS-YG Lava AUTO",
                "url": "https://www.ebay.com/itm/227453981256",
                "text": "Sold Aug 7, 2026\n$4.99\nor Best Offer\n+$1.36 delivery",
                "imageUrl": None,
            }],
        }

    monkeypatch.setattr(market, "_chrome_json", fake_chrome)
    rows, _coverage = await market._search_ebay("Yolanda Griffith LS-YG Lava Auto")
    assert len(rows) == 1
    assert rows[0]["best_offer_unknown"] is True
    assert rows[0]["item_price"] == 4.99
    assert rows[0]["shipping_price"] == 1.36
